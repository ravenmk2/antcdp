package eino

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"testing/synctest"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func retryHooks() *engineHooks {
	ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
	return &engineHooks{ref: ref, retryPolicy: true, prepare: func(step uint32) agentcore.PreparedStep {
		tool := modelcore.Tool{Name: "effect", InputSchema: json.RawMessage(`{"type":"object"}`)}
		return agentcore.PreparedStep{Ref: ref, Step: step, MaxParallelTools: 1, Tools: []agentcore.ToolSpec{{Definition: tool}}, Request: modelcore.Request{Model: "test", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "fixed"}}, Tools: []modelcore.Tool{tool}}}
	}}
}

func TestRetryDoesNotRepeatCompletedToolOrDispatchPartialTool(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := retryHooks()
		var retried modelcore.Request
		h.client = &scriptedClient{invoke: func(ctx context.Context, n int, req modelcore.Request, emit modelcore.Emit) (modelcore.Response, error) {
			switch n {
			case 1:
				return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "completed", Name: "effect", Arguments: `{}`}}}}, nil
			case 2:
				retried = req
				if err := emit(modelcore.Delta{Kind: "tool_call", Text: "partial"}); err != nil {
					return modelcore.Response{}, err
				}
				return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "discarded", ToolCalls: []modelcore.ToolCall{{ID: "partial", Name: "effect", Arguments: `{}`}}}}, modelcore.ErrIncompleteStream
			default:
				if !reflect.DeepEqual(req, retried) {
					t.Fatal("retry changed prepared request")
				}
				return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "recovered"}}, nil
			}
		}}
		if err := (Engine{}).Execute(t.Context(), h.ref, h); err != nil {
			t.Fatal(err)
		}
		if len(h.dispatch) != 1 || h.dispatch[0].Call.ID != "completed" || len(h.prepared) != 2 || len(h.commits) != 3 || !h.commits[1].StreamStarted {
			t.Fatalf("unexpected execution: %+v", h)
		}
	})
}

func TestRetryExhaustionAndCancellationDuringBackoff(t *testing.T) {
	for _, mode := range []string{"exhausted", "stop", "deadline", "emit failure", "commit failure"} {
		t.Run(mode, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				h := retryHooks()
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				if mode == "deadline" {
					var c context.CancelFunc
					ctx, c = context.WithTimeout(ctx, 100*time.Millisecond)
					defer c()
				}
				if mode == "stop" {
					h.onCommit = func() { time.AfterFunc(100*time.Millisecond, cancel) }
				}
				if mode == "emit failure" {
					h.emitError = modelcore.ErrTransport
				}
				if mode == "commit failure" {
					h.commitError = errors.New("database unavailable")
				}
				h.client = &scriptedClient{invoke: func(_ context.Context, _ int, _ modelcore.Request, emit modelcore.Emit) (modelcore.Response, error) {
					if mode == "emit failure" {
						return modelcore.Response{}, emit(modelcore.Delta{Kind: "text", Text: "partial"})
					}
					return modelcore.Response{}, modelcore.ErrTransport
				}}
				err := (Engine{}).Execute(ctx, h.ref, h)
				want := 1
				if mode == "exhausted" {
					want = 6
				}
				if err == nil || len(h.commits) != want || len(h.prepared) != 1 || len(h.dispatch) != 0 {
					t.Fatalf("err=%v commits=%d prepares=%d", err, len(h.commits), len(h.prepared))
				}
				if mode == "stop" && !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
				if mode == "deadline" && !errors.Is(err, context.DeadlineExceeded) {
					t.Fatal(err)
				}
			})
		})
	}
}
