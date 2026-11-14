package agentcore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type fairnessStore struct {
	RunStore
	cursors []ID
	claims  []ID
	ended   chan ID
}

func (s *fairnessStore) Candidates(_ context.Context, cursor ScanCursor, _ int) (CandidatePage, error) {
	s.cursors = append(s.cursors, cursor.After)
	id := cursor.After + 1
	return CandidatePage{Items: []Candidate{{SessionID: id}}, Next: &ScanCursor{After: id}}, nil
}
func (s *fairnessStore) ClaimRoot(_ context.Context, request ClaimRequest) (ClaimResult, error) {
	id := request.Candidate.SessionID
	s.claims = append(s.claims, id)
	if id < 3 {
		return ClaimResult{}, nil
	}
	return ClaimResult{Claimed: true, Execution: ExecutionContext{Ref: ExecutionRef{SessionID: id, RunID: id, Epoch: "e"}, Deadline: time.Now().Add(time.Second)}}, nil
}
func (s *fairnessStore) EndRoot(_ context.Context, ref ExecutionRef, _ RunEnd) (CommitReceipt, error) {
	s.ended <- ref.RunID
	return CommitReceipt{}, nil
}

type quietRecovery struct{ RecoveryStore }

func TestExecutionEndDistinguishesModelTimeoutAndRunDeadline(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status RunStatus
		reason string
	}{
		{modelcore.ErrTransportTimeout, Failed, "MODEL_REQUEST_TIMEOUT"},
		{&Error{Code: "MODEL_ATTEMPT_TIMEOUT"}, Failed, "MODEL_ATTEMPT_TIMEOUT"},
		{context.DeadlineExceeded, Failed, "deadline_exceeded"},
		{context.Canceled, Cancelled, "cancelled"},
	} {
		got := executionEnd(tc.err)
		if got.Status != tc.status || got.Reason != tc.reason {
			t.Fatalf("cause=%v outcome=%+v", tc.err, got)
		}
	}
}

func (quietRecovery) Recover(context.Context, string, int) (bool, error) { return true, nil }

func (quietRecovery) ConvergeDue(context.Context, time.Time, int) ([]CommitReceipt, error) {
	return nil, nil
}
func TestSchedulerScansPastUnclaimableCandidates(t *testing.T) {
	store := &fairnessStore{ended: make(chan ID, 1)}
	r := Runtime{Epoch: "e", MaxRoots: 1, Store: store, Recovery: quietRecovery{}, Engine: engineFunc(func(context.Context, ExecutionRef, EngineHooks) error { return nil }), Hooks: func(context.Context, ExecutionContext) (EngineHooks, error) { return nil, nil }}
	if err := r.validate(); err != nil {
		t.Fatal(err)
	}
	if err := r.tick(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(store.claims) != 3 || len(store.cursors) != 3 || store.cursors[2] != 2 {
		t.Fatalf("starved later candidate: %+v", store)
	}
	select {
	case id := <-store.ended:
		if id != 3 {
			t.Fatal(id)
		}
	case <-time.After(time.Second):
		t.Fatal("root never completed")
	}
}
func TestAbortedToolBatchDoesNotReleaseSerialBarrier(t *testing.T) {
	b, err := NewToolBatch([]PreparedToolCall{{ID: 1, Ordinal: 0, Call: modelcore.ToolCall{ID: "a"}}, {ID: 2, Ordinal: 1, Call: modelcore.ToolCall{ID: "b"}}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = b.Acquire(t.Context(), "a", "", ""); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("durable tool result failed")
	b.Abort(failure)
	if _, _, err = b.Acquire(t.Context(), "b", "", ""); !errors.Is(err, failure) {
		t.Fatalf("serial tool dispatched after abort: %v", err)
	}
}

type drainStore struct {
	RunStore
	claimed         bool
	ending, release chan struct{}
}

type workerLifetimeStore struct {
	RunStore
	started, stopped chan struct{}
}

func (s *workerLifetimeStore) WorkerStarted(context.Context, ExecutionRef) error {
	close(s.started)
	return nil
}
func (s *workerLifetimeStore) WorkerStopped(context.Context, ExecutionRef) error {
	close(s.stopped)
	return nil
}

func TestCancellationRetainsWorkerUntilEngineActuallyReturns(t *testing.T) {
	store := &workerLifetimeStore{started: make(chan struct{}), stopped: make(chan struct{})}
	entered, release := make(chan struct{}), make(chan struct{})
	r := Runtime{Epoch: "worker-test", Store: store, StopGrace: time.Millisecond, Engine: engineFunc(func(context.Context, ExecutionRef, EngineHooks) error { close(entered); <-release; return nil }), Hooks: func(context.Context, ExecutionContext) (EngineHooks, error) { return nil, nil }}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ended := make(chan RunEnd, 1)
	go func() {
		ended <- r.execute(ctx, ExecutionContext{Ref: ExecutionRef{Epoch: r.Epoch}, Deadline: time.Now().Add(time.Minute)})
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("engine not started")
	}
	cancel()
	select {
	case end := <-ended:
		if end.Status != Cancelled {
			t.Fatal(end)
		}
	case <-time.After(time.Second):
		t.Fatal("logical cancellation blocked")
	}
	select {
	case <-store.stopped:
		t.Fatal("worker hold released before the engine returned")
	default:
	}
	close(release)
	select {
	case <-store.stopped:
	case <-time.After(time.Second):
		t.Fatal("worker hold not released after engine returned")
	}
}

func (s *drainStore) Candidates(context.Context, ScanCursor, int) (CandidatePage, error) {
	if s.claimed {
		return CandidatePage{}, nil
	}
	return CandidatePage{Items: []Candidate{{SessionID: 1}}}, nil
}
func (s *drainStore) ClaimRoot(context.Context, ClaimRequest) (ClaimResult, error) {
	s.claimed = true
	return ClaimResult{Claimed: true, Execution: ExecutionContext{Ref: ExecutionRef{SessionID: 1, RunID: 2, Epoch: "e"}, Deadline: time.Now().Add(time.Hour)}}, nil
}
func (s *drainStore) EndRoot(ctx context.Context, _ ExecutionRef, end RunEnd) (CommitReceipt, error) {
	close(s.ending)
	if end.Status != Cancelled {
		return CommitReceipt{}, errors.New("unexpected terminal state")
	}
	select {
	case <-s.release:
		return CommitReceipt{}, nil
	case <-ctx.Done():
		return CommitReceipt{}, ctx.Err()
	}
}
func TestRuntimeShutdownWaitsForDurableRootSettlement(t *testing.T) {
	store := &drainStore{ending: make(chan struct{}), release: make(chan struct{})}
	started := make(chan struct{})
	r := Runtime{Epoch: "e", Store: store, Recovery: quietRecovery{}, StopGrace: 20 * time.Millisecond, Engine: engineFunc(func(ctx context.Context, _ ExecutionRef, _ EngineHooks) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}), Hooks: func(context.Context, ExecutionContext) (EngineHooks, error) { return nil, nil }}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	returned := make(chan error, 1)
	go func() { returned <- r.Run(ctx) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("engine did not start")
	}
	cancel()
	select {
	case <-store.ending:
	case <-time.After(time.Second):
		t.Fatal("terminal settlement did not start")
	}
	select {
	case err := <-returned:
		t.Fatalf("runtime returned before persistence settled: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(store.release)
	select {
	case err := <-returned:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("runtime did not drain")
	}
}
