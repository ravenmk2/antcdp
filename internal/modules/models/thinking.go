package models

import (
	"encoding/json"
	"slices"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) resolveThinking(kind, protocol string, levels []string, mapping map[string]json.RawMessage) ([]ThinkingOption, error) {
	for key := range mapping {
		if !slices.Contains(levels, key) {
			return nil, httpx.Invalid("thinking_mapping", "unselected_level")
		}
	}
	if len(levels) == 0 {
		return []ThinkingOption{}, nil
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
		if override, ok := mapping[option.Key]; ok {
			option.Parameters = override
		}
		if err := validateThinkingMapping(option); err != nil {
			return nil, err
		}
		if s.ValidateParameters == nil {
			return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "模型适配器未配置")
		}
		if err := s.ValidateParameters(kind, protocol, option.Parameters); err != nil {
			return nil, httpx.Invalid("thinking_mapping."+option.Key, "unsupported_parameters")
		}
		options = append(options, option)
	}
	return options, nil
}

func validateThinkingMapping(option ThinkingOption) error {
	field := "thinking_mapping." + option.Key
	var values map[string]json.RawMessage
	if json.Unmarshal(option.Parameters, &values) != nil || len(values) == 0 {
		return httpx.Invalid(field, "mapping_required")
	}
	for key := range values {
		if !modelcore.IsThinkingParameter(key) {
			return httpx.Invalid(field, "thinking_parameters_only")
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
		return httpx.Invalid(field, "invalid_object")
	}
	// Provider-specific aliases are configurable; reject contradictions only for known values.
	for _, token := range []string{state.Thinking.Type, state.Effort, state.Output.Effort} {
		switch token {
		case "none", "disabled", "off":
			if option.Key != "none" {
				return httpx.Invalid(field, "inconsistent_level")
			}
		case "enabled", "adaptive", "minimal", "low", "medium", "high", "xhigh", "max":
			if option.Key == "none" {
				return httpx.Invalid(field, "inconsistent_level")
			}
		}
	}
	return nil
}
