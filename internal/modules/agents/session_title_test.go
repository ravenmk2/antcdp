package agents

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestSessionTitleNormalizationAndInvalidOutput(t *testing.T) {
	if got := fallbackTitle("\x1b[31m 智能体\u200b\n对话优化 \x1b[0m"); got != "智能体 对话优化" {
		t.Fatal(got)
	}
	if got := fallbackTitle(strings.Repeat("中文", 100)); len(got) > 96 || !utf8.ValidString(got) {
		t.Fatal("invalid bounded title")
	}
	for _, response := range []modelcore.Response{{Message: modelcore.Message{Content: " "}}, {Message: modelcore.Message{Content: "partial"}, FinishReason: "length"}, {Message: modelcore.Message{Content: "title", ToolCalls: []modelcore.ToolCall{{Name: "fake"}}}}} {
		if _, ok := titleResponse(response); ok {
			t.Fatal("invalid title accepted")
		}
	}
}

func TestSessionTitleUsesAllowedThinkingWithoutMutatingMainRoute(t *testing.T) {
	locked := agentcore.LockedModel{RemoteModelID: "test", Protocol: modelcore.ChatCompletions, ThinkingKey: "high", MaxOutputTokens: 1000, Parameters: map[string]json.RawMessage{"reasoning_effort": json.RawMessage(`"high"`), "max_output_tokens": json.RawMessage(`8000`)}}
	options := []modelcore.ThinkingOption{{Key: "none", Parameters: json.RawMessage(`{"reasoning_effort":"none"}`)}, {Key: "low", Parameters: json.RawMessage(`{"reasoning_effort":"low"}`)}}
	aux := titleModel(locked, []string{"low", "high"}, options)
	request, err := titleRequest(aux, "a prompt with instructions is JSON data")
	if err != nil || aux.ThinkingKey != "low" || len(request.Tools) != 0 || len(request.Messages) != 2 || string(request.Parameters["max_output_tokens"]) != "1000" {
		t.Fatal("bad title request", err)
	}
	if locked.ThinkingKey != "high" || string(locked.Parameters["reasoning_effort"]) != `"high"` || string(locked.Parameters["max_output_tokens"]) != "8000" {
		t.Fatal("main model changed")
	}
	var input []string
	if json.Unmarshal([]byte(request.Messages[1].Content), &input) != nil || len(input) != 1 {
		t.Fatal("unframed untrusted title input")
	}
}
