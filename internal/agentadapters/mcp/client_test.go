package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func testError(t *testing.T, err error, want string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != want {
		t.Fatalf("error %v want %s", err, want)
	}
}
func fixture(t *testing.T, version string, jsonResponse bool) (*Client, *sdk.Server, *atomic.Int32, *[]string, *sync.Mutex) {
	t.Helper()
	count := &atomic.Int32{}
	methods := &[]string{}
	mu := &sync.Mutex{}
	server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, &sdk.ServerOptions{SupportedProtocolVersions: []string{version}})
	server.AddTool(&sdk.Tool{Name: "echo", Description: "echo controlled input", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}`)}, func(_ context.Context, req *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		count.Add(1)
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "accepted"}}}, nil
	})
	handler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return server }, &sdk.StreamableHTTPOptions{Stateless: version == "2026-07-28", JSONResponse: jsonResponse})
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-only-secret" {
			t.Error("missing authentication")
		}
		if r.Method == http.MethodGet {
			t.Error("unexpected standalone SSE")
		}
		if r.Body != nil {
			raw, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(raw))
			var rpc struct {
				Method string `json:"method"`
			}
			_ = json.Unmarshal(raw, &rpc)
			mu.Lock()
			*methods = append(*methods, rpc.Method)
			mu.Unlock()
		}
		if version == "2026-07-28" && r.Header.Get("Mcp-Session-Id") != "" {
			t.Error("modern protocol sent legacy session ID")
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(httpServer.Close)
	config := Config{URL: httpServer.URL, AuthMethod: "bearer", Secret: "test-only-secret", Timeout: 2 * time.Second, RequestedProtocolVersions: []string{version}}
	return newClient(config, httpServer.Client()), server, count, methods, mu
}

func TestProtocolMatrixAndToolSchemaBoundCall(t *testing.T) {
	for _, protocol := range Protocols() {
		for _, jsonResponse := range []bool{true, false} {
			name := protocol.Version + "/sse"
			if jsonResponse {
				name = protocol.Version + "/json"
			}
			t.Run(name, func(t *testing.T) {
				client, _, calls, methods, mu := fixture(t, protocol.Version, jsonResponse)
				discovery, err := client.Discover(t.Context())
				if err != nil {
					t.Fatal(err)
				}
				if discovery.ProtocolVersion != protocol.Version || len(discovery.Tools) != 1 {
					t.Fatalf("discovery %+v", discovery)
				}
				tool := discovery.Tools[0]
				request := CallRequest{RemoteName: "echo", Fingerprint: tool.Fingerprint, Arguments: json.RawMessage(`{"value":"hello"}`), ResultLimit: 4096}
				result, err := client.Call(t.Context(), request)
				if err != nil {
					t.Fatal(err)
				}
				if result.Content != "accepted" || result.Executed == nil || !*result.Executed || calls.Load() != 1 {
					t.Fatalf("call %+v/%d", result, calls.Load())
				}
				request.Arguments = json.RawMessage(`{"value":42}`)
				_, err = client.Call(t.Context(), request)
				testError(t, err, "MCP_ARGUMENTS_INVALID")
				if calls.Load() != 1 {
					t.Fatal("invalid parameters dispatched")
				}
				mu.Lock()
				defer mu.Unlock()
				first := (*methods)[0]
				if protocol.Lifecycle == "stateless" && first != "server/discover" || protocol.Lifecycle == "initialize" && first != "initialize" {
					t.Fatalf("wrong lifecycle %v", *methods)
				}
			})
		}
	}
}

func TestChangedSchemaNeverCallsOldBinding(t *testing.T) {
	client, server, count, _, _ := fixture(t, "2026-07-28", true)
	discovery, err := client.Discover(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	server.AddTool(&sdk.Tool{Name: "echo", InputSchema: json.RawMessage(`{"type":"object","properties":{"new_value":{"type":"string"}},"required":["new_value"]}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		count.Add(1)
		return &sdk.CallToolResult{}, nil
	})
	result, err := client.Call(t.Context(), CallRequest{RemoteName: "echo", Fingerprint: discovery.Tools[0].Fingerprint, Arguments: json.RawMessage(`{"value":"hello"}`), ResultLimit: 1024})
	testError(t, err, "MCP_SCHEMA_CHANGED")
	if count.Load() != 0 || result.Executed == nil || *result.Executed {
		t.Fatal("stale schema executed")
	}
}

