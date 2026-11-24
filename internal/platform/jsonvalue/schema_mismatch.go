package jsonvalue

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
)

// SchemaMismatch describes a validation failure using schema-owned facts.
// The validator's raw error can embed private instance data.
func SchemaMismatch(schema *jsonschema.Schema, value any, err error, path string) diagnostic.Detail {
	return describeMismatch(schema, value, err, path, 0)
}

func describeMismatch(schema *jsonschema.Schema, value any, err error, path string, depth int) diagnostic.Detail {
	detail := diagnostic.Detail{FieldPath: path, Constraint: "schema"}
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
					return describeMismatch(child, item, childErr, path+"/"+pointerToken(key), depth+1)
				}
			}
		}
	}
	if array, ok := value.([]any); ok && schema.Items != nil {
		if resolved, resolveErr := schema.Items.Resolve(nil); resolveErr == nil {
			for i, item := range array {
				if childErr := resolved.Validate(item); childErr != nil {
					return describeMismatch(schema.Items, item, childErr, path+"/"+strconv.Itoa(i), depth+1)
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
