package agents

import (
	"encoding/json"
	"slices"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func titleModel(locked agentcore.LockedModel, allowed []string, options []modelcore.ThinkingOption) agentcore.LockedModel {
	for _, level := range modelcore.ThinkingLevels() {
		if !slices.Contains(allowed, level.Key) {
			continue
		}
		for _, option := range options {
			if option.Key != level.Key {
				continue
			}
			var thinking map[string]json.RawMessage
			if json.Unmarshal(option.Parameters, &thinking) != nil || len(thinking) == 0 {
				continue
			}
			parameters := map[string]json.RawMessage{}
			for key, value := range locked.Parameters {
				if !modelcore.IsThinkingParameter(key) {
					parameters[key] = slices.Clone(value)
				}
			}
			for key, value := range thinking {
				parameters[key] = slices.Clone(value)
			}
			locked.Parameters, locked.ThinkingKey = parameters, option.Key
			return locked
		}
	}
	return locked
}