func TestSchemasRejectNetworkCyclesAndDeepInputs(t *testing.T) {
	for _, raw := range []string{`{"type":"object","$ref":"https://example.com/schema.json"}`, `{"type":"object","$defs":{"x":{"$ref":"#/$defs/x"}},"properties":{"a":{"$ref":"#/$defs/x"}}}`, `{"type":"object","properties":{"a":{"type":"string","x-mcp-header":"Authorization"}}}`, `{"type":"object","unknownValidation":true}`} {
		if _, err := ValidateSchema(json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	valid := json.RawMessage(`{"type":"object","$defs":{"word":{"type":"string","minLength":2}},"properties":{"a":{"$ref":"#/$defs/word"}},"required":["a"],"additionalProperties":false}`)
	if err := ValidateArguments(valid, json.RawMessage(`{"a":"yes"}`)); err != nil {
		t.Fatal(err)
	}
	if err := ValidateArguments(valid, json.RawMessage(`{"a":"x"}`)); err == nil {
		t.Fatal("ref constraint ignored")
	}
	deep := `{"a":` + strings.Repeat(`{"a":`, 20) + `1` + strings.Repeat(`}`, 20) + `}`
	if ValidateArguments(json.RawMessage(`{"type":"object"}`), json.RawMessage(deep)) == nil {
		t.Fatal("unbounded arguments")
	}
}

func TestRedirectCannotForwardSecretAndTransportCannotReplayCall(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	config := Config{URL: redirect.URL, AuthMethod: "custom_header", HeaderName: "X-API-Key", Secret: "secret", Timeout: time.Second}
	client := newClient(config, redirect.Client())
	_, err := client.Discover(t.Context())
	if err == nil || forwarded.Load() != 0 || strings.Contains(err.Error(), "secret") {
		t.Fatalf("redirect/leak %v %d", err, forwarded.Load())
	}
	var attempts atomic.Int32
	transport := &guardTransport{config: config, base: roundTripFunc(func(*http.Request) (*http.Response, error) { attempts.Add(1); return nil, errors.New("uncertain send") })}
	for range 2 {
		request, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, config.URL, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{}}}`))
		_, _ = transport.RoundTrip(request)
	}
	if attempts.Load() != 1 {
		t.Fatal("side effect replayed")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestConfigRejectsControlHeadersAndUnimplementedVersions(t *testing.T) {
	config := Config{URL: "https://example.com/mcp", AuthMethod: "custom_header", HeaderName: "X-API-Key", Secret: "secret", Timeout: time.Minute}
	if err := ValidateConfig(config); err != nil {
		t.Fatal(err)
	}
	for _, header := range []string{"Host", "Cookie", "Mcp-Protocol-Version", "Proxy-Authorization", "Content-Length", "X-Key\r\nInjected"} {
		config.HeaderName = header
		if ValidateConfig(config) == nil {
			t.Fatalf("accepted %q", header)
		}
	}
	config.HeaderName = "X-API-Key"
	config.RequestedProtocolVersions = []string{"2024-11-05"}
	testError(t, ValidateConfig(config), "MCP_PROTOCOL_UNSUPPORTED")
}

func TestBrokenCallIsUnknownWithoutSDKReplay(t *testing.T) {
	client, _, _, _, _ := fixture(t, "2026-07-28", true)
	discovery, err := client.Discover(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	base := client.http.Transport
	var calls atomic.Int32
	client.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Body != nil {
			raw, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(raw))
			var rpc struct {
				Method string `json:"method"`
			}
			_ = json.Unmarshal(raw, &rpc)
			if rpc.Method == "tools/call" {
				calls.Add(1)
				return nil, errors.New("response lost after send test-only-secret")
			}
		}
		return base.RoundTrip(r)
	})
	result, err := client.Call(t.Context(), CallRequest{RemoteName: "echo", Fingerprint: discovery.Tools[0].Fingerprint, Arguments: json.RawMessage(`{"value":"a"}`), ResultLimit: 1024})
	if err == nil || result.Executed != nil || calls.Load() != 1 || strings.Contains(err.Error(), "test-only-secret") {
		t.Fatalf("unknown/retry/leak result=%+v err=%v count=%d", result, err, calls.Load())
	}
}

func TestSecretEchoIsNeverReturnedAsToolContent(t *testing.T) {
	client, server, _, _, _ := fixture(t, "2026-07-28", true)
	server.AddTool(&sdk.Tool{Name: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "leaked test-only-secret"}}}, nil
	})
	discovery, err := client.Discover(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Call(t.Context(), CallRequest{RemoteName: "echo", Fingerprint: discovery.Tools[0].Fingerprint, Arguments: json.RawMessage(`{}`), ResultLimit: 1024})
	testError(t, err, "MCP_SECRET_IN_RESPONSE")
	if result.Content != "" || len(result.StructuredContent) > 0 || result.Executed == nil || !*result.Executed {
		t.Fatal("secret echo exposed or remote execution denied")
	}
}
