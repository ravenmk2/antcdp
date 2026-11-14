package eino

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type scriptedClient struct {
	call   int
	invoke func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error)
}

func TestFrameworkRoundTripPreservesInternalToolImage(t *testing.T) {
	message := modelcore.Message{Role: "tool", ToolCallID: "image", Content: "snapshot", Images: []modelcore.ImagePart{{MIME: "image/png", ContentSHA256: "hash", DataBase64: "Ynl0ZXM=", Origin: "tool_image"}}}
	framework, err := toFramework(message)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := fromFramework(framework)
	if err != nil || !reflect.DeepEqual(message, replayed) {
		t.Fatalf("image replay lost: %+v %v", replayed, err)
	}
	serialized, err := json.Marshal(replayed)
	if err != nil || string(serialized) == "" {
		t.Fatal(err)
	}
	var private modelcore.Message
	if json.Unmarshal(serialized, &private) != nil || private.Images[0].DataBase64 != "" || private.Images[0].Origin != "tool_image" {
		t.Fatal("hydrated bytes leaked to persistence")
	}
}

func (m *scriptedClient) Generate(ctx context.Context, request modelcore.Request, emit modelcore.Emit) (modelcore.Response, error) {
	m.call++
	return m.invoke(ctx, m.call, request, emit)
}

func TestADKLoopCommitsBeforeDispatchAndPreservesNativeHistory(t *testing.T) {
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		t.Run(string(protocol), func(t *testing.T) {
			native := json.RawMessage(`{"role":"assistant","content":null,"reasoning_content":"keep exactly","tool_calls":[{"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\"value\":\"OK\"}"}}]}`)
			if protocol == modelcore.AnthropicMessages {
				native = json.RawMessage(`{"role":"assistant","content":[{"type":"thinking","thinking":"keep exactly","signature":"opaque"},{"type":"tool_use","id":"call-1","name":"echo","input":{"value":"OK"}}]}`)
			}
			var order []string
			client := &scriptedClient{invoke: func(_ context.Context, step int, request modelcore.Request, emit modelcore.Emit) (modelcore.Response, error) {
				order = append(order, "model")
				if step == 1 {
					if err := emit(modelcore.Delta{Kind: "reasoning", BlockIndex: 0, Text: "keep exactly"}); err != nil {
						return modelcore.Response{}, err
					}
					return modelcore.Response{Message: modelcore.Message{Role: "assistant", Reasoning: "keep exactly", ToolCalls: []modelcore.ToolCall{{ID: "call-1", Name: "echo", Arguments: `{"value":"OK"}`}}, NativeProtocol: protocol, Native: native}}, nil
				}
				if len(request.Messages) != 3 {
					t.Fatalf("history length %d", len(request.Messages))
				}
				if !reflect.DeepEqual(request.Messages[1].Native, native) || request.Messages[1].NativeProtocol != protocol {
					t.Fatalf("native history was rewritten: %s", request.Messages[1].Native)
				}
				if request.Messages[2].Role != "tool" || request.Messages[2].ToolCallID != "call-1" || request.Messages[2].Content != "OK" {
					t.Fatalf("tool correlation lost: %+v", request.Messages[2])
				}
				return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "Done"}}, nil
			}}
			result, err := Run(t.Context(), RunConfig{Client: client, Request: modelcore.Request{Model: "model", Protocol: protocol, Messages: []modelcore.Message{{Role: "user", Content: "verify"}}, Tools: []modelcore.Tool{{Name: "echo", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}`)}}}, MaxSteps: 3, Hooks: Hooks{BeforeModel: func(context.Context, int, modelcore.Request) error { order = append(order, "prepare"); return nil }, CommitModel: func(context.Context, int, modelcore.Response) error { order = append(order, "commit"); return nil }, Dispatch: func(_ context.Context, invocation ToolInvocation) (string, error) {
				order = append(order, "dispatch")
				if invocation.Step != 1 || invocation.Call.ID != "call-1" {
					t.Fatalf("unbound invocation: %+v", invocation)
				}
				return "OK", nil
			}, Emit: func(context.Context, int, modelcore.Delta) error { order = append(order, "stream"); return nil }}})
			if err != nil {
				t.Fatal(err)
			}
			if result.Message.Content != "Done" || client.call != 2 {
				t.Fatalf("loop result %+v calls %d", result, client.call)
			}
			want := []string{"prepare", "model", "stream", "commit", "dispatch", "prepare", "model", "commit"}
			if !reflect.DeepEqual(order, want) {
				t.Fatalf("order %v", order)
			}
		})
	}
}

func TestCommitFailurePreventsAnyToolDispatch(t *testing.T) {
	commitErr := errors.New("durable commit rejected")
	client := &scriptedClient{invoke: func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-1", Name: "echo", Arguments: `{}`}}}}, nil
	}}
	dispatched := false
	_, err := Run(t.Context(), RunConfig{Client: client, Request: modelcore.Request{Model: "model", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "test"}}, Tools: []modelcore.Tool{{Name: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)}}}, MaxSteps: 2, Hooks: Hooks{BeforeModel: func(context.Context, int, modelcore.Request) error { return nil }, CommitModel: func(context.Context, int, modelcore.Response) error { return commitErr }, Dispatch: func(context.Context, ToolInvocation) (string, error) { dispatched = true; return "", nil }}})
	if !errors.Is(err, commitErr) || dispatched || client.call != 1 {
		t.Fatalf("error=%v dispatched=%v calls=%d", err, dispatched, client.call)
	}
}

func TestCancellationAndStepLimitDoNotRetry(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	client := &scriptedClient{invoke: func(ctx context.Context, _ int, _ modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
		cancel()
		return modelcore.Response{}, ctx.Err()
	}}
	committed := false
	_, err := Run(ctx, RunConfig{Client: client, Request: modelcore.Request{Model: "model", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "test"}}}, MaxSteps: 2, Hooks: Hooks{BeforeModel: func(context.Context, int, modelcore.Request) error { return nil }, CommitModel: func(context.Context, int, modelcore.Response) error { committed = true; return nil }}})
	if !errors.Is(err, context.Canceled) || committed || client.call != 1 {
		t.Fatalf("cancel err=%v calls=%d committed=%v", err, client.call, committed)
	}
	client = &scriptedClient{invoke: func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-1", Name: "echo", Arguments: `{}`}}}}, nil
	}}
	_, err = Run(t.Context(), RunConfig{Client: client, Request: modelcore.Request{Model: "model", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "test"}}, Tools: []modelcore.Tool{{Name: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)}}}, MaxSteps: 1, Hooks: Hooks{BeforeModel: func(context.Context, int, modelcore.Request) error { return nil }, CommitModel: func(context.Context, int, modelcore.Response) error { return nil }, Dispatch: func(context.Context, ToolInvocation) (string, error) { return "ok", nil }}})
	if err == nil || client.call != 1 {
		t.Fatalf("unbounded loop err=%v calls=%d", err, client.call)
	}
}
