package agents

import (
	"strings"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

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
