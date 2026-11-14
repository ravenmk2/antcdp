package modelcore

import "encoding/json"

// ThinkingOption is a resolved request parameter set. Stored agent snapshots
// retain the exact parameters selected when the conversation was locked.
type ThinkingOption struct {
	Key        string          `json:"key"`
	Label      string          `json:"label"`
	Parameters json.RawMessage `json:"parameters"`
}

func ThinkingLevels() []ThinkingOption {
	return []ThinkingOption{
		{Key: "none", Label: "关闭"}, {Key: "minimal", Label: "最低"},
		{Key: "low", Label: "低"}, {Key: "medium", Label: "中"},
		{Key: "high", Label: "高"}, {Key: "xhigh", Label: "极高"}, {Key: "max", Label: "最高"},
	}
}

func IsThinkingParameter(key string) bool {
	return key == "thinking" || key == "reasoning_effort" || key == "output_config"
}
