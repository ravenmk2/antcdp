// Package modeladapters implements registered model protocols without agent dependencies.
package modeladapters

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type Registry struct{}

func NewRegistry() *Registry { return &Registry{} }

func (*Registry) Types() []modelcore.ProviderSpec {
	chat := modelcore.ProtocolSpec{Protocol: modelcore.ChatCompletions, Implemented: true, Verified: modelcore.Unknown}
	msgs := modelcore.ProtocolSpec{Protocol: modelcore.AnthropicMessages, Implemented: true, Verified: modelcore.Unknown}
	return []modelcore.ProviderSpec{
		{Type: modelcore.DeepSeek, Name: "DeepSeek", Protocols: []modelcore.ProtocolSpec{chat, msgs}, AuthMethods: []string{"api_key"}, DiscoverySupported: true},
		{Type: modelcore.MiniMax, Name: "MiniMax", Protocols: []modelcore.ProtocolSpec{chat, msgs}, AuthMethods: []string{"api_key"}},
		{Type: modelcore.GLM, Name: "GLM", Protocols: []modelcore.ProtocolSpec{chat}, AuthMethods: []string{"api_key"}},
		{Type: modelcore.Ollama, Name: "Ollama", Protocols: []modelcore.ProtocolSpec{chat}, AuthMethods: []string{"none", "api_key"}, DiscoverySupported: true},
		{Type: modelcore.Custom, Name: "自定义", Protocols: []modelcore.ProtocolSpec{chat, msgs}, AuthMethods: []string{"api_key"}, DiscoverySupported: true},
	}
}

func (r *Registry) Supports(provider modelcore.ProviderType, protocol modelcore.Protocol) bool {
	for _, spec := range r.Types() {
		if spec.Type == provider {
			for _, p := range spec.Protocols {
				if p.Protocol == protocol {
					return p.Implemented
				}
			}
		}
	}
	return false
}

// ValidateParameters accepts a deliberately narrow, typed route-specific set.
// It is syntax validation, not evidence that a remote model implements a feature.
func (r *Registry) ValidateParameters(provider modelcore.ProviderType, protocol modelcore.Protocol, parameters map[string]json.RawMessage) error {
	if !r.Supports(provider, protocol) {
		return modelcore.ErrUnsupported
	}
	rules := parameterRules(provider, protocol)
	for key, raw := range parameters {
		rule, ok := rules[key]
		if !ok || !rule.valid(raw) {
			return fmt.Errorf("%w: parameter %s", modelcore.ErrUnsupported, key)
		}
	}
	return nil
}

// ParameterSchema and validation are generated from the same registered rules.
// It describes accepted syntax, not verified remote model capabilities.
func (r *Registry) ParameterSchema(provider modelcore.ProviderType, protocol modelcore.Protocol) (json.RawMessage, error) {
	if !r.Supports(provider, protocol) {
		return nil, modelcore.ErrUnsupported
	}
	properties := map[string]any{}
	for name, rule := range parameterRules(provider, protocol) {
		properties[name] = rule.schema
	}
	return json.Marshal(map[string]any{"type": "object", "additionalProperties": false, "properties": properties})
}

type parameterRule struct {
	schema any
	valid  func(json.RawMessage) bool
}

func numericRule(minimum, maximum float64, integer bool) parameterRule {
	kind := "number"
	if integer {
		kind = "integer"
	}
	return parameterRule{schema: map[string]any{"type": kind, "minimum": minimum, "maximum": maximum}, valid: func(raw json.RawMessage) bool { return numberIn(raw, minimum, maximum, integer) }}
}

func enumRule(values ...string) parameterRule {
	return parameterRule{schema: map[string]any{"type": "string", "enum": values}, valid: func(raw json.RawMessage) bool {
		var value string
		if json.Unmarshal(raw, &value) != nil {
			return false
		}
		for _, allowed := range values {
			if value == allowed {
				return true
			}
		}
		return false
	}}
}

func objectRule(name string, child parameterRule) parameterRule {
	return parameterRule{schema: map[string]any{"type": "object", "required": []string{name}, "additionalProperties": false, "properties": map[string]any{name: child.schema}}, valid: func(raw json.RawMessage) bool {
		var object map[string]json.RawMessage
		return json.Unmarshal(raw, &object) == nil && len(object) == 1 && child.valid(object[name])
	}}
}

