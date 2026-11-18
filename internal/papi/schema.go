package papi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

func decodeObject(raw []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := decodeValue(decoder, 0)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if _, err = decoder.Token(); err != io.EOF || !ok {
		return nil, errors.New("expected a single JSON object")
	}
	return object, nil
}

func decodeValue(decoder *json.Decoder, depth int) (any, error) {
	if depth > 64 {
		return nil, errors.New("JSON nesting exceeds the limit")
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch token {
	case json.Delim('{'):
		object := map[string]any{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			name := key.(string)
			if _, exists := object[name]; exists {
				return nil, errors.New("duplicate JSON object key")
			}
			value, err := decodeValue(decoder, depth+1)
			if err != nil {
				return nil, err
			}
			object[name] = value
		}
		_, err = decoder.Token()
		return object, err
	case json.Delim('['):
		array := []any{}
		for decoder.More() {
			value, err := decodeValue(decoder, depth+1)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		_, err = decoder.Token()
		return array, err
	default:
		return token, nil
	}
}

type schemaFields struct {
	Type                 json.RawMessage            `json:"type"`
	Properties           map[string]json.RawMessage `json:"properties"`
	Required             []string                   `json:"required"`
	AdditionalProperties *bool                      `json:"additionalProperties"`
	Items                json.RawMessage            `json:"items"`
	Enum                 []any                      `json:"enum"`
	MinLength            *int                       `json:"minLength"`
	MaxLength            *int                       `json:"maxLength"`
	MinItems             *int                       `json:"minItems"`
	MaxItems             *int                       `json:"maxItems"`
	Minimum              *json.Number               `json:"minimum"`
	Maximum              *json.Number               `json:"maximum"`
}

type inputSchema struct {
	typeName             string
	enum                 []any
	props                map[string]*inputSchema
	keys                 []string
	required             []string
	items                *inputSchema
	min, max             *big.Rat
	minLength, maxLength *int
	minItems, maxItems   *int
	closed               bool
}

func compileSchema(raw json.RawMessage) (*inputSchema, error) {
	if len(raw) > MaxSchemaBytes {
		return nil, errors.New("schema exceeds the size limit")
	}
	if _, err := decodeObject(raw); err != nil {
		return nil, err
	}
	return compileSchemaNode(raw, 0)
}

func compileSchemaNode(raw json.RawMessage, depth int) (*inputSchema, error) {
	if depth > 12 {
		return nil, errors.New("expected a schema object within the depth limit")
	}
	var members map[string]json.RawMessage
	if json.Unmarshal(raw, &members) != nil || members == nil {
		return nil, errors.New("expected a schema object")
	}
	for key, value := range members {
		if err := checkSchemaMember(key, value); err != nil {
			return nil, err
		}
	}
	var fields schemaFields
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fields); err != nil {
		return nil, err
	}
	if fields.Enum != nil && len(fields.Enum) == 0 {
		return nil, errors.New("enum must contain at least one value")
	}
	var typeName string
	if len(fields.Type) > 0 {
		if err := json.Unmarshal(fields.Type, &typeName); err != nil || !slices.Contains([]string{"object", "array", "string", "number", "integer", "boolean", "null"}, typeName) {
			return nil, errors.New("unsupported schema type")
		}
	}
	if depth == 0 && typeName != "" && typeName != "object" {
		return nil, errors.New("argument schema must describe an object")
	}
	if err := validateSchemaLengths(fields); err != nil {
		return nil, err
	}
	schema := &inputSchema{
		typeName: typeName, enum: fields.Enum, props: make(map[string]*inputSchema, len(fields.Properties)), required: fields.Required,
		minLength: fields.MinLength, maxLength: fields.MaxLength, minItems: fields.MinItems, maxItems: fields.MaxItems,
		closed: fields.AdditionalProperties != nil && !*fields.AdditionalProperties,
	}
	var err error
	if schema.min, err = schemaNumber(fields.Minimum); err != nil {
		return nil, err
	}
	if schema.max, err = schemaNumber(fields.Maximum); err != nil {
		return nil, err
	}
	if schema.min != nil && schema.max != nil && schema.min.Cmp(schema.max) > 0 {
		return nil, errors.New("minimum exceeds maximum")
	}
	for key, child := range fields.Properties {
		schema.props[key], err = compileSchemaNode(child, depth+1)
		if err != nil {
			return nil, err
		}
		schema.keys = append(schema.keys, key)
	}
	slices.Sort(schema.keys)
	if len(fields.Items) > 0 {
		schema.items, err = compileSchemaNode(fields.Items, depth+1)
	}
	return schema, err
}

func checkSchemaMember(key string, raw json.RawMessage) error {
	value := bytes.TrimSpace(raw)
	if bytes.Equal(value, []byte("null")) {
		return errors.New("schema keywords require a value")
	}
	switch key {
	case "minimum", "maximum":
		if len(value) == 0 || value[0] == '"' {
			return errors.New("numeric bounds must be numbers")
		}
	case "required":
		var names []json.RawMessage
		if json.Unmarshal(value, &names) != nil {
			return errors.New("required must be an array of field names")
		}
		seen := map[string]bool{}
		for _, name := range names {
			var decoded string
			if len(name) == 0 || name[0] != '"' || json.Unmarshal(name, &decoded) != nil || seen[decoded] {
				return errors.New("required must contain unique field names")
			}
			seen[decoded] = true
		}
	case "type", "properties", "additionalProperties", "items", "enum", "minLength", "maxLength", "minItems", "maxItems":
	default:
		return errors.New("unsupported schema keyword")
	}
	return nil
}

func validateSchemaLengths(fields schemaFields) error {
	for _, bounds := range [][2]*int{{fields.MinLength, fields.MaxLength}, {fields.MinItems, fields.MaxItems}} {
		lo, hi := bounds[0], bounds[1]
		if lo != nil && *lo < 0 || hi != nil && *hi < 0 || lo != nil && hi != nil && *lo > *hi {
			return errors.New("invalid length bounds")
		}
	}
	return nil
}

func schemaNumber(number *json.Number) (*big.Rat, error) {
	if number == nil {
		return nil, nil
	}
	raw := string(*number)
	if index := strings.IndexAny(raw, "eE"); index >= 0 {
		exponent, err := strconv.Atoi(raw[index+1:])
		if err != nil || exponent > 10000 || exponent < -10000 {
			return nil, errors.New("numeric exponent exceeds the comparison limit")
		}
	}
	value, ok := new(big.Rat).SetString(raw)
	if !ok {
		return nil, errors.New("invalid numeric bound")
	}
	return value, nil
}

type argumentError struct{ Path, Constraint string }

func (e *argumentError) Error() string { return e.Path + ": " + e.Constraint }

func (s *inputSchema) validate(value any, path string) error {
	if !matchesType(value, s.typeName) {
		return &argumentError{Path: path, Constraint: "type"}
	}
	if s.enum != nil && !slices.ContainsFunc(s.enum, func(expected any) bool { return equalJSON(value, expected) }) {
		return &argumentError{Path: path, Constraint: "enum"}
	}
	switch input := value.(type) {
	case map[string]any:
		return s.validateObject(input, path)
	case []any:
		if constraint := lengthConstraint(len(input), s.minItems, s.maxItems, "Items"); constraint != "" {
			return &argumentError{Path: path, Constraint: constraint}
		}
		if s.items != nil {
			for i, item := range input {
				if err := s.items.validate(item, path+"/"+strconv.Itoa(i)); err != nil {
					return err
				}
			}
		}
	case string:
		if constraint := lengthConstraint(utf8.RuneCountInString(input), s.minLength, s.maxLength, "Length"); constraint != "" {
			return &argumentError{Path: path, Constraint: constraint}
		}
	case json.Number:
		if s.min != nil || s.max != nil {
			n, err := schemaNumber(&input)
			if err != nil {
				return &argumentError{Path: path, Constraint: "number"}
			}
			if s.min != nil && n.Cmp(s.min) < 0 {
				return &argumentError{Path: path, Constraint: "minimum"}
			}
			if s.max != nil && n.Cmp(s.max) > 0 {
				return &argumentError{Path: path, Constraint: "maximum"}
			}
		}
	}
	return nil
}

func lengthConstraint(length int, minLength, maxLength *int, suffix string) string {
	if minLength != nil && length < *minLength {
		return "min" + suffix
	}
	if maxLength != nil && length > *maxLength {
		return "max" + suffix
	}
	return ""
}

func matchesType(value any, expected string) bool {
	if expected == "" {
		return true
	}
	switch value := value.(type) {
	case nil:
		return expected == "null"
	case map[string]any:
		return expected == "object"
	case []any:
		return expected == "array"
	case string:
		return expected == "string"
	case bool:
		return expected == "boolean"
	case json.Number:
		if expected == "number" {
			return true
		}
		if expected == "integer" {
			number, err := schemaNumber(&value)
			return err == nil && number.IsInt()
		}
	}
	return false
}

// JSON numbers and strings are distinct even when they share the same text.
func equalJSON(left, right any) bool {
	switch left := left.(type) {
	case json.Number:
		right, ok := right.(json.Number)
		if !ok {
			return false
		}
		if left == right {
			return true
		}
		a, errA := schemaNumber(&left)
		b, errB := schemaNumber(&right)
		return errA == nil && errB == nil && a.Cmp(b) == 0
	case map[string]any:
		right, ok := right.(map[string]any)
		if !ok || len(left) != len(right) {
			return false
		}
		for key, value := range left {
			if other, exists := right[key]; !exists || !equalJSON(value, other) {
				return false
			}
		}
		return true
	case []any:
		right, ok := right.([]any)
		return ok && slices.EqualFunc(left, right, equalJSON)
	default:
		return left == right
	}
}

func (s *inputSchema) validateObject(object map[string]any, path string) error {
	for _, key := range s.required {
		if _, ok := object[key]; !ok {
			return &argumentError{Path: fieldPath(path, key), Constraint: "required"}
		}
	}
	if s.closed {
		for key := range object {
			if _, ok := s.props[key]; !ok {
				return &argumentError{Path: path, Constraint: "additionalProperties"}
			}
		}
	}
	for _, key := range s.keys {
		if value, ok := object[key]; ok {
			if err := s.props[key].validate(value, fieldPath(path, key)); err != nil {
				return err
			}
		}
	}
	return nil
}

func fieldPath(path, key string) string {
	return path + "/" + strings.NewReplacer("~", "~0", "/", "~1").Replace(key)
}

type Constraints struct {
	ArgsSchema json.RawMessage `json:"args_schema,omitempty"`
}

func ParseConstraints(raw json.RawMessage) (Constraints, error) {
	var constraints Constraints
	if len(raw) == 0 {
		return constraints, nil
	}
	if len(raw) > MaxSchemaBytes+64 {
		return Constraints{}, errors.New("parameter constraints exceed the size limit")
	}
	object, err := decodeObject(raw)
	if err != nil {
		return Constraints{}, err
	}
	for key := range object {
		if key != "args_schema" {
			return Constraints{}, errors.New("unsupported parameter constraint")
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&constraints); err != nil {
		return Constraints{}, err
	}
	if len(constraints.ArgsSchema) > 0 {
		constraints.ArgsSchema, err = agentcore.CanonicalJSON(constraints.ArgsSchema)
		if err != nil {
			return Constraints{}, err
		}
		if _, err = compileSchema(constraints.ArgsSchema); err != nil {
			return Constraints{}, err
		}
	}
	return constraints, nil
}

func (op *Operation) validate(raw json.RawMessage, restriction *inputSchema) error {
	if len(raw) > op.binding.maxArgsBytes {
		return &argumentError{Path: "/args", Constraint: "size"}
	}
	object, err := decodeObject(raw)
	if err != nil {
		return &argumentError{Path: "/args", Constraint: "validUniqueObject"}
	}
	if err := op.schema.validate(object, "/args"); err != nil {
		return err
	}
	if restriction != nil {
		return restriction.validate(object, "/args")
	}
	return nil
}
