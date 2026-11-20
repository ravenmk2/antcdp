package modeladapters

import (
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// ThinkingOptions describes transport mappings, never inferred model support.
// Each preset is a wire template for an explicitly enabled level.
func (r *Registry) ThinkingOptions(provider modelcore.ProviderType, protocol modelcore.Protocol) []modelcore.ThinkingOption {
	options := []modelcore.ThinkingOption{}
	if !r.Supports(provider, protocol) {
		return options
	}
	for _, option := range modelcore.ThinkingLevels() {
		params := map[string]any{}
		switch {
		case provider == modelcore.Ollama || provider == modelcore.Custom && protocol == modelcore.ChatCompletions:
			params["reasoning_effort"] = option.Key
		case provider == modelcore.Custom && option.Key == "minimal":
			params["thinking"] = map[string]any{"type": "enabled", "budget_tokens": 1024}
		case option.Key == "none":
			params["thinking"] = map[string]string{"type": "disabled"}
		default:
			mode := "enabled"
			if provider == modelcore.MiniMax || provider == modelcore.Custom {
				mode = "adaptive"
			}
			params["thinking"] = map[string]string{"type": mode}
			if protocol == modelcore.AnthropicMessages {
				params["output_config"] = map[string]string{"effort": option.Key}
			} else {
				params["reasoning_effort"] = option.Key
			}
		}
		option.Parameters, _ = json.Marshal(params)
		options = append(options, option)
	}
	return options
}
