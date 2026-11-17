package agents

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// Describe a validation failure using schema-owned facts, never the validator's
// error text: that text can embed the complete command or file contents.
func toolValidationDetail(schema *jsonschema.Schema, value any, err error, path string, depth int) diagnostic.Detail {
	detail := diagnostic.Detail{Source: "model", Stage: "response_validation", Code: "MODEL_TOOL_ARGUMENTS_SCHEMA_MISMATCH", FieldPath: path, Constraint: "schema"}
	if depth > 16 {
		return detail
	}
	if object, ok := value.(map[string]any); ok {
		for _, key := range schema.Required {
			if _, present := object[key]; !present {
				detail.FieldPath = path + "/" + pointerToken(key)
				detail.Constraint = "required"
				return detail
			}
		}
		keys := make([]string, 0, len(schema.Properties))
		for key := range schema.Properties {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			child := schema.Properties[key]
			item, present := object[key]
			if !present {
				continue
			}
			resolved, resolveErr := child.Resolve(nil)
			if resolveErr == nil {
				if childErr := resolved.Validate(item); childErr != nil {
					return toolValidationDetail(child, item, childErr, path+"/"+pointerToken(key), depth+1)
				}
			}
		}
	}
	if array, ok := value.([]any); ok && schema.Items != nil {
		if resolved, resolveErr := schema.Items.Resolve(nil); resolveErr == nil {
			for i, item := range array {
				if childErr := resolved.Validate(item); childErr != nil {
					return toolValidationDetail(schema.Items, item, childErr, path+"/"+strconv.Itoa(i), depth+1)
				}
			}
		}
	}
	for errors.Unwrap(err) != nil {
		err = errors.Unwrap(err)
	}
	// Only the constant prefix is copied. Unknown errors remain "schema".
	keyword, _, _ := strings.Cut(err.Error(), ":")
	allowed := []string{"type", "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "anyOf", "oneOf", "not", "minProperties", "maxProperties", "required"}
	if slices.Contains(allowed, keyword) {
		detail.Constraint = keyword
	}
	if strings.HasPrefix(err.Error(), "unexpected additional properties ") {
		detail.Constraint = "additionalProperties"
	}
	switch detail.Constraint {
	case "type":
		detail.Expected = schema.Type
		if detail.Expected == "" {
			detail.Expected = strings.Join(schema.Types, ",")
		}
	case "minimum":
		if schema.Minimum != nil {
			detail.Expected = strconv.FormatFloat(*schema.Minimum, 'g', -1, 64)
		}
	case "maximum":
		if schema.Maximum != nil {
			detail.Expected = strconv.FormatFloat(*schema.Maximum, 'g', -1, 64)
		}
	}
	return detail
}

func pointerToken(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

type rejectedTool struct {
	Name          string `json:"name"`
	ArgumentsText string `json:"arguments_text"`
	Truncated     bool   `json:"truncated"`
}

func rejectedTools(calls []modelcore.ToolCall) []rejectedTool {
	result := make([]rejectedTool, 0, len(calls))
	// Keep rows, but bound preview bytes independently of executable arguments.
	for _, call := range calls {
		raw := call.Arguments
		if len(raw) > 512 {
			raw = raw[:512]
		}
		result = append(result, rejectedTool{Name: call.Name, ArgumentsText: strings.ToValidUTF8(raw, ""), Truncated: len(raw) < len(call.Arguments)})
	}
	return result
}
