package eino

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type engineHooks struct {
	ref            agentcore.ExecutionRef
	client         modelcore.Client
	prepare        func(uint32) agentcore.PreparedStep
	prepared       []uint32
	commits        []agentcore.AttemptOutcome
	dispatch       []agentcore.PreparedToolCall
	commitError    error
	durableFailure error
	dispatchError  error
	retry          bool
}

func (h *engineHooks) PrepareStep(_ context.Context, _ agentcore.ExecutionRef, step uint32) (agentcore.PreparedStep, error) {
	h.prepared = append(h.prepared, step)
	return h.prepare(step), nil
}
func (h *engineHooks) BeginAttempt(_ context.Context, step agentcore.PreparedStep, attempt uint32) (agentcore.AttemptPermit, error) {
	return agentcore.AttemptPermit{Ref: h.ref, Step: step.Step, Attempt: attempt, CallID: agentcore.ID(len(h.commits) + 1), Client: h.client, Deadline: time.Now().Add(time.Second)}, nil
}
func (h *engineHooks) CompleteAttempt(_ context.Context, permit agentcore.AttemptPermit, out agentcore.AttemptOutcome) (agentcore.AttemptCommit, error) {
	h.commits = append(h.commits, out)
	commit := agentcore.AttemptCommit{Response: out.Response, Retry: out.Err != nil && h.retry, Failure: h.durableFailure}
	if h.commitError != nil {
		return commit, h.commitError
	}
	if out.Err == nil {
		for n, call := range out.Response.Message.ToolCalls {
			commit.Calls = append(commit.Calls, agentcore.PreparedToolCall{Ref: h.ref, ID: agentcore.ID(100 + n), ModelCallID: permit.CallID, Step: permit.Step, Ordinal: uint32(n), Call: call, Spec: agentcore.ToolSpec{ParallelSafe: false}})
		}
	}
	return commit, nil
}
func (h *engineHooks) InvokeTool(_ context.Context, call agentcore.PreparedToolCall) (agentcore.ToolCompletion, error) {
	h.dispatch = append(h.dispatch, call)
	if h.dispatchError != nil {
		return agentcore.ToolCompletion{}, h.dispatchError
	}
	return agentcore.ToolCompletion{Status: "succeeded", Content: "OK", Receipt: agentcore.CommitReceipt{ToolCallID: call.ID, ToolResultSessionID: h.ref.SessionID, ToolResultSeq: 3, Ranges: []agentcore.EventRange{{SessionID: h.ref.SessionID, From: 3, Through: 3}}}}, nil
}
func (*engineHooks) Emit(context.Context, agentcore.AttemptPermit, modelcore.Delta) error { return nil }

func TestEngineDynamicStepUsesDurableNativeHistory(t *testing.T) {
	ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
	first := modelcore.Message{Role: "assistant", Content: "check", ToolCalls: []modelcore.ToolCall{{ID: "a", Name: "first", Arguments: `{}`}}, NativeProtocol: modelcore.ChatCompletions, Native: json.RawMessage(`{"role":"assistant","content":"check","opaque":"preserve"}`)}
	h := &engineHooks{ref: ref}
	h.prepare = func(step uint32) agentcore.PreparedStep {
		name := "first"
		messages := []modelcore.Message{{Role: "user", Content: "task"}}
		if step == 2 {
			name = "new_dynamic"
			messages = append(messages, first, modelcore.Message{Role: "tool", ToolCallID: "a", Content: "committed result"}, modelcore.Message{Role: "user", Content: "late steer"})
		}
		if step == 3 {
			messages = []modelcore.Message{{Role: "user", Content: "compacted durable surface"}}
		}
		tool := modelcore.Tool{Name: name, InputSchema: json.RawMessage(`{"type":"object"}`)}
		return agentcore.PreparedStep{Ref: ref, Step: step, MaxParallelTools: 1, Tools: []agentcore.ToolSpec{{Definition: tool}}, Request: modelcore.Request{Model: "test", Protocol: modelcore.ChatCompletions, Messages: messages, Tools: []modelcore.Tool{tool}}}
	}
	h.client = &scriptedClient{invoke: func(_ context.Context, step int, request modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
		if step == 1 {
			return modelcore.Response{Message: first}, nil
		}
		if step == 2 {
			if len(request.Messages) != 4 || !reflect.DeepEqual(request.Messages[1].Native, first.Native) || request.Messages[3].Content != "late steer" || request.Tools[0].Name != "new_dynamic" {
				t.Fatalf("dynamic surface lost: %+v", request)
			}
			return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "b", Name: "new_dynamic", Arguments: `{}`}}}}, nil
		}
		if request.Messages[0].Content != "compacted durable surface" {
			t.Fatal("framework appended stale internal history")
		}
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "done"}}, nil
	}}
	if err := (Engine{MaxSteps: 5}).Execute(t.Context(), ref, h); err != nil {
		t.Fatal(err)
	}
	if len(h.dispatch) != 2 || len(h.prepared) != 3 || len(h.commits) != 3 {
		t.Fatalf("prepare=%v calls=%d commits=%d", h.prepared, len(h.dispatch), len(h.commits))
	}
}

