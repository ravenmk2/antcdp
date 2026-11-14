package modeladapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func testRequest(protocol modelcore.Protocol) modelcore.Request {
	return modelcore.Request{Model: "verification-model", Protocol: protocol, Messages: []modelcore.Message{{Role: "user", Content: "Hello"}}, Parameters: map[string]json.RawMessage{"max_output_tokens": json.RawMessage("256")}}
}

const chatToolStream = `data: {"model":"verified-model","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"retain reasoning"}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\"value\":"}}]}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"OK\"}"}}]},"finish_reason":"tool_calls"}]}

data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":7,"prompt_cache_hit_tokens":12}}

data: [DONE]

`

const messagesToolStream = `event: message_start
data: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","model":"verified-model","content":[],"usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":12,"cache_creation_input_tokens":3}}}

data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"retain reasoning"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"opaque-signature"}}

data: {"type":"content_block_stop","index":0}

data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"echo","input":{},"cache_control":{"type":"ephemeral"}}}

data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"value\":\"OK\"}"}}

data: {"type":"content_block_stop","index":1}

data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":7}}

data: {"type":"message_stop"}

`

func TestProtocolsPreserveNativeReplayAndUsage(t *testing.T) {
	for _, tc := range []struct {
		protocol     modelcore.Protocol
		path, stream string
	}{{modelcore.ChatCompletions, "/chat/completions", chatToolStream}, {modelcore.AnthropicMessages, "/anthropic/v1/messages", messagesToolStream}} {
		t.Run(string(tc.protocol), func(t *testing.T) {
			var captured []json.RawMessage
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path {
					t.Errorf("path=%s", r.URL.Path)
				}
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				_ = json.Unmarshal(body["messages"], &captured)
				if tc.protocol == modelcore.ChatCompletions && r.Header.Get("Authorization") != "Bearer synthetic-key" {
					t.Error("missing chat auth")
				}
				if tc.protocol == modelcore.AnthropicMessages && r.Header.Get("x-api-key") != "synthetic-key" {
					t.Error("missing messages auth")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprint(w, tc.stream)
			}))
			defer server.Close()
			client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: tc.protocol, BaseURL: server.URL, APIKey: "synthetic-key"}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			request := testRequest(tc.protocol)
			var deltas []modelcore.Delta
			response, err := client.Generate(t.Context(), request, func(delta modelcore.Delta) error { deltas = append(deltas, delta); return nil })
			if err != nil {
				t.Fatal(err)
			}
			if len(response.Message.ToolCalls) != 1 || response.Message.ToolCalls[0].Arguments != `{"value":"OK"}` || response.Message.Reasoning != "retain reasoning" {
				t.Fatalf("incorrect response: %+v", response)
			}
			if response.Usage.InputTokens == nil || *response.Usage.InputTokens != 20 || response.Usage.OutputTokens == nil || *response.Usage.OutputTokens != 7 || response.Usage.CacheReadTokens == nil || *response.Usage.CacheReadTokens != 12 {
				t.Fatalf("usage: %+v", response.Usage)
			}
			if len(deltas) == 0 {
				t.Fatal("no stream output")
			}
			persisted, err := json.Marshal(response.Message)
			if err != nil {
				t.Fatal(err)
			}
			var restored modelcore.Message
			if err = json.Unmarshal(persisted, &restored); err != nil {
				t.Fatal(err)
			}
			request.Messages = append(request.Messages, restored, modelcore.Message{Role: "tool", ToolCallID: "call-1", Content: "OK"})
			if _, err = client.Generate(t.Context(), request, nil); err != nil {
				t.Fatal(err)
			}
			if len(captured) != 3 {
				t.Fatalf("message count=%d", len(captured))
			}
			var expected, actual any
			_ = json.Unmarshal(restored.Native, &expected)
			_ = json.Unmarshal(captured[1], &actual)
			a, _ := json.Marshal(expected)
			b, _ := json.Marshal(actual)
			if string(a) != string(b) {
				t.Fatalf("native replay changed: %s", captured[1])
			}
			if tc.protocol == modelcore.AnthropicMessages && (!strings.Contains(string(captured[1]), "opaque-signature") || !strings.Contains(string(captured[1]), "cache_control")) {
				t.Fatal("lost native block fields")
			}
		})
	}
}

