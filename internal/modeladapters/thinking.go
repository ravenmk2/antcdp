package modeladapters

import (
	"encoding/json"
	"slices"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// ThinkingOptions describes transport mappings, never inferred model support.
// Only native levels are advertised; compatibility aliases are not substituted.
func (r *Registry) ThinkingOptions(provider modelcore.ProviderType, protocol modelcore.Protocol) []modelcore.ThinkingOption {
	options := []modelcore.ThinkingOption{}
	if !r.Supports(provider, protocol) {
		return options
	}
	levels := []string{"none", "low", "high", "max"}
	if provider == modelcore.MiniMax {
		levels = []string{"none", "low", "medium", "high", "xhigh", "max"}
	}
	if provider == modelcore.Custom || provider == modelcore.Ollama {
		levels = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}
	}
	for _, option := range modelcore.ThinkingLevels() {
		if !slices.Contains(levels, option.Key) {
			continue
		}
		params := map[string]any{}
		switch {
		case provider == modelcore.Custom:
			// Custom routes require an explicit, validated administrator mapping.
		case provider == modelcore.Ollama:
			params["reasoning_effort"] = option.Key
		case option.Key == "none":
			params["thinking"] = map[string]string{"type": "disabled"}
		default:
			mode := "enabled"
			if provider == modelcore.MiniMax {
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
