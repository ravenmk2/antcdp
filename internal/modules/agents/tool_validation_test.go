package agents

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestToolValidationReportsSafeFields(t *testing.T) {
	tool := agentcore.ToolSpec{Definition: modelcore.Tool{Name: "exec", InputSchema: json.RawMessage(`{"type":"object","required":["command"],"properties":{"command":{"type":"string"},"wait_ms":{"type":"integer","maximum":600000}},"additionalProperties":false}`)}}
	for _, tc := range []struct{ args, path, keyword, expected string }{
		{`{"command":"private-command","wait_ms":600001}`, "/wait_ms", "maximum", "600000"},
		{`{"command":"private-command","wait_ms":"private-secret"}`, "/wait_ms", "type", "integer"},
		{`{}`, "/command", "required", ""},
		{`{"command":"private-command","private-property":true}`, "", "additionalProperties", ""},
	} {
		_, err := attemptValidation(attemptSnapshot{Tools: []agentcore.ToolSpec{tool}}, modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "test", Name: "exec", Arguments: tc.args}}}})
		d := diagnostic.From(err)
		if d == nil || d.ToolName != "exec" || d.ToolIndex != 1 || d.FieldPath != tc.path || d.Constraint != tc.keyword || d.Expected != tc.expected {
			t.Fatalf("unexpected detail %+v", d)
		}
		raw, _ := json.Marshal(d)
		if strings.Contains(string(raw), "private") {
			t.Fatal("argument value leaked", string(raw))
		}
	}
}

func TestRejectedToolPreviewIsBoundedAndNotExecutable(t *testing.T) {
	calls := []modelcore.ToolCall{{Name: "write_file", Arguments: strings.Repeat("文", 300)}}
	rows := rejectedTools(calls)
	if len(rows) != 1 || !rows[0].Truncated || len(rows[0].ArgumentsText) > 512 || !json.Valid([]byte(`"`+rows[0].ArgumentsText+`"`)) {
		t.Fatal(rows)
	}
	if calls[0].Arguments != strings.Repeat("文", 300) {
		t.Fatal("mutated executable response")
	}
}
