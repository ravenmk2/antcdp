// Package mcp adapts the HTTP Model Context Protocol without exposing SDK
// lifecycle types or allowing remote servers to request platform capabilities.
package mcp

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

const MaxSchemaBytes = 32 << 10
const MaxArgumentsBytes = 32 << 10

// ValidateSchema accepts a bounded JSON Schema object with only local, acyclic
// JSON-pointer references. No loader, dynamic anchors, header annotations or
// network resolution is installed. Data examples do not become subschemas.
func ValidateSchema(raw json.RawMessage) (*jsonschema.Resolved, error) {
	if len(raw) == 0 || len(raw) > MaxSchemaBytes {
		return nil, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return nil, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	root, ok := value.(map[string]any)
	if !ok || root == nil {
		return nil, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	if !jsonDepth(value, 0, 16) {
		return nil, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	visited := map[string]bool{}
	stack := map[string]bool{}
	var walk func(any, string, int) error
	walk = func(value any, path string, depth int) error {
		if depth > 64 {
			return &Error{Code: "MCP_SCHEMA_INVALID"}
		}
		if stack[path] {
			return &Error{Code: "MCP_SCHEMA_CYCLE"}
		}
		if visited[path] {
			return nil
		}
		stack[path] = true
		defer delete(stack, path)
		if _, ok := value.(bool); ok {
			visited[path] = true
			return nil
		}
		node, ok := value.(map[string]any)
		if !ok {
			return &Error{Code: "MCP_SCHEMA_INVALID"}
		}
		for key, child := range node {
			switch key {
			case "$ref":
				ref, ok := child.(string)
				if !ok || !strings.HasPrefix(ref, "#/") {
					return &Error{Code: "MCP_SCHEMA_REFERENCE_UNSUPPORTED"}
				}
				target, ok := pointerTarget(root, ref[1:])
				if !ok {
					return &Error{Code: "MCP_SCHEMA_INVALID"}
				}
				if err := walk(target, ref[1:], depth+1); err != nil {
					return err
				}
			case "$id", "$anchor", "$dynamicAnchor", "$dynamicRef", "$vocabulary", "x-mcp-header":
				return &Error{Code: "MCP_SCHEMA_REFERENCE_UNSUPPORTED"}
			case "properties", "patternProperties", "$defs", "definitions", "dependentSchemas":
				items, ok := child.(map[string]any)
				if !ok {
					return &Error{Code: "MCP_SCHEMA_INVALID"}
				}
				for name, item := range items {
					if err := walk(item, path+"/"+key+"/"+escapePointer(name), depth+1); err != nil {
						return err
					}
				}
			case "allOf", "anyOf", "oneOf", "prefixItems":
				items, ok := child.([]any)
				if !ok {
					return &Error{Code: "MCP_SCHEMA_INVALID"}
				}
				for n, item := range items {
					b, _ := json.Marshal(n)
					if err := walk(item, path+"/"+key+"/"+string(b), depth+1); err != nil {
						return err
					}
				}
			case "items", "additionalProperties", "unevaluatedProperties", "propertyNames", "contains", "additionalItems", "unevaluatedItems", "not", "if", "then", "else", "contentSchema":
				if err := walk(child, path+"/"+key, depth+1); err != nil {
					return err
				}
			case "$schema", "$comment", "type", "title", "description", "default", "deprecated", "readOnly", "writeOnly", "examples", "enum", "const", "multipleOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "minContains", "maxContains", "minProperties", "maxProperties", "required", "dependentRequired", "contentEncoding", "contentMediaType", "format":
			default:
				return &Error{Code: "MCP_SCHEMA_KEYWORD_UNSUPPORTED"}
			}
		}
		visited[path] = true
		return nil
	}
	if err := walk(root, "", 0); err != nil {
		return nil, err
	}
	var schema jsonschema.Schema
	if json.Unmarshal(raw, &schema) != nil {
		return nil, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	resolved, err := schema.Resolve(&jsonschema.ResolveOptions{ValidateDefaults: false})
	if err != nil {
		return nil, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	return resolved, nil
}
func pointerTarget(root map[string]any, path string) (any, bool) {
	var current any = root
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[part]
		if !ok {
			return nil, false
		}
	}
	return current, true
}
func escapePointer(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}
func jsonDepth(v any, n, max int) bool {
	if n > max {
		return false
	}
	switch x := v.(type) {
	case map[string]any:
		for _, c := range x {
			if !jsonDepth(c, n+1, max) {
				return false
			}
		}
	case []any:
		for _, c := range x {
			if !jsonDepth(c, n+1, max) {
				return false
			}
		}
	}
	return true
}
func ValidateArguments(schema, arguments json.RawMessage) error {
	if len(arguments) == 0 || len(arguments) > MaxArgumentsBytes || !json.Valid(arguments) {
		return &Error{Code: "MCP_ARGUMENTS_INVALID"}
	}
	var value map[string]any
	decoder := json.NewDecoder(bytes.NewReader(arguments))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil || value == nil || !jsonDepth(value, 0, 16) {
		return &Error{Code: "MCP_ARGUMENTS_INVALID"}
	}
	resolved, err := ValidateSchema(schema)
	if err != nil {
		return err
	}
	normalized, err := numericValues(value)
	if err != nil {
		return err
	}
	if resolved.Validate(normalized) != nil {
		return &Error{Code: "MCP_ARGUMENTS_INVALID"}
	}
	return nil
}

// jsonschema-go treats json.Number as a Go string. Normalize it for validation
// while sending the original JSON bytes; integers retain their exact 64-bit
// value instead of being silently rounded through float64.
func numericValues(v any) (any, error) {
	switch x := v.(type) {
	case json.Number:
		s := string(x)
		if !strings.ContainsAny(s, ".eE") {
			if n, e := strconv.ParseInt(s, 10, 64); e == nil {
				return n, nil
			}
			if n, e := strconv.ParseUint(s, 10, 64); e == nil {
				return n, nil
			}
			return nil, &Error{Code: "MCP_ARGUMENTS_INVALID"}
		}
		n, e := strconv.ParseFloat(s, 64)
		if e != nil || math.IsInf(n, 0) || math.IsNaN(n) {
			return nil, &Error{Code: "MCP_ARGUMENTS_INVALID"}
		}
		return n, nil
	case map[string]any:
		out := map[string]any{}
		for k, c := range x {
			n, e := numericValues(c)
			if e != nil {
				return nil, e
			}
			out[k] = n
		}
		return out, nil
	case []any:
		out := make([]any, len(x))
		for i, c := range x {
			n, e := numericValues(c)
			if e != nil {
				return nil, e
			}
			out[i] = n
		}
		return out, nil
	default:
		return v, nil
	}
}
func fingerprint(input, output, annotations json.RawMessage) (string, error) {
	raw, err := json.Marshal(map[string]json.RawMessage{"input_schema": input, "output_schema": output, "annotations": annotations})
	if err != nil {
		return "", &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	var decoded any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&decoded) != nil {
		return "", &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	raw, err = json.Marshal(decoded)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:]), nil
}

// Fingerprint canonicalizes the immutable schema/annotation content recorded by
// tool discovery. Titles and descriptions are separate immutable metadata.
func Fingerprint(input, output, annotations json.RawMessage) (string, error) {
	if _, err := ValidateSchema(input); err != nil {
		return "", err
	}
	if len(output) > 0 && string(output) != "null" {
		if _, err := ValidateSchema(output); err != nil {
			return "", err
		}
	}
	return fingerprint(input, output, annotations)
}
