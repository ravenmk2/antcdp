package agentcore

import (
	"context"
	"errors"
	"time"
)

var ErrWaitingInput = errors.New("turn ended awaiting human input")

// ToolRunner is shared by all Runs. Its small worker pool is held only across
// dispatch, never while waiting for an interaction, child, or durable result.
// Child/control tools may use their own dispatcher path without this pool.
type ToolRunner struct {
	Store        ToolStore
	Dispatcher   ToolDispatcher
	Hub          *Hub
	Workers      chan struct{}
	PollInterval time.Duration
}

func NewToolRunner(store ToolStore, dispatcher ToolDispatcher, workers int) (*ToolRunner, error) {
	if store == nil || dispatcher == nil || workers < 1 || workers > 256 {
		return nil, invalid("tool_runner")
	}
	return &ToolRunner{Store: store, Dispatcher: dispatcher, Workers: make(chan struct{}, workers), PollInterval: 100 * time.Millisecond}, nil
}
func (r *ToolRunner) Invoke(ctx context.Context, execution ExecutionContext, call PreparedToolCall) (ToolCompletion, error) {
	if call.Ref != execution.Ref {
		return ToolCompletion{}, reject("EXECUTION_FENCED")
	}
	interval := r.PollInterval
	if interval <= 0 {
		interval = 100 * time.Millisecond
	}
	for {
		// A control dispatcher can block on a child/question but must not hold
		// a shared execution worker. The per-Run ToolBatch still holds its slot.
		pooled := call.Spec.ExecutionClass != "child" && call.Spec.ExecutionClass != "question"
		if pooled {
			select {
			case <-ctx.Done():
				return ToolCompletion{}, ctx.Err()
			case r.Workers <- struct{}{}:
			}
		}
		admission, err := r.Store.PrepareDispatch(ctx, execution.Ref, call.ID)
		if err != nil {
			if pooled {
				<-r.Workers
			}
			return ToolCompletion{}, err
		}
		if admission.Kind == "execute" {
			if admission.Permit.Call.ID != call.ID || admission.Permit.Call.Ref != call.Ref || admission.Permit.Token == "" || admission.Permit.Deadline.IsZero() {
				if pooled {
					<-r.Workers
				}
				return ToolCompletion{}, reject("DISPATCH_PERMIT_INVALID")
			}
			dispatchCtx, cancel := context.WithDeadline(ctx, admission.Permit.Deadline)
			observation, dispatchErr := r.Dispatcher.Dispatch(dispatchCtx, execution, admission.Permit)
			cancel()
			if pooled {
				<-r.Workers
			}
			if dispatchErr != nil && observation.Status == "" {
				observation.Status = "outcome_unknown"
				observation.Executed = nil
				observation.Reason = "TOOL_RESULT_UNCONFIRMED"
			}
			if observation.Committed != nil {
				if err := observation.Committed.ValidateTool(call.ID, call.Ref.SessionID); err != nil {
					return ToolCompletion{}, err
				}
				if r.Hub != nil {
					r.Hub.Committed(ctx, *observation.Committed)
				}
				// Re-read the uniquely committed projection, never trust a
				// dispatcher's ad-hoc string after a transactional operation.
				lookupCtx, lookupCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
				commit, err := r.Store.LookupCompletion(lookupCtx, call.ID)
				lookupCancel()
				if err != nil {
					return ToolCompletion{}, err
				}
				return checkedCompletion(call, commit.Result)
			}
			finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			commit, err := r.Store.CompleteTool(finishCtx, call.Ref, ToolResult{Call: call, Observation: observation})
			if err != nil {
				// A stopped turn may already contain an immutable unknown result.
				// Preserve it and append the late, verified observation instead of
				// reviving the turn or discarding evidence that the work ended.
				if observation.Executed != nil && (observation.Status == "succeeded" || observation.Status == "failed" || observation.Status == "cancelled") {
					receipt, reconcileErr := r.Store.RecordReconciliation(finishCtx, ReconciliationEvidence{Ref: call.Ref, CallID: call.ID, ObservedStatus: observation.Status, Executed: observation.Executed, Reason: observation.Reason, ObservedAt: time.Now().UTC()})
					if reconcileErr == nil && r.Hub != nil {
						r.Hub.Committed(finishCtx, receipt)
					}
				}
				finishCancel()
				return ToolCompletion{}, err
			}
			finishCancel()
			if r.Hub != nil {
				r.Hub.Committed(ctx, commit.Receipt)
			}
			return checkedCompletion(call, commit.Result)
		}
		if pooled {
			<-r.Workers
		}
		switch admission.Kind {
		case "blocked", "already_completed":
			if admission.Completion == nil {
				return ToolCompletion{}, reject("TOOL_RESULT_MISSING")
			}
			return checkedCompletion(call, *admission.Completion)
		case "await_interaction":
			if call.Spec.ExecutionClass != "question" {
				return ToolCompletion{}, ErrWaitingInput
			}
			// Questions yield the shared worker while retaining this turn.
			// The durable answer or timeout completes the original tool call.
			fallthrough
		case "await_result":
			timer := time.NewTimer(interval)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ToolCompletion{}, ctx.Err()
			case <-timer.C:
			}
		default:
			return ToolCompletion{}, reject("DISPATCH_STATE_INVALID")
		}
	}
}
func checkedCompletion(call PreparedToolCall, result ToolCompletion) (ToolCompletion, error) {
	if err := result.Receipt.ValidateTool(call.ID, call.Ref.SessionID); err != nil {
		return ToolCompletion{}, err
	}
	switch result.Status {
	case "succeeded", "failed", "blocked", "cancelled", "outcome_unknown":
		return result, nil
	default:
		return ToolCompletion{}, errors.New("invalid terminal tool result")
	}
}