func parameterRules(provider modelcore.ProviderType, protocol modelcore.Protocol) map[string]parameterRule {
	rules := map[string]parameterRule{
		"temperature": numericRule(0, 2, false), "top_p": numericRule(0, 1, false), "max_output_tokens": numericRule(1, 2000000, true),
		"stop": {schema: map[string]any{"type": "array", "minItems": 1, "maxItems": 4, "items": map[string]any{"type": "string", "minLength": 1, "maxLength": 128, "x-max-utf8-bytes": 128}}, valid: func(raw json.RawMessage) bool {
			var values []string
			if json.Unmarshal(raw, &values) != nil || len(values) == 0 || len(values) > 4 {
				return false
			}
			for _, value := range values {
				if len(value) == 0 || len(value) > 128 {
					return false
				}
			}
			return true
		}},
	}
	if protocol == modelcore.AnthropicMessages || provider == modelcore.DeepSeek || provider == modelcore.GLM || provider == modelcore.MiniMax {
		variants := []any{map[string]any{"type": "object", "required": []string{"type"}, "additionalProperties": false, "properties": map[string]any{"type": map[string]any{"enum": []string{"enabled", "disabled"}}}}}
		if protocol == modelcore.AnthropicMessages && provider == modelcore.Custom {
			variants = append(variants, map[string]any{"type": "object", "required": []string{"type", "budget_tokens"}, "additionalProperties": false, "properties": map[string]any{"type": map[string]any{"const": "enabled"}, "budget_tokens": numericRule(1, 2000000, true).schema}})
		}
		rules["thinking"] = parameterRule{schema: map[string]any{"oneOf": variants}, valid: func(raw json.RawMessage) bool {
			var value map[string]json.RawMessage
			if json.Unmarshal(raw, &value) != nil {
				return false
			}
			var kind string
			if json.Unmarshal(value["type"], &kind) != nil {
				return false
			}
			if len(value) == 1 {
				return kind == "enabled" || kind == "disabled"
			}
			return protocol == modelcore.AnthropicMessages && provider == modelcore.Custom && kind == "enabled" && len(value) == 2 && numberIn(value["budget_tokens"], 1, 2000000, true)
		}}
	}
	if provider == modelcore.MiniMax {
		rules["thinking"] = objectRule("type", enumRule("adaptive", "disabled"))
		effort := enumRule("low", "medium", "high", "xhigh", "max")
		if protocol == modelcore.ChatCompletions {
			rules["reasoning_effort"] = effort
		} else {
			rules["output_config"] = objectRule("effort", effort)
		}
	}
	if provider == modelcore.DeepSeek {
		if protocol == modelcore.AnthropicMessages {
			rules["thinking"] = objectRule("type", enumRule("enabled", "disabled", "adaptive"))
			rules["output_config"] = objectRule("effort", enumRule("none", "low", "high", "max"))
		} else {
			rules["reasoning_effort"] = enumRule("low", "high", "max")
		}
	}
	if provider == modelcore.GLM {
		rules["reasoning_effort"] = enumRule("low", "high", "max")
	}
	if provider == modelcore.Ollama || provider == modelcore.Custom && protocol == modelcore.ChatCompletions {
		rules["reasoning_effort"] = enumRule("none", "minimal", "low", "medium", "high", "xhigh", "max")
	}
	if provider == modelcore.Custom && protocol == modelcore.AnthropicMessages {
		rules["output_config"] = objectRule("effort", enumRule("low", "medium", "high", "xhigh", "max"))
		previous := rules["thinking"]
		rules["thinking"] = parameterRule{schema: map[string]any{"oneOf": []any{previous.schema, objectRule("type", enumRule("adaptive")).schema}}, valid: func(raw json.RawMessage) bool {
			return previous.valid(raw) || objectRule("type", enumRule("adaptive")).valid(raw)
		}}
	}
	return rules
}

func numberIn(raw []byte, minValue, maxValue float64, integer bool) bool {
	var value float64
	return string(raw) != "null" && json.Unmarshal(raw, &value) == nil && value >= minValue && value <= maxValue && (!integer || math.Trunc(value) == value)
}
