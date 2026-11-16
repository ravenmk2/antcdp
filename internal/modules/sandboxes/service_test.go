package sandboxes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type remote struct {
	sandboxcore.Provider
	sandboxcore.Filesystem
	ref                              sandboxcore.ResourceRef
	state                            string
	creates, execs, cancels, deletes int
	lostCreate                       bool
	createError                      error
	running                          bool
	lostExec                         bool
	beforeStarted                    func()
}

func (p *remote) OpenFile(context.Context, sandboxcore.ResourceRef, sandboxcore.FileRequest) (io.ReadCloser, error) {
	return nil, fail("UNUSED")
}
func (p *remote) PutFile(context.Context, sandboxcore.ResourceRef, sandboxcore.FileRequest, io.Reader) error {
	return fail("UNUSED")
}

func (p *remote) Create(_ context.Context, spec sandboxcore.CreateSpec) (sandboxcore.Observation, error) {
	p.creates++
	if p.createError != nil {
		return sandboxcore.Observation{}, p.createError
	}
	p.ref = sandboxcore.ResourceRef{BackendGeneration: spec.BackendGeneration, RemoteID: "remote", Ownership: spec.Ownership}
	p.state = "ready"
	if p.lostCreate {
		return sandboxcore.Observation{}, &sandboxcore.Error{Code: "LOST", Unknown: true}
	}
	return sandboxcore.Observation{Ref: p.ref, State: p.state}, nil
}
func (p *remote) Find(context.Context, sandboxcore.Ownership, int, int) (sandboxcore.ResourcePage, error) {
	ref := p.ref
	ref.BackendGeneration = 0
	return sandboxcore.ResourcePage{Items: []sandboxcore.Observation{{Ref: ref, State: p.state}}}, nil
}
func (p *remote) Inspect(context.Context, sandboxcore.ResourceRef) (sandboxcore.Observation, error) {
	return sandboxcore.Observation{Ref: p.ref, State: p.state}, nil
}
func (p *remote) Terminate(context.Context, sandboxcore.ResourceRef) error {
	p.deletes++
	p.state = "terminated"
	return nil
}
func (p *remote) Exec(ctx context.Context, ref sandboxcore.ResourceRef, _ sandboxcore.ExecSpec, cb sandboxcore.ExecCallbacks) (sandboxcore.ExecResult, error) {
	p.execs++
	h := sandboxcore.ExecutionHandle{Resource: ref, ID: "command"}
	if p.beforeStarted != nil {
		p.beforeStarted()
	}
	if err := cb.Started(ctx, h); err != nil {
		return sandboxcore.ExecResult{Handle: &h}, err
	}
	if p.lostExec {
		return sandboxcore.ExecResult{Handle: &h}, &sandboxcore.Error{Code: "LOST", Unknown: true}
	}
	code := int32(0)
	if p.running {
		return sandboxcore.ExecResult{Handle: &h, Running: true}, nil
	}
	return sandboxcore.ExecResult{Handle: &h, ExitCode: &code}, nil
}
func (p *remote) InspectExecution(_ context.Context, h sandboxcore.ExecutionHandle) (sandboxcore.ExecResult, error) {
	if p.running {
		return sandboxcore.ExecResult{Handle: &h, Running: true}, nil
	}
	code := int32(0)
	return sandboxcore.ExecResult{Handle: &h, ExitCode: &code}, nil
}
func (p *remote) CancelExecution(context.Context, sandboxcore.ExecutionHandle) error {
	p.cancels++
	return nil
}

