package agentcore

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type HooksFactory func(context.Context, ExecutionContext) (EngineHooks, error)

// Runtime schedules admitted root Runs and their one-level children. It has no
// inference loop, no distributed lease, and never restarts an interrupted Run.
type Runtime struct {
	Epoch                   string
	Store                   RunStore
	Recovery                RecoveryStore
	Engine                  AgentEngine
	Hooks                   HooksFactory
	Environment             Environment
	Hub                     *Hub
	MaxRoots                int
	PollInterval, StopGrace time.Duration
	OnError                 func(error)
	mu                      sync.Mutex
	active                  map[ID]context.CancelFunc
	wake                    chan struct{}
	roots                   sync.WaitGroup
}

func (r *Runtime) validate() error {
	if r.Epoch == "" || r.Store == nil || r.Recovery == nil || r.Engine == nil || r.Hooks == nil {
		return invalid("runtime")
	}
	if r.MaxRoots == 0 {
		r.MaxRoots = 32
	}
	if r.MaxRoots < 1 || r.MaxRoots > 1024 {
		return invalid("max_roots")
	}
	if r.PollInterval == 0 {
		r.PollInterval = time.Second
	}
	if r.StopGrace == 0 {
		r.StopGrace = 5 * time.Second
	}
	if r.PollInterval < 10*time.Millisecond || r.StopGrace <= 0 || r.StopGrace > time.Minute {
		return invalid("runtime_timeout")
	}
	r.mu.Lock()
	r.active = map[ID]context.CancelFunc{}
	r.wake = make(chan struct{}, 1)
	r.mu.Unlock()
	return nil
}

