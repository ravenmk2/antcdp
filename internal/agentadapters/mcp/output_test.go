package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestLargeTextAndStructuredOutputReachRetentionBoundary(t *testing.T) {
	client, server, _, _, _ := fixture(t, "2026-07-28", true)
	text := strings.Repeat("日志😀", 15000) + "TAIL-DIAGNOSTIC"
	server.AddTool(&sdk.Tool{Name: "large", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: text}}, StructuredContent: map[string]any{"diagnostic": "structured-tail"}}, nil
	})
	discovery, err := client.Discover(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var fingerprint string
	for _, tool := range discovery.Tools {
		if tool.RemoteName == "large" {
			fingerprint = tool.Fingerprint
		}
	}
	result, err := client.Call(t.Context(), CallRequest{RemoteName: "large", Fingerprint: fingerprint, Arguments: json.RawMessage(`{}`), ResultLimit: 4 << 20})
	if err != nil || result.Truncated || !strings.Contains(result.Content, "TAIL-DIAGNOSTIC") || !strings.Contains(result.Content, "structured-tail") || len(result.Content) <= 64<<10 {
		t.Fatal("adapter discarded recoverable output", err)
	}
}
