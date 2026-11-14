package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestCustomAuthorizationIsSentVerbatim(t *testing.T) {
	server := sdk.NewServer(&sdk.Implementation{Name: "custom-auth", Version: "1"}, nil)
	handler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return server }, &sdk.StreamableHTTPOptions{JSONResponse: true})
	var received atomic.Bool
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token fixture-value" {
			t.Error("custom credential changed")
		}
		received.Store(true)
		handler.ServeHTTP(w, r)
	}))
	defer remote.Close()
	config := Config{URL: remote.URL, AuthMethod: "custom_header", HeaderName: "Authorization", Secret: "Token fixture-value", Timeout: time.Second, RequestedProtocolVersions: []string{"2025-11-25"}}
	client := newClient(config, remote.Client())
	result, e := client.Discover(t.Context())
	if e != nil || len(result.Tools) != 0 || !received.Load() {
		t.Fatal("empty tool discovery failed", e)
	}
}
func TestDescriptionChangeInvalidatesFrozenTool(t *testing.T) {
	client, server, count, _, _ := fixture(t, "2026-07-28", true)
	found, e := client.Discover(t.Context())
	if e != nil {
		t.Fatal(e)
	}
	server.AddTool(&sdk.Tool{Name: "echo", Description: "changed meaning", InputSchema: found.Tools[0].InputSchema}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		count.Add(1)
		return &sdk.CallToolResult{}, nil
	})
	result, e := client.Call(t.Context(), CallRequest{RemoteName: "echo", Fingerprint: found.Tools[0].Fingerprint, Arguments: json.RawMessage(`{"value":"hello"}`), ResultLimit: 4096})
	testError(t, e, "MCP_SCHEMA_CHANGED")
	if count.Load() != 0 || result.Executed == nil || *result.Executed {
		t.Fatal("changed definition executed")
	}
}
func TestModelToolNamesAreStableBoundedAndNamespaced(t *testing.T) {
	name := ModelToolName(^uint64(0), "工具/with spaces")
	if len(name) > 64 || name != ModelToolName(^uint64(0), "工具/with spaces") || name == ModelToolName(1, "工具/with spaces") || name == ModelToolName(^uint64(0), "工具/With spaces") {
		t.Fatal(name)
	}
}
