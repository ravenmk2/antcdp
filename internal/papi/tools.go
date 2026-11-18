package papi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

type Authorization struct {
	Code        string `json:"api_code,omitempty"`
	Fingerprint string `json:"definition_fingerprint,omitempty"`
}

type Failure struct {
	Code       string `json:"code"`
	Field      string `json:"field_path,omitempty"`
	Constraint string `json:"constraint,omitempty"`
}

func (f *Failure) Error() string { return f.Code }

func (f *Failure) Content() string {
	message := "The AntCDP Platform API operation is unavailable to this agent."
	switch f.Code {
	case InvalidArguments:
		message = "The AntCDP Platform API arguments did not pass validation."
	case DefinitionChanged:
		message = "The AntCDP Platform API definition has changed. Start a new turn to use the updated definition."
	}
	data, _ := json.Marshal(struct {
		Error   *Failure `json:"error"`
		Message string   `json:"message"`
	}{f, message})
	return string(data)
}

func invalidArguments(err error) *Failure {
	var specific *argumentError
	if errors.As(err, &specific) {
		return &Failure{Code: InvalidArguments, Field: specific.Path, Constraint: specific.Constraint}
	}
	return &Failure{Code: InvalidArguments, Field: "/", Constraint: "validUniqueObject"}
}

// ValidateEnvelope checks the model-facing schema with exact JSON numbers.
// Duplicate-key checks also run at admission against the original source text.
func ValidateEnvelope(rawSchema json.RawMessage, args string) error {
	schema, err := compileSchema(rawSchema)
	if err != nil {
		return err
	}
	var object map[string]any
	decoder := json.NewDecoder(strings.NewReader(args))
	decoder.UseNumber()
	if !json.Valid([]byte(args)) || decoder.Decode(&object) != nil || object == nil {
		return invalidArguments(&argumentError{Path: "", Constraint: "type"})
	}
	if err = schema.validate(object, ""); err != nil {
		return invalidArguments(err)
	}
	return nil
}

type toolInput struct {
	API    string          `json:"api"`
	Args   json.RawMessage `json:"args"`
	Query  string          `json:"query"`
	Offset json.Number     `json:"offset"`
	Limit  json.Number     `json:"limit"`
}

func (r *Registry) Prepare(ctx context.Context, execution agentcore.ExecutionContext, key, args string) (Authorization, error) {
	if r == nil {
		return Authorization{}, &Failure{Code: Unavailable}
	}
	if _, err := decodeObject([]byte(args)); err != nil {
		return Authorization{}, invalidArguments(err)
	}
	var input toolInput
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return Authorization{}, invalidArguments(err)
	}
	if key == ListTool {
		return Authorization{}, nil
	}
	op, grant, err := r.resolve(execution.PAPIGrants, input.API)
	if err != nil {
		return Authorization{}, err
	}
	if key == CallTool {
		_, restriction, err := grantSchema(grant)
		if err != nil {
			return Authorization{}, err
		}
		if err = op.validate(input.Args, restriction); err != nil {
			return Authorization{}, invalidArguments(err)
		}
		if op.binding.authorize != nil {
			if err = op.binding.authorize(ctx, execution, input.Args); err != nil {
				return Authorization{}, err
			}
		}
	}
	return Authorization{Code: op.Code, Fingerprint: op.fingerprint}, nil
}

func (r *Registry) resolve(grants []agentcore.PAPIGrant, code string) (*Operation, agentcore.PAPIGrant, error) {
	for _, grant := range grants {
		if grant.Code == code {
			op := r.Operation(code)
			if op == nil || op.fingerprint != grant.Fingerprint {
				return nil, grant, &Failure{Code: DefinitionChanged}
			}
			return op, grant, nil
		}
	}
	return nil, agentcore.PAPIGrant{}, &Failure{Code: Unavailable}
}

func (r *Registry) Dispatch(ctx context.Context, execution agentcore.ExecutionContext, key, raw string, authorization Authorization) (json.RawMessage, error) {
	var input toolInput
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return nil, invalidArguments(err)
	}
	if key == ListTool {
		return json.Marshal(r.list(execution.PAPIGrants, input))
	}
	op, grant, err := r.resolve(execution.PAPIGrants, input.API)
	if err != nil {
		return nil, err
	}
	if authorization.Code != op.Code || authorization.Fingerprint != op.fingerprint {
		return nil, &Failure{Code: DefinitionChanged}
	}
	if key == DescTool {
		return op.describe(grant)
	}
	return op.binding.run(ctx, execution, input.Args)
}

type listing struct {
	Items      []Summary `json:"items"`
	NextOffset int       `json:"next_offset,omitempty"`
}

func (r *Registry) list(grants []agentcore.PAPIGrant, input toolInput) listing {
	query := strings.ToLower(strings.TrimSpace(input.Query))
	visible := make(map[string]string, len(grants))
	for _, grant := range grants {
		visible[grant.Code] = grant.Fingerprint
	}
	items := []Summary{}
	for _, code := range r.codes {
		op := r.operations[code]
		if visible[code] == op.fingerprint && op.Matches(query) {
			items = append(items, op.summary())
		}
	}
	count, _ := input.Limit.Float64()
	limit := int(count)
	if limit < 1 || limit > 50 {
		limit = 20
	}
	offset, _ := input.Offset.Float64()
	start := int(min(max(0, offset), float64(len(items))))
	end := min(start+limit, len(items))
	result := listing{Items: items[start:end]}
	if end < len(items) {
		result.NextOffset = end
	}
	return result
}

func grantSchema(grant agentcore.PAPIGrant) (json.RawMessage, *inputSchema, error) {
	var constraints Constraints
	if err := json.Unmarshal([]byte(grant.Constraints), &constraints); err != nil {
		return nil, nil, err
	}
	if len(constraints.ArgsSchema) == 0 {
		return nil, nil, nil
	}
	restriction, err := compileSchema(constraints.ArgsSchema)
	return constraints.ArgsSchema, restriction, err
}

func (op *Operation) describe(grant agentcore.PAPIGrant) (json.RawMessage, error) {
	rawSchema, restriction, err := grantSchema(grant)
	if err != nil {
		return nil, err
	}
	var effective any = op.InputSchema
	if restriction != nil {
		effective = map[string][]json.RawMessage{"allOf": {op.InputSchema, rawSchema}}
	}
	var example json.RawMessage
	if op.validate(op.ExampleArgs, restriction) == nil {
		example = op.ExampleArgs
	}
	return json.Marshal(struct {
		Summary
		Description       string          `json:"description"`
		InputSchema       any             `json:"input_schema"`
		ExampleArgs       json.RawMessage `json:"example_args,omitempty"`
		ResultDescription string          `json:"result_description"`
	}{op.summary(), op.Description, effective, example, op.ResultDescription})
}
