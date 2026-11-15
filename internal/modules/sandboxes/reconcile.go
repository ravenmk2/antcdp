package sandboxes

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Reconcile observes persisted work after deadlines or executor replacement.
// No command or filesystem mutation is restarted by this worker.
func (s *Service) Reconcile(ctx context.Context, limit int) error {
	cursor := s.recoveryCursor()
	cursor.mu.Lock()
	defer cursor.mu.Unlock()
	if limit < 1 || limit > 100 {
		limit = 25
	}
	var executions []Execution
	var operations []Operation
	err := s.Transact(ctx, func(r Repository) error {
		var e error
		executions, e = r.PendingExecutions(cursor.executions, limit)
		if e != nil {
			return e
		}
		operations, e = r.PendingOperations(cursor.operations, limit)
		return e
	})
	if err != nil {
		return err
	}
	if len(executions) > 0 {
		cursor.executions = executions[len(executions)-1].ID
	}
	if len(operations) > 0 {
		cursor.operations = operations[len(operations)-1].ID
	}
	var failures []error
	for _, e := range executions {
		if e.ExecutorEpoch == s.Epoch && nowUTC().Before(e.DeadlineAt) && e.Status != "cancel_pending" {
			continue
		}
		if e.Status == "prepared" {
			err = s.finishExecution(ctx, e, sandboxcore.ExecResult{}, fail("SANDBOX_EXECUTION_INTERRUPTED"), false)
		} else if e.Status == "cancel_pending" || !nowUTC().Before(e.DeadlineAt) && e.CancelRequestedAt == nil {
			var lease *Lease
			err = s.Transact(ctx, func(r Repository) error { var read error; lease, read = r.Lease(e.LeaseID, false); return read })
			if err == nil && lease != nil {
				err = s.CancelExecution(ctx, *lease, e.ID)
				if err == nil && e.RemoteID == nil {
					// No handle can arrive after the original instance has gone.
					// Cancellation intent alone must not block that observation.
					_, err = s.ObserveExecution(ctx, e.ID)
				}
			}
		} else {
			_, err = s.ObserveExecution(ctx, e.ID)
		}
		if err != nil {
			failures = append(failures, err)
		}
	}
	for _, op := range operations {
		if op.ExecutorEpoch == s.Epoch && nowUTC().Before(op.DeadlineAt) {
			continue
		}
		switch op.Kind {
		case "create":
			var spec sandboxcore.CreateSpec
			if json.Unmarshal(op.Intent, &spec) != nil {
				failures = append(failures, fail("SANDBOX_INTENT_INVALID"))
				continue
			}
			_, err = s.Create(ctx, op.InstanceID, spec)
		case "delete", "pause", "resume":
			var intent struct {
				Force bool `json:"force"`
			}
			if json.Unmarshal(op.Intent, &intent) != nil {
				failures = append(failures, fail("SANDBOX_INTENT_INVALID"))
				continue
			}
			err = s.Transition(ctx, op.InstanceID, op.Kind, op.Token, intent.Force)
		default:
			continue
		}
		if err != nil {
			failures = append(failures, err)
		}
	}
	if err = s.reconcileFiles(ctx, limit, cursor); err != nil {
		failures = append(failures, err)
	}
	var leases []Lease
	err = s.Transact(ctx, func(r Repository) error {
		var e error
		leases, e = r.ExpiredLeases(nowUTC(), cursor.leases, limit)
		return e
	})
	if err != nil {
		failures = append(failures, err)
	} else {
		if len(leases) > 0 {
			cursor.leases = leases[len(leases)-1].ID
		}
		for _, lease := range leases {
			if e := s.Release(ctx, lease, "expired_and_idle"); e != nil {
				var remote *sandboxcore.Error
				if !errors.As(e, &remote) || remote.Code != "SANDBOX_BUSY" {
					failures = append(failures, e)
				}
			}
		}
	}
	return errors.Join(failures...)
}
