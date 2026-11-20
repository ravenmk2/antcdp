package modeladapters

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/jsonvalue"
)

type responseFormat struct {
	Type   string          `json:"type"`
	Schema json.RawMessage `json:"schema,omitempty"`
}

func responseFormatRule() parameterRule {
	variants := []any{
		map[string]any{
			"type": "object", "additionalProperties": false, "required": []string{"type"},
			"properties": map[string]any{"type": map[string]string{"const": "json_object"}},
		},
		map[string]any{
			"type": "object", "additionalProperties": false, "required": []string{"type", "schema"},
			"properties": map[string]any{
				"type":   map[string]string{"const": "json_schema"},
				"schema": map[string]string{"type": "object"},
			},
		},
	}
	return parameterRule{schema: map[string]any{"oneOf": variants}, valid: func(raw json.RawMessage) bool {
		_, err := resolveResponseSchema(raw)
		return err == nil
	}}
}

func resolveResponseSchema(raw json.RawMessage) (*jsonschema.Resolved, error) {
	var format responseFormat
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if !json.Valid(raw) || decoder.Decode(&format) != nil {
		return nil, modelcore.ErrInvalidRequest
	}
	if format.Type == "json_object" && format.Schema == nil {
		return nil, nil
	}
	if format.Type != "json_schema" || len(format.Schema) == 0 || format.Schema[0] != '{' {
		return nil, modelcore.ErrInvalidRequest
	}
	var schema jsonschema.Schema
	if json.Unmarshal(format.Schema, &schema) != nil {
		return nil, modelcore.ErrInvalidRequest
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return nil, modelcore.ErrInvalidRequest
	}
	return resolved, nil
}

// Both modes describe the final assistant reply. Tool arguments have their own schemas.
func applyResponseFormat(body map[string]any, input *modelcore.Request) error {
	raw := input.Parameters["response_format"]
	if raw == nil {
		return nil
	}
	var format responseFormat
	if err := json.Unmarshal(raw, &format); err != nil {
		return err
	}
	if input.Protocol == modelcore.ChatCompletions {
		wire := map[string]any{"type": format.Type}
		if format.Type == "json_schema" {
			wire["json_schema"] = map[string]any{"name": "response", "strict": true, "schema": format.Schema}
		} else {
			// JSON mode on Chat Completions also requires an explicit JSON instruction.
			const instruction = "Return the final reply as a JSON object."
			if first := input.Messages[0]; first.Role == "system" && len(first.Native) == 0 {
				input.Messages = slices.Clone(input.Messages)
				input.Messages[0].Content = first.Content + "\n\n" + instruction
			} else {
				input.Messages = append([]modelcore.Message{{Role: "system", Content: instruction}}, input.Messages...)
			}
		}
		body["response_format"] = wire
		return nil
	}
	// Messages expresses both requests through a schema. A provider that
	// restricts open-ended objects can reject the JSON object request.
	if format.Type == "json_object" {
		format = responseFormat{Type: "json_schema", Schema: json.RawMessage(`{"type":"object","additionalProperties":true}`)}
	}
	output := map[string]any{}
	if raw := input.Parameters["output_config"]; raw != nil {
		if err := json.Unmarshal(raw, &output); err != nil {
			return err
		}
	}
	output["format"] = format
	body["output_config"] = output
	return nil
}

func validateStructuredReply(raw json.RawMessage, reply modelcore.Message) error {
	if raw == nil || len(reply.ToolCalls) > 0 {
		return nil
	}
	schema, err := resolveResponseSchema(raw)
	if err != nil {
		return err
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(reply.Content))
	decoder.UseNumber()
	if !json.Valid([]byte(reply.Content)) || decoder.Decode(&value) != nil {
		return invalidResponse("MODEL_STRUCTURED_OUTPUT_INVALID")
	}
	if schema != nil {
		normalized, err := jsonvalue.SchemaNumbers(value)
		if err != nil || schema.Validate(normalized) != nil {
			return invalidResponse("MODEL_STRUCTURED_OUTPUT_INVALID")
		}
	} else if _, ok := value.(map[string]any); !ok {
		return invalidResponse("MODEL_STRUCTURED_OUTPUT_INVALID")
	}
	return nil
}