func TestTruncatedOrMalformedStreamNeverSucceeds(t *testing.T) {
	for _, tc := range []struct {
		name     string
		protocol modelcore.Protocol
		body     string
	}{{"chat missing terminal", modelcore.ChatCompletions, strings.ReplaceAll(chatToolStream, "data: [DONE]\n\n", "")}, {"messages missing terminal", modelcore.AnthropicMessages, strings.ReplaceAll(messagesToolStream, "data: {\"type\":\"message_stop\"}\n\n", "")}, {"partial tool JSON", modelcore.ChatCompletions, strings.ReplaceAll(chatToolStream, `\"OK\"}`, `\"OK\"`)}, {"length finish", modelcore.ChatCompletions, strings.ReplaceAll(chatToolStream, `"finish_reason":"tool_calls"`, `"finish_reason":"length"`)}} {
		t.Run(tc.name, func(t *testing.T) {
			var err error
			if tc.protocol == modelcore.ChatCompletions {
				_, err = decodeChat(t.Context(), strings.NewReader(tc.body), func(modelcore.Delta) error { return nil })
			} else {
				_, err = decodeMessages(t.Context(), strings.NewReader(tc.body), func(modelcore.Delta) error { return nil })
			}
			if err == nil {
				t.Fatal("incomplete response accepted")
			}
		})
	}
}

func TestChatRejectsNonFunctionToolCalls(t *testing.T) {
	for _, value := range []string{"", `"type":"custom",`, `"type":null,`, `"type":1,`} {
		t.Run(value, func(t *testing.T) {
			body := strings.Replace(chatToolStream, `"type":"function",`, value, 1)
			response, err := decodeChat(t.Context(), strings.NewReader(body), func(modelcore.Delta) error { return nil })
			if !errors.Is(err, modelcore.ErrInvalidResponse) || len(response.Message.ToolCalls) != 0 {
				t.Fatalf("unsupported tool kind accepted: response=%+v, err=%v", response, err)
			}
		})
	}
}