func fixture(t *testing.T) (*Service, *memory, *remote, *Instance) {
	t.Helper()
	m := newMemory()
	p := &remote{}
	s := &Service{Epoch: "worker", Transact: m.transact, InstallationID: func() (string, error) { return "installation", nil }, Open: func(context.Context, uint64, uint64) (sandboxcore.Provider, error) { return p, nil }}
	v, err := s.Reserve(context.Background(), 1, 1, "create-token", json.RawMessage(`{"image":"test:1"}`))
	if err != nil {
		t.Fatal(err)
	}
	return s, m, p, v
}
func ready(t *testing.T) (*Service, *memory, *remote, *Instance, *Lease) {
	t.Helper()
	s, m, p, v := fixture(t)
	var err error
	v, err = s.Create(context.Background(), v.ID, sandboxcore.CreateSpec{})
	if err != nil {
		t.Fatal(err)
	}
	l, err := s.Acquire(context.Background(), v.ID, "script", "job-1", "exclusive", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return s, m, p, v, l
}
func TestCreateLostAcknowledgementFindsOriginalWithoutReplay(t *testing.T) {
	s, m, p, v := fixture(t)
	p.lostCreate = true
	if _, err := s.Create(context.Background(), v.ID, sandboxcore.CreateSpec{}); err == nil {
		t.Fatal("lost create reported success")
	}
	if p.creates != 1 {
		t.Fatal("create count")
	}
	v, err := s.Create(context.Background(), v.ID, sandboxcore.CreateSpec{})
	if err != nil || v.State != "ready" || p.creates != 1 {
		t.Fatal(v, err, p.creates)
	}
	if _, err = s.Reserve(context.Background(), 1, 1, "create-token", json.RawMessage(`{"image":"different:1"}`)); err == nil {
		t.Fatal("token accepted changed configuration")
	}
	for _, op := range m.operations {
		if op.FinishedAt == nil {
			t.Fatal("create hold not retired")
		}
	}
}
func TestExecutionHandleDurableBeforeCallerOutputAndDuplicateNeverDispatches(t *testing.T) {
	s, m, p, _, l := ready(t)
	ctx := context.Background()
	spec := sandboxcore.ExecSpec{Command: "printf ok", CWD: "/", Timeout: time.Minute}
	cb := sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error {
		found := false
		for _, row := range m.executions {
			found = found || row.RemoteID != nil
		}
		if !found {
			t.Error("remote handle not durable")
		}
		return nil
	}}
	e, err := s.Execute(ctx, *l, "command-token", spec, cb)
	if err != nil || e.FinishedAt == nil || e.ExitCode == nil {
		t.Fatal(e, err)
	}
	if _, err = s.Execute(ctx, *l, "command-token", spec, cb); err != nil || p.execs != 1 {
		t.Fatal("duplicate dispatch", err, p.execs)
	}
	spec.Command = "rm changed"
	if _, err = s.Execute(ctx, *l, "command-token", spec, cb); err == nil {
		t.Fatal("changed command accepted")
	}
	if err = s.Release(ctx, *l, "complete"); err != nil {
		t.Fatal(err)
	}
}
func TestCancelAcknowledgementDoesNotReleaseRunningProcess(t *testing.T) {
	s, _, p, _, l := ready(t)
	p.running = true
	ctx := context.Background()
	e, err := s.Execute(ctx, *l, "background", sandboxcore.ExecSpec{Command: "sleep 30", CWD: "/", Background: true, Timeout: time.Minute}, sandboxcore.ExecCallbacks{})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CancelExecution(ctx, *l, e.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Release(ctx, *l, "cancelled"); err == nil {
		t.Fatal("cancellation released a running process")
	}
	if err = s.CancelExecution(ctx, *l, e.ID); err != nil || p.cancels != 1 {
		t.Fatal("cancel mutation repeated", err)
	}
	p.running = false
	if _, err = s.ObserveExecution(ctx, e.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Release(ctx, *l, "stopped"); err != nil {
		t.Fatal(err)
	}
}
func TestUnknownFileWriteCannotReplayOrReleaseUntilInstanceTermination(t *testing.T) {
	s, _, p, v, l := ready(t)
	ctx := context.Background()
	calls := 0
	apply := func(sandboxcore.Filesystem, sandboxcore.ResourceRef) (json.RawMessage, error) {
		calls++
		return nil, &sandboxcore.Error{Code: "LOST", Unknown: true}
	}
	op, err := s.File(ctx, *l, "upload", json.RawMessage(`{"path":"/file","sha256":"digest"}`), true, apply)
	if err == nil || op.Status != "outcome_unknown" {
		t.Fatal(op, err)
	}
	_, _ = s.File(ctx, *l, "upload", json.RawMessage(`{"path":"/file","sha256":"digest"}`), true, apply)
	if calls != 1 {
		t.Fatal("uncertain file mutation repeated")
	}
	if err = s.Release(ctx, *l, "timeout"); err == nil {
		t.Fatal("unknown write released")
	}
	if err = s.Transition(ctx, v.ID, "delete", "delete", false); err == nil {
		t.Fatal("active hold ignored")
	}
	if err = s.Transition(ctx, v.ID, "delete", "forced-delete", true); err != nil {
		t.Fatal(err)
	}
	if p.deletes != 1 {
		t.Fatal("delete count")
	}
	if err = s.ReconcileFiles(ctx, 25); err != nil {
		t.Fatal(err)
	}
	if err = s.Release(ctx, *l, "terminated"); err != nil {
		t.Fatal(err)
	}
}
func TestExclusiveLeaseAdmissionSerializesConcurrentConsumers(t *testing.T) {
	s, _, _, v := fixture(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, v.ID, sandboxcore.CreateSpec{}); err != nil {
		t.Fatal(err)
	}
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Go(func() {
			_, err := s.Acquire(ctx, v.ID, "script", string(rune('a'+i)), "exclusive", time.Minute)
			if err == nil {
				successes.Add(1)
			}
		})
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatal("multiple exclusive callers", successes.Load())
	}
}
func TestStaleFenceCannotDispatchAndExpiredLeaseDoesNotAdmitWork(t *testing.T) {
	s, m, p, _, l := ready(t)
	ctx := context.Background()
	row := m.leases[l.ID]
	row.FenceVersion++
	m.leases[l.ID] = row
	if _, err := s.Execute(ctx, *l, "old", sandboxcore.ExecSpec{Command: "old", Timeout: time.Minute}, sandboxcore.ExecCallbacks{}); err == nil {
		t.Fatal("stale fence accepted")
	}
	l.FenceVersion++
	row.ExpiresAt = time.Now().Add(-time.Second)
	m.leases[l.ID] = row
	if _, err := s.Execute(ctx, *l, "expired", sandboxcore.ExecSpec{Command: "old", Timeout: time.Minute}, sandboxcore.ExecCallbacks{}); err == nil {
		t.Fatal("expired lease accepted")
	}
	if p.execs != 0 {
		t.Fatal("unauthorized dispatch")
	}
}
func TestInterruptedExecutionRecoveryOnlyObserves(t *testing.T) {
	s, m, p, _, l := ready(t)
	ctx := context.Background()
	p.lostExec = true
	e, err := s.Execute(ctx, *l, "unknown", sandboxcore.ExecSpec{Command: "write", Timeout: time.Minute}, sandboxcore.ExecCallbacks{})
	if err == nil || e.Status != "outcome_unknown" {
		t.Fatal(e, err)
	}
	s.Epoch = "replacement"
	if err = s.Reconcile(ctx, 25); err != nil {
		t.Fatal(err)
	}
	if p.execs != 1 || m.executions[e.ID].FinishedAt == nil {
		t.Fatal("recovery replayed or failed to observe")
	}
}
func TestKnownFileFailureReleasesHold(t *testing.T) {
	s, _, _, _, l := ready(t)
	ctx := context.Background()
	op, err := s.File(ctx, *l, "missing", json.RawMessage(`{"path":"/missing"}`), true, func(sandboxcore.Filesystem, sandboxcore.ResourceRef) (json.RawMessage, error) {
		return nil, &sandboxcore.Error{Code: "NOT_FOUND"}
	})
	if err == nil || op.FinishedAt == nil || op.Status != "failed" {
		t.Fatal(op, err)
	}
	if err = s.Release(ctx, *l, "known failure"); err != nil {
		t.Fatal(err)
	}
}

func TestCancellationBeforeHandleArrivalIsDispatchedAfterItIsKnown(t *testing.T) {
	s, m, p, _, lease := ready(t)
	ctx := context.Background()
	p.running = true
	p.beforeStarted = func() {
		for _, row := range m.executions {
			if err := s.CancelExecution(ctx, *lease, row.ID); err != nil {
				t.Error(err)
			}
		}
	}
	row, err := s.Execute(ctx, *lease, "late-handle", sandboxcore.ExecSpec{Command: "sleep", Timeout: time.Minute}, sandboxcore.ExecCallbacks{})
	if err != nil || row.Status != "cancel_pending" || p.cancels != 0 {
		t.Fatal(row, err, p.cancels)
	}
	if err = s.Reconcile(ctx, 25); err != nil {
		t.Fatal(err)
	}
	if p.cancels != 1 || m.executions[row.ID].FinishedAt != nil {
		t.Fatal("late cancellation lost or running command released")
	}
	if err = s.Reconcile(ctx, 25); err != nil {
		t.Fatal(err)
	}
	if p.cancels != 1 {
		t.Fatal("cancel mutation repeated")
	}
}

func TestObserverCannotExecuteOrWriteEvenWithForgedLeaseMode(t *testing.T) {
	s, _, p, v, _ := ready(t)
	ctx := context.Background()
	observer, err := s.Acquire(ctx, v.ID, "browser", "reader", "observer", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	observer.Mode = "exclusive"
	if _, err = s.Execute(ctx, *observer, "forged", sandboxcore.ExecSpec{Command: "write", Timeout: time.Minute}, sandboxcore.ExecCallbacks{}); err == nil {
		t.Fatal("observer dispatched command")
	}
	called := false
	if _, err = s.File(ctx, *observer, "forged-file", json.RawMessage(`{}`), true, func(sandboxcore.Filesystem, sandboxcore.ResourceRef) (json.RawMessage, error) {
		called = true
		return nil, nil
	}); err == nil || called || p.execs != 0 {
		t.Fatal("observer mutated instance")
	}
}

func TestRecoveryBatchesRotatePastUnfinishedWork(t *testing.T) {
	t.Run("active execution does not starve interrupted execution", func(t *testing.T) {
		s, m, p, _, lease := ready(t)
		ctx := context.Background()
		p.running = true
		spec := sandboxcore.ExecSpec{Command: "sleep", Background: true, Timeout: time.Minute}
		first, err := s.Execute(ctx, *lease, "active", spec, sandboxcore.ExecCallbacks{})
		if err != nil {
			t.Fatal(err)
		}
		second, err := s.Execute(ctx, *lease, "interrupted", spec, sandboxcore.ExecCallbacks{})
		if err != nil {
			t.Fatal(err)
		}
		row := m.executions[second.ID]
		row.ExecutorEpoch = "previous-worker"
		m.executions[row.ID] = row
		p.running = false
		for range 2 {
			if err = s.Reconcile(ctx, 1); err != nil {
				t.Fatal(err)
			}
		}
		if m.executions[first.ID].FinishedAt != nil || m.executions[second.ID].FinishedAt == nil {
			t.Fatal("active early row prevented later recovery")
		}
	})
	t.Run("unknown write does not starve interrupted read", func(t *testing.T) {
		s, m, _, v, lease := ready(t)
		ctx := context.Background()
		write, err := s.File(ctx, *lease, "uncertain", json.RawMessage(`{}`), true, func(sandboxcore.Filesystem, sandboxcore.ResourceRef) (json.RawMessage, error) {
			return nil, &sandboxcore.Error{Code: "LOST", Unknown: true}
		})
		if err == nil {
			t.Fatal("missing uncertain failure")
		}
		now := nowUTC()
		read := &Operation{InstanceID: v.ID, LeaseID: &lease.ID, Token: "interrupted-read", Kind: "file_read", Status: "dispatching", ExecutorEpoch: "previous-worker", FenceVersion: 1, CreatedAt: now, DeadlineAt: now.Add(time.Minute), UpdatedAt: now}
		if err = m.InsertOperation(read); err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if err = s.ReconcileFiles(ctx, 1); err != nil {
				t.Fatal(err)
			}
		}
		if m.operations[write.ID].FinishedAt != nil || m.operations[read.ID].FinishedAt == nil {
			t.Fatal("uncertain write prevented later read recovery")
		}
	})
	t.Run("busy expired lease does not starve idle lease", func(t *testing.T) {
		s, m, p, v, initial := ready(t)
		ctx := context.Background()
		if err := s.Release(ctx, *initial, "shared test"); err != nil {
			t.Fatal(err)
		}
		busy, err := s.Acquire(ctx, v.ID, "script", "busy", "shared", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		idle, err := s.Acquire(ctx, v.ID, "script", "idle", "shared", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		p.running = true
		if _, err = s.Execute(ctx, *busy, "running", sandboxcore.ExecSpec{Command: "sleep", Background: true, Timeout: time.Minute}, sandboxcore.ExecCallbacks{}); err != nil {
			t.Fatal(err)
		}
		for _, id := range []uint64{busy.ID, idle.ID} {
			row := m.leases[id]
			row.ExpiresAt = nowUTC().Add(-time.Second)
			m.leases[id] = row
		}
		for range 2 {
			if err = s.Reconcile(ctx, 1); err != nil {
				t.Fatal(err)
			}
		}
		if m.leases[busy.ID].ReleasedAt != nil || m.leases[idle.ID].ReleasedAt == nil {
			t.Fatal("busy early lease prevented idle lease release")
		}
	})
}

func TestPendingCancellationWithoutHandleSettlesAfterInstanceTermination(t *testing.T) {
	s, m, p, v, lease := ready(t)
	ctx := context.Background()
	p.running = true
	row, err := s.Execute(ctx, *lease, "missing-handle", sandboxcore.ExecSpec{Command: "sleep", Timeout: time.Minute}, sandboxcore.ExecCallbacks{})
	if err != nil {
		t.Fatal(err)
	}
	row.RemoteID = nil
	row.Status = "outcome_unknown"
	row.DeadlineAt = nowUTC().Add(-time.Second)
	m.executions[row.ID] = *row
	if err = s.Transition(ctx, v.ID, "delete", "force-terminate", true); err != nil {
		t.Fatal(err)
	}
	if err = s.Reconcile(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if m.executions[row.ID].FinishedAt == nil || p.cancels != 0 {
		t.Fatal("missing handle prevented terminal observation")
	}
	if err = s.Release(ctx, *lease, "terminated"); err != nil {
		t.Fatal(err)
	}
}

func TestCreationDiagnosticPersistsWithoutReplayingFailure(t *testing.T) {
	s, m, p, v := fixture(t)
	p.createError = &sandboxcore.Error{Code: "SANDBOX_AUTHENTICATION_FAILED", Detail: &diagnostic.Detail{HTTPStatus: 403}}
	if _, err := s.Create(t.Context(), v.ID, sandboxcore.CreateSpec{}); err == nil {
		t.Fatal("expected failure")
	}
	for _, op := range m.operations {
		d := diagnostic.Read(op.Observation)
		if op.Status != "failed" || d == nil || d.HTTPStatus != 403 || d.Stage != "create" {
			t.Fatal("missing durable cause", op, d)
		}
	}
	_, err := s.Create(t.Context(), v.ID, sandboxcore.CreateSpec{})
	var control *sandboxcore.Error
	if p.creates != 1 || !errors.As(err, &control) || control.Code != "SANDBOX_CREATION_FAILED" || diagnostic.From(err).HTTPStatus != 403 {
		t.Fatal("replay lost diagnostic or changed control", err, p.creates)
	}
}
