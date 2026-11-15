package sandboxes

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Transition persists dispatch before sending a lifecycle request. On recovery
// it only observes the original request. force is a caller-authorized destructive
// action and is only accepted for terminating an instance with unresolved work.
func (s *Service) Transition(ctx context.Context, id uint64, kind, token string, force bool) error {
	if token == "" || (kind != "delete" && kind != "pause" && kind != "resume") || force && kind != "delete" {
		return fail("SANDBOX_REQUEST_INVALID")
	}
	var instance *Instance
	var op *Operation
	fresh := false
	err := s.Transact(ctx, func(r Repository) error {
		var e error
		instance, e = r.Instance(id, true)
		if e != nil {
			return e
		}
		if instance == nil {
			return fail("SANDBOX_NOT_FOUND")
		}
		intent, _ := json.Marshal(map[string]any{"kind": kind, "force": force})
		hash := sha256.Sum256(intent)
		op, e = r.OperationByToken(token)
		if e != nil {
			return e
		}
		if op != nil {
			if op.InstanceID != id || op.Kind != kind || !sameJSON(op.Intent, intent) {
				return fail("SANDBOX_TOKEN_CONFLICT")
			}
			return nil
		}
		if instance.FinishedAt != nil {
			if kind == "delete" {
				return nil
			}
			return fail("SANDBOX_STATE_CONFLICT")
		}
		if !force {
			leases, e := r.Leases(id)
			if e != nil {
				return e
			}
			if len(leases) > 0 {
				return fail("SANDBOX_BUSY")
			}
			busy, e := r.Busy(id, nil)
			if e != nil {
				return e
			}
			if busy {
				return fail("SANDBOX_BUSY")
			}
		}
		now := nowUTC()
		op = &Operation{InstanceID: id, Token: token, Kind: kind, Status: "dispatching", RequestHash: hash[:], Intent: intent, Observation: json.RawMessage(`{}`), ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, StartedAt: &now, DeadlineAt: now.Add(5 * time.Minute), UpdatedAt: now}
		if e = r.InsertOperation(op); e != nil {
			return e
		}
		instance.State = map[string]string{"delete": "terminating", "pause": "pausing", "resume": "resuming"}[kind]
		instance.UpdatedAt = now
		instance.RowVersion++
		fresh = true
		return r.SaveInstance(instance)
	})
	if err != nil {
		return err
	}
	if op == nil {
		return nil
	}
	if op.FinishedAt != nil {
		if op.Status != "completed" {
			return fail("SANDBOX_TRANSITION_FAILED")
		}
		return nil
	}
	ref, err := s.Resource(instance)
	if err != nil {
		return err
	}
	p, err := s.Open(ctx, instance.ConnectionID, instance.BackendGeneration)
	if err != nil {
		return err
	}
	actual, cause := p.Inspect(ctx, ref)
	target := map[string]string{"delete": "terminated", "pause": "paused", "resume": "ready"}[kind]
	done := func() bool { return actual.State == target || kind == "delete" && actual.State == "absent" }
	if cause == nil && !done() && fresh {
		if kind == "delete" {
			cause = p.Terminate(ctx, ref)
		} else {
			control, ok := p.(sandboxcore.LifecycleControl)
			if !ok {
				cause = fail("SANDBOX_LIFECYCLE_UNSUPPORTED")
			} else if kind == "pause" {
				cause = control.Pause(ctx, ref)
			} else {
				cause = control.Resume(ctx, ref)
			}
		}
		// Inspect even after a lost acknowledgement; never repeat the mutation.
		if observed, e := p.Inspect(ctx, ref); e == nil {
			actual = observed
			if done() {
				cause = nil
			}
		} else {
			cause = e
		}
	}
	if cause == nil && !done() {
		cause = &sandboxcore.Error{Code: "SANDBOX_TRANSITION_UNCONFIRMED", Unknown: true}
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	save := s.Transact(cleanup, func(r Repository) error {
		v, e := r.Instance(id, true)
		if e != nil {
			return e
		}
		row, e := r.Operation(op.ID, true)
		if e != nil {
			return e
		}
		if v == nil || row == nil || row.FenceVersion != op.FenceVersion {
			return fail("SANDBOX_OPERATION_FENCED")
		}
		if row.FinishedAt != nil {
			return nil
		}
		now := nowUTC()
		row.UpdatedAt = now
		v.UpdatedAt = now
		v.LastObservedAt = &now
		v.RowVersion++
		row.Observation, _ = json.Marshal(actual)
		if done() && cause == nil {
			row.Status = "completed"
			row.FinishedAt = &now
			v.State = target
			if kind == "delete" {
				v.FinishedAt = &now
			}
		} else {
			row.Status = "outcome_unknown"
			code := errorCode(cause)
			row.ErrorCode = &code
			v.ErrorCode = &code
			v.State = "unknown"
		}
		if e = r.SaveOperation(row); e != nil {
			return e
		}
		return r.SaveInstance(v)
	})
	return errors.Join(cause, save)
}