func TestEngineRetryDoesNotRepeatPreStepAndCommitFailureNeverDispatches(t *testing.T) {
	ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
	prepare := func(step uint32) agentcore.PreparedStep {
		return agentcore.PreparedStep{Ref: ref, Step: step, MaxParallelTools: 1, Request: modelcore.Request{Model: "test", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "fixed"}}}}
	}
	h := &engineHooks{ref: ref, prepare: prepare, retry: true}
	h.client = &scriptedClient{invoke: func(_ context.Context, n int, _ modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
		if n == 1 {
			return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "partial"}}, modelcore.ErrIncompleteStream
		}
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "complete"}}, nil
	}}
	if err := (Engine{}).Execute(t.Context(), ref, h); err != nil {
		t.Fatal(err)
	}
	if len(h.prepared) != 1 || len(h.commits) != 2 || h.commits[0].Err == nil {
		t.Fatal("retry repeated admission or lost failed attempt")
	}
	h = &engineHooks{ref: ref, prepare: prepare, commitError: errors.New("commit failed")}
	h.client = &scriptedClient{invoke: func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "a", Name: "unsafe", Arguments: `{}`}}}}, nil
	}}
	if err := (Engine{}).Execute(t.Context(), ref, h); !errors.Is(err, h.commitError) || len(h.dispatch) != 0 {
		t.Fatalf("commit bypass: %v", err)
	}
}

func TestEngineDurablyRejectedOutputDoesNotDispatchOrRetry(t *testing.T) {
	ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
	h := &engineHooks{ref: ref, durableFailure: modelcore.ErrOutputLimit, retry: true}
	h.prepare = func(step uint32) agentcore.PreparedStep {
		return agentcore.PreparedStep{Ref: ref, Step: step, MaxParallelTools: 1, Request: modelcore.Request{Model: "test", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "task"}}}}
	}
	h.client = &scriptedClient{invoke: func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "a", Name: "mutation", Arguments: `{}`}}}}, nil
	}}
	err := (Engine{}).Execute(t.Context(), ref, h)
	if !errors.Is(err, modelcore.ErrOutputLimit) || len(h.commits) != 1 || len(h.dispatch) != 0 {
		t.Fatalf("durable rejection resumed: err=%v commits=%d dispatches=%d", err, len(h.commits), len(h.dispatch))
	}
}

func TestEngineHumanWaitEndsTurnWithoutAnotherModelCall(t *testing.T) {
	ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
	h := &engineHooks{ref: ref, dispatchError: agentcore.ErrWaitingInput}
	h.prepare = func(step uint32) agentcore.PreparedStep {
		tool := modelcore.Tool{Name: "question", InputSchema: json.RawMessage(`{"type":"object"}`)}
		return agentcore.PreparedStep{Ref: ref, Step: step, MaxParallelTools: 1, Tools: []agentcore.ToolSpec{{Definition: tool}}, Request: modelcore.Request{Model: "test", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "task"}}, Tools: []modelcore.Tool{tool}}}
	}
	h.client = &scriptedClient{invoke: func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "ask", Name: "question", Arguments: `{}`}}}}, nil
	}}
	err := (Engine{}).Execute(t.Context(), ref, h)
	if !errors.Is(err, agentcore.ErrWaitingInput) || len(h.commits) != 1 || len(h.prepared) != 1 {
		t.Fatalf("human wait did not end this turn: err=%v calls=%d steps=%d", err, len(h.commits), len(h.prepared))
	}
}

func TestAttemptFailureDistinguishesTransportDeadlineAndCancellation(t *testing.T) {
	ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
	for _, tc := range []struct {
		name      string
		cause     error
		code      string
		cancelled bool
	}{
		{"transport", modelcore.ErrTransportTimeout, "", false},
		{"attempt deadline", context.DeadlineExceeded, "MODEL_ATTEMPT_TIMEOUT", false},
		{"cancellation", context.Canceled, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := &engineHooks{ref: ref}
			h.client = &scriptedClient{invoke: func(context.Context, int, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
				return modelcore.Response{}, tc.cause
			}}
			m := executionModel{ref: ref, hooks: h, prepared: agentcore.PreparedStep{Ref: ref, Step: 1}, maxAttempts: 1}
			_, err := m.Generate(t.Context(), nil)
			if len(h.commits) != 1 || h.commits[0].Cancelled != tc.cancelled || len(h.dispatch) != 0 {
				t.Fatalf("incorrect durable classification: %+v", h.commits)
			}
			if tc.code != "" {
				var classified *agentcore.Error
				if !errors.As(err, &classified) || classified.Code != tc.code {
					t.Fatalf("attempt deadline not distinguished: %v", err)
				}
			} else if !errors.Is(err, tc.cause) {
				t.Fatalf("original cause lost: %v", err)
			}
		})
	}
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	h := &engineHooks{ref: ref, client: &scriptedClient{invoke: func(ctx context.Context, _ int, _ modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
		<-ctx.Done()
		return modelcore.Response{}, ctx.Err()
	}}}
	m := executionModel{ref: ref, hooks: h, prepared: agentcore.PreparedStep{Ref: ref, Step: 1}, maxAttempts: 1}
	_, err := m.Generate(ctx, nil)
	if !errors.Is(err, context.DeadlineExceeded) || len(h.commits) != 1 || h.commits[0].Cancelled {
		t.Fatalf("root deadline misclassified: err=%v commits=%+v", err, h.commits)
	}
}
