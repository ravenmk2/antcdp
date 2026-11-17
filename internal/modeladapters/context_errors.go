package modeladapters

import (
	"encoding/json"
	"strings"
)

// Only explicit context-overflow errors authorize a changed-request retry.
// Generic size limits, output limits and arbitrary 400s do not. Body text is
// inspected in memory and is never retained in the returned error.
func contextOverflow(raw []byte) bool {
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return false
	}
	for _, code := range []string{body.Error.Code, body.Error.Type} {
		switch strings.ToLower(code) {
		case "context_length_exceeded", "context_window_exceeded":
			return true
		}
	}
	message := strings.ToLower(body.Error.Message)
	return strings.Contains(message, "prompt is too long") ||
		strings.Contains(message, "maximum context length") && (strings.Contains(message, "exceed") || strings.Contains(message, "requested"))
}
