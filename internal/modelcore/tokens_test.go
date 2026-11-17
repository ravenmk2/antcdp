package modelcore

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRequestEstimatePricesNativeOnceAndIgnoresLocalMetadata(t *testing.T) {
	native, _ := json.Marshal(map[string]any{"role": "assistant", "content": strings.Repeat("verified result ", 1000), "reasoning_content": "thinking", "tool_calls": []any{}})
	request := Request{Messages: []Message{{Role: "assistant", Native: native, NativeProtocol: ChatCompletions}}}
	base, err := EstimateRequestTokens(request)
	if err != nil {
		t.Fatal(err)
	}
	request.Messages[0].Content = strings.Repeat("duplicate result", 2000)
	request.Messages[0].Reasoning = strings.Repeat("duplicate reasoning", 2000)
	request.Messages[0].ToolCalls = []ToolCall{{Name: "duplicated", Arguments: strings.Repeat("x", 1000)}}
	request.Messages[0].PrefixDigest = strings.Repeat("a", 64)
	request.Parameters = map[string]json.RawMessage{"max_output_tokens": json.RawMessage(`100000`)}
	got, err := EstimateRequestTokens(request)
	if err != nil || got != base || got >= uint64(len(native))/2 {
		t.Fatal("native counted twice or byte priced", base, got, err)
	}
}

func TestRequestEstimatePricesUnicodeToolsAndImages(t *testing.T) {
	if TextTokens("abcd") != 1 || TextTokens("中文内容") != 4 {
		t.Fatal("text density")
	}
	request := Request{Messages: []Message{{Role: "user", Content: "inspect"}}}
	base, _ := EstimateRequestTokens(request)
	request.Tools = []Tool{{Name: "read", Description: "read a file", InputSchema: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}}}`)}}
	withTool, err := EstimateRequestTokens(request)
	if err != nil || withTool <= base {
		t.Fatal("tool schema omitted", err)
	}
	request.Messages[0].Images = []ImagePart{{Width: 1024, Height: 1024, DataBase64: strings.Repeat("z", 100000), FileID: "file-1"}}
	image, _ := EstimateRequestTokens(request)
	request.Messages[0].Images[0].DataBase64 = ""
	request.Messages[0].Images[0].FileID = "another-transport"
	file, _ := EstimateRequestTokens(request)
	if image != file || image-withTool != EstimateImageTokens(request.Messages[0].Images[0]) {
		t.Fatal("image transport changed visual price")
	}
}
