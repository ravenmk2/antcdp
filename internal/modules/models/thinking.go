package models

import (
	"encoding/json"
	"slices"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func thinkingConfig(options []ThinkingOption) ([]string, map[string]json.RawMessage) {
	levels := []string{}
	mapping := map[string]json.RawMessage{}
	for _, option := range options {
		if option.Key == "standard" && same(option.Parameters, json.RawMessage(`{}`)) {
			continue
		}
		levels = append(levels, option.Key)
		mapping[option.Key] = option.Parameters
	}
	return levels, mapping
}

func (s *Service) resolveThinking(kind, protocol string, levels []string, mapping map[string]json.RawMessage) ([]ThinkingOption, error) {
	if len(mapping) > 0 && kind != "custom" {
		return nil, httpx.Invalid("thinking_mapping", "custom_provider_only")
	}
	for key := range mapping {
		if !slices.Contains(levels, key) {
			return nil, httpx.Invalid("thinking_mapping", "unselected_level")
		}
	}
	if len(levels) == 0 {
		return []ThinkingOption{{Key: "standard", Label: "默认", Parameters: json.RawMessage(`{}`)}}, nil
	}
	if s.ThinkingCatalog == nil {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "思考档位目录未配置")
	}
	catalog := s.ThinkingCatalog(kind, protocol)
	selected := map[string]bool{}
	for _, key := range levels {
		if selected[key] || !slices.ContainsFunc(catalog, func(v ThinkingOption) bool { return v.Key == key }) {
			return nil, httpx.Invalid("thinking_levels", "unsupported_or_duplicate")
		}
		selected[key] = true
	}
	options := []ThinkingOption{}
	for _, option := range catalog {
		if !selected[option.Key] {
			continue
		}
		if kind == "custom" {
			option.Parameters = mapping[option.Key]
		}
		if err := validateThinkingMapping(option); err != nil {
			return nil, err
		}
		if s.ValidateParameters == nil {
			return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "模型适配器未配置")
		}
		if err := s.ValidateParameters(kind, protocol, option.Parameters); err != nil {
			return nil, httpx.Invalid("thinking_mapping", "unsupported_parameters")
		}
		options = append(options, option)
	}
	return options, nil
}

func validateThinkingMapping(option ThinkingOption) error {
	var values map[string]json.RawMessage
	if json.Unmarshal(option.Parameters, &values) != nil || len(values) == 0 {
		return httpx.Invalid("thinking_mapping", "mapping_required")
	}
	for key := range values {
		if !modelcore.IsThinkingParameter(key) {
			return httpx.Invalid("thinking_mapping", "thinking_parameters_only")
		}
	}
	var state struct {
		Thinking struct {
			Type string `json:"type"`
		} `json:"thinking"`
		Effort string `json:"reasoning_effort"`
		Output struct {
			Effort string `json:"effort"`
		} `json:"output_config"`
	}
	if json.Unmarshal(option.Parameters, &state) != nil {
		return httpx.Invalid("thinking_mapping", "invalid_object")
	}
	disabled := state.Thinking.Type == "disabled" || state.Effort == "none" || state.Output.Effort == "none"
	enabled := state.Thinking.Type == "enabled" || state.Thinking.Type == "adaptive" || state.Effort != "" && state.Effort != "none" || state.Output.Effort != "" && state.Output.Effort != "none"
	if option.Key == "none" && (!disabled || enabled) || option.Key != "none" && (disabled || !enabled) {
		return httpx.Invalid("thinking_mapping", "inconsistent_level")
	}
	return nil
}
