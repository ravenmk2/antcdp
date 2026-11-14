package mcp

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
)

type ExampleIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}
type Example struct {
	Arguments any            `json:"arguments"`
	Valid     bool           `json:"valid"`
	Issues    []ExampleIssue `json:"issues"`
}

// GenerateExample builds a bounded, deterministic draft, never business data.
// Full-schema validation is authoritative; unsupported constraints remain visible.
func GenerateExample(raw json.RawMessage) (Example, error) {
	resolved, err := ValidateSchema(raw)
	if err != nil {
		return Example{}, err
	}
	var root map[string]any
	if json.Unmarshal(raw, &root) != nil {
		return Example{}, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	out := Example{Issues: []ExampleIssue{}}
	budget := 512
	issue := func(path string) {
		out.Issues = append(out.Issues, ExampleIssue{path, "此字段需要手工填写或核对约束"})
	}
	valid := func(node map[string]any, v any) bool {
		b, _ := json.Marshal(node)
		r, e := ValidateSchema(b)
		return e == nil && r.Validate(v) == nil
	}
	var build func(any, string, int) any
	build = func(raw any, path string, depth int) any {
		budget--
		if budget < 0 || depth > 16 {
			issue(path)
			return nil
		}
		node, ok := raw.(map[string]any)
		if !ok {
			issue(path)
			return nil
		}
		if ref, ok := node["$ref"].(string); ok {
			target, exists := pointerTarget(root, strings.TrimPrefix(ref, "#"))
			if !exists {
				issue(path)
				return nil
			}
			v := build(target, path, depth+1)
			return v
		}
		candidates := []any{}
		if v, ok := node["const"]; ok {
			candidates = append(candidates, v)
		}
		if values, ok := node["examples"].([]any); ok {
			candidates = append(candidates, values...)
		}
		if v, ok := node["default"]; ok {
			candidates = append(candidates, v)
		}
		if values, ok := node["enum"].([]any); ok {
			candidates = append(candidates, values...)
		}
		for _, v := range candidates {
			if valid(node, v) {
				return v
			}
		}
		for _, key := range []string{"oneOf", "anyOf"} {
			if branches, ok := node[key].([]any); ok {
				for _, branch := range branches {
					if budget <= 0 {
						break
					}
					before := len(out.Issues)
					v := build(branch, path, depth+1)
					if valid(node, v) {
						out.Issues = out.Issues[:before]
						return v
					}
					out.Issues = out.Issues[:before]
				}
				issue(path)
				return nil
			}
		}
		typ, _ := node["type"].(string)
		if types, ok := node["type"].([]any); ok {
			for _, t := range types {
				if t != "null" {
					typ, _ = t.(string)
					break
				}
			}
			if typ == "" {
				typ = "null"
			}
		}
		if typ == "" && node["properties"] != nil {
			typ = "object"
		}
		number := func(key string, fallback float64) float64 {
			v, ok := node[key].(float64)
			if ok {
				return v
			}
			return fallback
		}
		var value any
		switch typ {
		case "object":
			obj := map[string]any{}
			if branches, ok := node["allOf"].([]any); ok {
				for _, b := range branches {
					if part, ok := build(b, path, depth+1).(map[string]any); ok {
						for k, v := range part {
							obj[k] = v
						}
					}
				}
			}
			props, _ := node["properties"].(map[string]any)
			required, _ := node["required"].([]any)
			keys := []string{}
			for _, k := range required {
				if name, ok := k.(string); ok {
					keys = append(keys, name)
				}
			}
			sort.Strings(keys)
			for _, key := range keys {
				if budget <= 0 {
					issue(path)
					break
				}
				obj[key] = build(props[key], path+"/"+escapePointer(key), depth+1)
			}
			value = obj
		case "array":
			count := int(min(number("minItems", 0), 32))
			if number("minItems", 0) > 32 {
				issue(path)
			}
			items := []any{}
			prefix, _ := node["prefixItems"].([]any)
			for i := 0; i < count && budget > 0; i++ {
				child := node["items"]
				if i < len(prefix) {
					child = prefix[i]
				}
				items = append(items, build(child, path+"/"+strconv.Itoa(i), depth+1))
			}
			value = items
		case "integer", "number":
			n := number("minimum", 0)
			if v, ok := node["exclusiveMinimum"].(float64); ok {
				n = max(n, v+1)
			}
			if maxValue, ok := node["maximum"].(float64); ok {
				n = min(n, maxValue)
			}
			if v, ok := node["exclusiveMaximum"].(float64); ok {
				n = min(n, v-1)
			}
			if typ == "integer" {
				n = math.Ceil(n)
			}
			if step := number("multipleOf", 0); step > 0 {
				n = math.Ceil(n/step) * step
			}
			value = n
		case "boolean":
			value = false
		case "null":
			value = nil
		case "string":
			text := "example"
			switch node["format"] {
			case "email":
				text = "user@example.com"
			case "uri", "uri-reference":
				text = "https://example.com"
			case "date":
				text = "2000-01-01"
			case "date-time":
				text = "2000-01-01T00:00:00Z"
			case "uuid":
				text = "00000000-0000-4000-8000-000000000000"
			}
			length := int(min(number("minLength", 0), 512))
			if len(text) < length {
				text += strings.Repeat("x", length-len(text))
			}
			maximum := int(min(number("maxLength", 512), 512))
			if maximum >= 0 && len(text) > maximum {
				text = text[:maximum]
			}
			value = text
		default:
			issue(path)
			return nil
		}
		if !valid(node, value) {
			issue(path)
		}
		return value
	}
	out.Arguments = build(root, "$", 0)
	encoded, e := json.Marshal(out.Arguments)
	if e != nil || len(encoded) > MaxArgumentsBytes {
		out.Arguments = map[string]any{}
		issue("$")
		return out, nil
	}
	_, object := out.Arguments.(map[string]any)
	out.Valid = object && resolved.Validate(out.Arguments) == nil
	if out.Valid {
		out.Issues = []ExampleIssue{}
	} else if len(out.Issues) == 0 {
		issue("$")
	}
	return out, nil
}
