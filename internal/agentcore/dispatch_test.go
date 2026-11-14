package agentcore

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type toolStoreStub struct {
	mu          sync.Mutex
	call        PreparedToolCall
	await       bool
	prepared    int
	finished    int
	observation DispatchObservation
	completeErr error
	evidence    []ReconciliationEvidence
	waitResult  *ToolCompletion
}

func (s *toolStoreStub) PrepareDispatch(_ context.Context, _ ExecutionRef, id ID) (DispatchAdmission, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prepared++
	if s.waitResult != nil && s.prepared > 1 {
		return DispatchAdmission{Kind: "already_completed", Completion: s.waitResult}, nil
	}
	if s.await {
		return DispatchAdmission{Kind: "await_interaction", InteractionID: pointer(ID(3))}, nil
	}
	call := s.call
	call.ID = id
	return DispatchAdmission{Kind: "execute", Permit: DispatchPermit{Call: call, Token: "fenced-permit", Deadline: time.Now().Add(time.Second)}}, nil
}
func (s *toolStoreStub) CompleteTool(_ context.Context, _ ExecutionRef, result ToolResult) (ToolCommit, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finished++
	s.observation = result.Observation
	if s.completeErr != nil {
		return ToolCommit{}, s.completeErr
	}
	r := CommitReceipt{ToolCallID: result.Call.ID, ToolResultSessionID: result.Call.Ref.SessionID, ToolResultSeq: 5, Ranges: []EventRange{{SessionID: result.Call.Ref.SessionID, From: 5, Through: 5}}}
	return ToolCommit{Receipt: r, Result: ToolCompletion{Status: result.Observation.Status, Executed: result.Observation.Executed, Content: result.Observation.Content, Receipt: r}}, nil
}
func (*toolStoreStub) LookupCompletion(context.Context, ID) (ToolCommit, error) {
	return ToolCommit{}, errors.New("unexpected lookup")
}
func (s *toolStoreStub) RecordReconciliation(_ context.Context, evidence ReconciliationEvidence) (CommitReceipt, error) {
	s.evidence = append(s.evidence, evidence)
	return CommitReceipt{}, nil
}

func TestLateToolObservationDoesNotReviveStoppedTurn(t *testing.T) {
	for _, status := range []string{"succeeded", "outcome_unknown"} {
		t.Run(status, func(t *testing.T) {
			ref := ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "old-worker", Fence: 1}
			call := PreparedToolCall{ID: 4, Ref: ref, Spec: ToolSpec{ExecutionClass: "remote"}}
			fenced := errors.New("turn already ended")
			store := &toolStoreStub{call: call, completeErr: fenced}
			observation := DispatchObservation{Status: status}
			if status == "succeeded" {
				observation.Executed = pointer(true)
			}
			runner, err := NewToolRunner(store, toolDispatchFunc(func(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error) {
				return observation, nil
			}), 1)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = runner.Invoke(t.Context(), ExecutionContext{Ref: ref}, call); !errors.Is(err, fenced) {
				t.Fatal("late result revived the stopped turn", err)
			}
			if status == "outcome_unknown" {
				if len(store.evidence) != 0 {
					t.Fatal("unknown result was presented as verified")
				}
			} else if len(store.evidence) != 1 || store.evidence[0].Ref != ref || store.evidence[0].CallID != call.ID || store.evidence[0].ObservedStatus != status {
				t.Fatal("late known result did not retain its original execution identity")
			}
		})
	}
}

type toolDispatchFunc func(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error)

func (f toolDispatchFunc) Dispatch(ctx context.Context, e ExecutionContext, p DispatchPermit) (DispatchObservation, error) {
	return f(ctx, e, p)
}
func (toolDispatchFunc) Cancel(context.Context, ExecutionContext, PreparedToolCall) error { return nil }