func (r *Runtime) Run(ctx context.Context) error {
	if err := r.validate(); err != nil {
		return err
	}
	for {
		done, err := r.Recovery.Recover(ctx, r.Epoch, 100)
		if err != nil {
			return err
		}
		if done {
			break
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	ticker := time.NewTicker(r.PollInterval)
	defer ticker.Stop()
	defer r.drain()
	for {
		if err := r.tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
			r.report(err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		case <-r.wake:
		}
	}
}

// Keep the persistence host alive until cancelled roots have had their bounded
// opportunity to commit terminal facts. An uncooperative external operation is
// not awaited forever and is never declared physically complete by this drain.
func (r *Runtime) drain() {
	r.mu.Lock()
	for _, cancel := range r.active {
		cancel()
	}
	r.mu.Unlock()
	done := make(chan struct{})
	go func() { r.roots.Wait(); close(done) }()
	timer := time.NewTimer(r.StopGrace + 12*time.Second)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		r.report(reject("SHUTDOWN_DRAIN_TIMEOUT"))
	}
}
func (r *Runtime) report(err error) {
	if err != nil && r.OnError != nil {
		r.OnError(err)
	}
}
func (r *Runtime) Notify() {
	r.mu.Lock()
	wake := r.wake
	r.mu.Unlock()
	if wake != nil {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}
func (r *Runtime) Cancel(run ID) {
	r.mu.Lock()
	cancel := r.active[run]
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (r *Runtime) tick(ctx context.Context) error {
	maintenanceCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	receipts, err := r.Recovery.ConvergeDue(maintenanceCtx, time.Now().UTC(), 100)
	cancel()
	if err != nil {
		return err
	}
	for _, receipt := range receipts {
		r.committed(ctx, receipt)
	}
	r.mu.Lock()
	slots := r.MaxRoots - len(r.active)
	r.mu.Unlock()
	if slots <= 0 {
		return nil
	}
	cursor := ScanCursor{}
	for scanned := 0; scanned < 100 && slots > 0; {
		page, err := r.Store.Candidates(ctx, cursor, min(slots, 100-scanned))
		if err != nil {
			return err
		}
		for _, candidate := range page.Items {
			scanned++
			claim, err := r.Store.ClaimRoot(ctx, ClaimRequest{Candidate: candidate, Epoch: r.Epoch})
			if err != nil {
				r.report(err)
				continue
			}
			if !claim.Claimed {
				continue
			}
			r.committed(ctx, claim.Receipt)
			runCtx, runCancel := context.WithCancel(ctx)
			r.mu.Lock()
			_, duplicate := r.active[claim.Execution.Ref.RunID]
			if !duplicate {
				r.active[claim.Execution.Ref.RunID] = runCancel
			}
			r.mu.Unlock()
			if duplicate {
				runCancel()
				r.report(reject("RUN_ALREADY_ACTIVE"))
				continue
			}
			slots--
			r.roots.Add(1)
			go func(execution ExecutionContext) {
				defer r.roots.Done()
				defer runCancel()
				defer func() { r.mu.Lock(); delete(r.active, execution.Ref.RunID); r.mu.Unlock(); r.Notify() }()
				end := r.execute(runCtx, execution)
				commitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
				defer cancel()
				receipt, err := r.Store.EndRoot(commitCtx, execution.Ref, end)
				if err != nil {
					r.report(err)
					return
				}
				r.committed(commitCtx, receipt)
			}(claim.Execution)
		}
		if page.Next == nil || page.Next.After <= cursor.After || len(page.Items) == 0 {
			break
		}
		cursor = *page.Next
	}
	return nil
}

func (r *Runtime) execute(ctx context.Context, execution ExecutionContext) RunEnd {
	if execution.Ref.Epoch != r.Epoch || execution.Deadline.IsZero() {
		return RunEnd{Status: Failed, Reason: "EXECUTION_INVALID"}
	}
	runCtx, cancel := context.WithDeadline(ctx, execution.Deadline)
	defer cancel()
	workers, tracksWorkers := r.Store.(WorkerStore)
	if tracksWorkers {
		if err := workers.WorkerStarted(runCtx, execution.Ref); err != nil {
			return executionEnd(err)
		}
	}
	result := make(chan error, 1)
	go func() {
		if tracksWorkers {
			defer func() {
				cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
				defer done()
				r.report(workers.WorkerStopped(cleanup, execution.Ref))
				r.Notify()
			}()
		}
		current := execution
		if r.Environment != nil && current.Binding == nil {
			binding, err := r.Environment.Acquire(runCtx, current)
			if err != nil {
				result <- err
				return
			}
			if binding != nil {
				receipt, err := r.Store.ActivateBinding(runCtx, current.Ref, *binding)
				if err != nil {
					result <- err
					return
				}
				current.Binding = binding
				r.committed(runCtx, receipt)
			}
		}
		hooks, err := r.Hooks(runCtx, current)
		if err == nil {
			err = r.Engine.Execute(runCtx, current.Ref, hooks)
		}
		result <- err
	}()
	select {
	case err := <-result:
		if errors.Is(err, ErrWaitingInput) && r.Environment != nil {
			cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), r.StopGrace)
			r.report(r.Environment.CancelFamily(cleanup, execution))
			done()
		}
		return executionEnd(err)
	case <-runCtx.Done():
		// The lifecycle must finish even if a remote library ignores cancellation.
		// Late callbacks are rejected by the store's epoch/fence/status checks.
		if r.Environment != nil {
			go func() {
				cleanupCtx, done := context.WithTimeout(context.WithoutCancel(ctx), r.StopGrace)
				defer done()
				r.report(r.Environment.CancelFamily(cleanupCtx, execution))
			}()
		}
		timer := time.NewTimer(r.StopGrace)
		defer timer.Stop()
		select {
		case <-result:
		case <-timer.C:
		}
		return executionEnd(runCtx.Err())
	}
}
func executionEnd(err error) RunEnd {
	if errors.Is(err, ErrWaitingInput) {
		return RunEnd{Status: WaitingInput, Reason: "human_input_required"}
	}
	if err == nil {
		return RunEnd{Status: Succeeded}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return RunEnd{Status: Failed, Reason: "deadline_exceeded"}
	}
	if errors.Is(err, context.Canceled) {
		return RunEnd{Status: Cancelled, Reason: "cancelled"}
	}
	if errors.Is(err, modelcore.ErrOutputLimit) {
		return RunEnd{Status: Failed, Reason: "OUTPUT_LIMIT_EXCEEDED"}
	}
	if errors.Is(err, modelcore.ErrTransportTimeout) {
		return RunEnd{Status: Failed, Reason: "MODEL_REQUEST_TIMEOUT"}
	}
	var coreErr *Error
	if errors.As(err, &coreErr) {
		return RunEnd{Status: Failed, Reason: coreErr.Code}
	}
	return RunEnd{Status: Failed, Reason: "EXECUTION_FAILED"}
}
func (r *Runtime) committed(ctx context.Context, receipt CommitReceipt) {
	if r.Hub != nil {
		r.Hub.Committed(ctx, receipt)
	}
}

// RunChild does not reserve a root worker. Its parent may hold the only logical
// tool slot while waiting; the child's independent Eino execution remains live.
func (r *Runtime) RunChild(ctx context.Context, request ChildRequest) (ToolCompletion, error) {
	claim, err := r.Store.CreateChild(ctx, request)
	if err != nil {
		return ToolCompletion{}, err
	}
	if !claim.Created {
		return ToolCompletion{}, reject("CHILD_ALREADY_CREATED")
	}
	r.committed(ctx, claim.Receipt)
	end := r.execute(ctx, claim.Execution)
	commitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	commit, err := r.Store.EndChild(commitCtx, claim.Execution.Ref, ChildEnd{End: end})
	if err != nil {
		return ToolCompletion{}, err
	}
	if err = commit.Receipt.ValidateTool(request.Parent.ID, request.Parent.Ref.SessionID); err != nil {
		return ToolCompletion{}, err
	}
	r.committed(commitCtx, commit.Receipt)
	return commit.Result, nil
}