func TestProbeVerifiesToolArguments(t *testing.T) {
	for _, tc := range []struct {
		name, arguments string
		valid           bool
	}{
		{"valid", `{"value":"OK"}`, true},
		{"missing", `{}`, false},
		{"wrong type", `{"value":1}`, false},
		{"wrong value", `{"value":"NO"}`, false},
		{"extra field", `{"value":"OK","extra":true}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				arguments, _ := json.Marshal(tc.arguments)
				_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"verification-1\",\"type\":\"function\",\"function\":{\"name\":\"verification_echo\",\"arguments\":%s}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n", arguments)
			}))
			defer server.Close()
			result, err := Probe(t.Context(), Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: server.URL, APIKey: "synthetic-key"}, ProbeRequest{Kind: "model_probe", Model: "verification-model", Levels: []string{"tools"}})
			if err != nil || result.Diagnostic == nil {
				t.Fatalf("probe failed: result=%+v, err=%v", result, err)
			}
			if tc.valid {
				if result.Diagnostic.Status != "succeeded" || result.Diagnostic.Capabilities.ToolCalling != modelcore.Supported {
					t.Fatalf("valid call not verified: %+v", result.Diagnostic)
				}
			} else if result.Diagnostic.Status != "failed" || result.Diagnostic.Capabilities.ToolCalling != modelcore.Unknown {
				t.Fatalf("invalid call verified: %+v", result.Diagnostic)
			}
		})
	}
}

func TestClientCancellationRedirectAndSafeErrors(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: server.URL, APIKey: "secret-not-in-errors"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Generate(t.Context(), testRequest(modelcore.ChatCompletions), nil)
	var remote *RemoteError
	if !errors.As(err, &remote) || remote.Status != 307 || forwarded.Load() != 0 {
		t.Fatalf("redirect followed: %v", err)
	}
	if strings.Contains(err.Error(), "secret-not-in-errors") || strings.Contains(err.Error(), target.URL) {
		t.Fatal("connection details leaked")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = client.Generate(ctx, testRequest(modelcore.ChatCompletions), nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	streaming := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer streaming.Close()
	client, err = NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: streaming.URL, APIKey: "synthetic-key"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel = context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, err = client.Generate(ctx, testRequest(modelcore.ChatCompletions), func(modelcore.Delta) error { cancel(); return context.Canceled })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("stream cancel=%v", err)
	}
}

func TestNativeProtocolAndEnvelopeRejected(t *testing.T) {
	responseWithHeaders := strings.Replace(chatToolStream, `"role":"assistant"`, `"role":"assistant","headers":{"Authorization":"must-not-save"}`, 1)
	unsafe, decodeErr := decodeChat(t.Context(), strings.NewReader(responseWithHeaders), func(modelcore.Delta) error { return nil })
	if decodeErr == nil || len(unsafe.Message.Native) > 0 {
		t.Fatal("HTTP envelope saved as model content")
	}
	for _, native := range []string{`{"role":"assistant","content":"x","headers":{"Authorization":"secret"}}`, `{"role":"user","content":"x"}`} {
		request := testRequest(modelcore.ChatCompletions)
		request.Messages = []modelcore.Message{{Role: "assistant", NativeProtocol: modelcore.ChatCompletions, Native: json.RawMessage(native)}}
		if _, err := encodeRequest(modelcore.DeepSeek, request); err == nil {
			t.Fatal("unsafe native message accepted")
		}
	}
	request := testRequest(modelcore.ChatCompletions)
	request.Messages[0].Native = json.RawMessage(`{"role":"user","content":"x"}`)
	request.Messages[0].NativeProtocol = modelcore.AnthropicMessages
	if _, err := encodeRequest(modelcore.DeepSeek, request); err == nil {
		t.Fatal("protocol switch accepted")
	}
}

func TestRegistryFiveProvidersAndTypedParameters(t *testing.T) {
	registry := NewRegistry()
	if len(registry.Types()) != 5 {
		t.Fatal("provider directory")
	}
	for _, provider := range registry.Types() {
		for _, protocol := range provider.Protocols {
			if protocol.Verified != modelcore.Unknown {
				t.Fatal("fabricated live verification")
			}
			schema, err := registry.ParameterSchema(provider.Type, protocol.Protocol)
			if err != nil || !json.Valid(schema) {
				t.Fatalf("schema=%s %v", schema, err)
			}
			if err = registry.ValidateParameters(provider.Type, protocol.Protocol, map[string]json.RawMessage{"temperature": json.RawMessage("0.5")}); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, params := range []map[string]json.RawMessage{{"headers": json.RawMessage(`{}`)}, {"temperature": json.RawMessage(`null`)}, {"max_output_tokens": json.RawMessage(`1.5`)}, {"thinking": json.RawMessage(`{"type":"disabled","budget_tokens":10}`)}} {
		if err := registry.ValidateParameters(modelcore.DeepSeek, modelcore.ChatCompletions, params); err == nil {
			t.Fatalf("accepted parameters %v", params)
		}
	}
	if registry.Supports(modelcore.Ollama, modelcore.AnthropicMessages) {
		t.Fatal("unimplemented route offered")
	}
}

func TestAllRegisteredProtocolRoutes(t *testing.T) {
	for _, provider := range NewRegistry().Types() {
		for _, route := range provider.Protocols {
			t.Run(string(provider.Type)+"/"+string(route.Protocol), func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					want := endpointPath(provider.Type, route.Protocol, "")
					if r.URL.Path != want {
						t.Errorf("route %q want %q", r.URL.Path, want)
					}
					var request map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
					}
					if string(request["max_tokens"]) != "256" || string(request["stream"]) != "true" {
						t.Errorf("parameter mapping: %v", request)
					}
					w.Header().Set("Content-Type", "text/event-stream")
					body := chatToolStream
					if route.Protocol == modelcore.AnthropicMessages {
						body = messagesToolStream
					}
					_, _ = fmt.Fprint(w, body)
				}))
				defer server.Close()
				client, err := NewClient(Config{Provider: provider.Type, Protocol: route.Protocol, BaseURL: server.URL, APIKey: "synthetic-key"}, nil)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = client.Generate(t.Context(), testRequest(route.Protocol), nil); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestStreamLimitsUnknownFieldsAndMissingUsage(t *testing.T) {
	unknown := strings.Replace(chatToolStream, `"role":"assistant"`, `"role":"assistant","provider_content_extension":{"opaque":"retained"}`, 1)
	response, err := decodeChat(t.Context(), strings.NewReader(unknown), func(modelcore.Delta) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(response.Message.Native), "provider_content_extension") {
		t.Fatal("unknown content field dropped")
	}
	missingUsage := "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
	response, err = decodeChat(t.Context(), strings.NewReader(missingUsage), func(modelcore.Delta) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if response.Usage.InputTokens != nil || response.Usage.OutputTokens != nil || response.Usage.CacheReadTokens != nil {
		t.Fatal("missing usage fabricated")
	}
	frame, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": strings.Repeat("x", modelcore.MaxMessageBytes)}}}})
	_, err = decodeChat(t.Context(), strings.NewReader("data: "+string(frame)+"\n\ndata: [DONE]\n\n"), func(modelcore.Delta) error { return nil })
	if err == nil {
		t.Fatal("oversized output accepted")
	}
}

func TestMessagesRejectUnsupportedDeltaRatherThanLosingNativeContent(t *testing.T) {
	body := strings.Replace(messagesToolStream, `"type":"thinking_delta","thinking":"retain reasoning"`, `"type":"new_native_delta","encrypted":"opaque"`, 1)
	_, err := decodeMessages(t.Context(), strings.NewReader(body), func(modelcore.Delta) error { return nil })
	if !errors.Is(err, modelcore.ErrUnsupported) {
		t.Fatalf("unknown native delta: %v", err)
	}
}

func TestMessagesThinkingAndOrderedToolGroup(t *testing.T) {
	request := testRequest(modelcore.AnthropicMessages)
	request.Parameters["thinking"] = json.RawMessage(`{"type":"enabled"}`)
	request.Parameters["output_config"] = json.RawMessage(`{"effort":"high"}`)
	request.Messages = append(request.Messages, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "one", Name: "echo", Arguments: `{}`}, {ID: "two", Name: "echo", Arguments: `{}`}}}, modelcore.Message{Role: "tool", ToolCallID: "one", Content: "first"}, modelcore.Message{Role: "tool", ToolCallID: "two", Content: "second"}, modelcore.Message{Role: "user", Content: "Continue"})
	raw, err := encodeRequest(modelcore.DeepSeek, request)
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Thinking     json.RawMessage   `json:"thinking"`
		OutputConfig json.RawMessage   `json:"output_config"`
		Messages     []json.RawMessage `json:"messages"`
	}
	if err = json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if string(body.Thinking) != `{"type":"enabled"}` || string(body.OutputConfig) != `{"effort":"high"}` {
		t.Fatalf("thinking changed: %s %s", body.Thinking, body.OutputConfig)
	}
	if len(body.Messages) != 4 {
		t.Fatalf("result group not combined: %s", raw)
	}
	var group struct {
		Role    string `json:"role"`
		Content []struct {
			ID   string `json:"tool_use_id"`
			Text string `json:"content"`
		} `json:"content"`
	}
	if err = json.Unmarshal(body.Messages[2], &group); err != nil {
		t.Fatal(err)
	}
	if group.Role != "user" || len(group.Content) != 2 || group.Content[0].ID != "one" || group.Content[1].ID != "two" {
		t.Fatalf("tool result order/correlation lost: %+v", group)
	}
}

func TestProviderThinkingParametersAreExplicit(t *testing.T) {
	registry := NewRegistry()
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		params := map[string]json.RawMessage{"thinking": json.RawMessage(`{"type":"adaptive"}`)}
		if protocol == modelcore.ChatCompletions {
			params["reasoning_effort"] = json.RawMessage(`"max"`)
		} else {
			params["output_config"] = json.RawMessage(`{"effort":"max"}`)
		}
		if err := registry.ValidateParameters(modelcore.MiniMax, protocol, params); err != nil {
			t.Fatal(err)
		}
		params["thinking"] = json.RawMessage(`{"type":"enabled"}`)
		if err := registry.ValidateParameters(modelcore.MiniMax, protocol, params); err == nil {
			t.Fatal("unregistered MiniMax thinking control")
		}
	}
}