func TestApprovalWaitEndsTurnWithoutDispatching(t *testing.T) {
	ref := ExecutionRef{SessionID: 1, RunID: 2}
	call := PreparedToolCall{ID: 4, Ref: ref, Spec: ToolSpec{ExecutionClass: "remote"}}
	store := &toolStoreStub{call: call, await: true}
	runner, err := NewToolRunner(store, toolDispatchFunc(func(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error) {
		t.Fatal("human wait dispatched a tool")
		return DispatchObservation{}, nil
	}), 1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = runner.Invoke(t.Context(), ExecutionContext{Ref: ref}, call)
	if !errors.Is(err, ErrWaitingInput) || len(runner.Workers) != 0 || store.finished != 0 {
		t.Fatalf("wait did not release worker: %v", err)
	}
	if executionEnd(err).Status != WaitingInput {
		t.Fatal("human wait is not a terminal turn result")
	}
}

func TestQuestionWaitReturnsDurableResultInSameTurn(t *testing.T) {
	ref := ExecutionRef{SessionID: 1, RunID: 2}
	call := PreparedToolCall{ID: 4, Ref: ref, Spec: ToolSpec{ExecutionClass: "question"}}
	for _, content := range []string{`{"answer":{"skip":false}}`, `{"pending":true}`} {
		completion := &ToolCompletion{Status: "succeeded", Content: content, Receipt: CommitReceipt{ToolCallID: 4, ToolResultSessionID: 1, ToolResultSeq: 5, Ranges: []EventRange{{SessionID: 1, From: 5, Through: 5}}}}
		store := &toolStoreStub{call: call, await: true, waitResult: completion}
		runner, err := NewToolRunner(store, toolDispatchFunc(func(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error) {
			t.Fatal("question should be settled by its interaction")
			return DispatchObservation{}, nil
		}), 1)
		if err != nil {
			t.Fatal(err)
		}
		runner.PollInterval = time.Millisecond
		result, err := runner.Invoke(t.Context(), ExecutionContext{Ref: ref}, call)
		if err != nil || result.Content != content || len(runner.Workers) != 0 || store.finished != 0 {
			t.Fatalf("question failed to resume with its durable result: %+v %v", result, err)
		}
	}
}

func TestQuestionWaitCanBeCancelled(t *testing.T) {
	ref := ExecutionRef{SessionID: 1, RunID: 2}
	call := PreparedToolCall{ID: 4, Ref: ref, Spec: ToolSpec{ExecutionClass: "question"}}
	store := &toolStoreStub{call: call, await: true}
	runner, err := NewToolRunner(store, toolDispatchFunc(func(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error) {
		return DispatchObservation{}, nil
	}), 1)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = runner.Invoke(ctx, ExecutionContext{Ref: ref}, call)
	if !errors.Is(err, context.Canceled) || len(runner.Workers) != 0 {
		t.Fatalf("wait did not cancel: %v", err)
	}
}

func TestUnknownDispatchIsCommittedOnce(t *testing.T) {
	ref := ExecutionRef{SessionID: 1, RunID: 2}
	call := PreparedToolCall{ID: 4, Ref: ref, Spec: ToolSpec{ExecutionClass: "remote"}}
	store := &toolStoreStub{call: call}
	dispatches := 0
	runner, err := NewToolRunner(store, toolDispatchFunc(func(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error) {
		dispatches++
		return DispatchObservation{}, errors.New("connection reset after send")
	}), 1)
	if err != nil {
		t.Fatal(err)
	}
	value, err := runner.Invoke(t.Context(), ExecutionContext{Ref: ref}, call)
	if err != nil || value.Status != "outcome_unknown" || value.Executed != nil || dispatches != 1 || store.finished != 1 {
		t.Fatalf("unknown result was replayed or misrepresented: %+v %v", value, err)
	}
}

type engineFunc func(context.Context, ExecutionRef, EngineHooks) error

func (f engineFunc) Execute(ctx context.Context, ref ExecutionRef, h EngineHooks) error {
	return f(ctx, ref, h)
}

func TestRuntimeDeadlineTerminatesLogicalRunDespiteIgnoringEngine(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	r := Runtime{Epoch: "e", StopGrace: 10 * time.Millisecond, Hooks: func(context.Context, ExecutionContext) (EngineHooks, error) { return nil, nil }, Engine: engineFunc(func(context.Context, ExecutionRef, EngineHooks) error { <-release; return nil })}
	start := time.Now()
	end := r.execute(t.Context(), ExecutionContext{Ref: ExecutionRef{SessionID: 1, RunID: 2, Epoch: "e"}, Deadline: start.Add(10 * time.Millisecond)})
	if end.Status != Failed || end.Reason != "deadline_exceeded" || time.Since(start) > time.Second {
		t.Fatalf("unbounded termination %+v", end)
	}
}
