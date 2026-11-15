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
	if limit < 1 || limit > 100 {
		limit = 25
	}
	var executions []Execution
	var operations []Operation
	err := s.Transact(ctx, func(r Repository) error {
		var e error
		executions, e = r.PendingExecutions(limit)
		if e != nil {
			return e
		}
		operations, e = r.PendingOperations(limit)
		return e
	})
	if err != nil {
		return err
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
	if err = s.ReconcileFiles(ctx, limit); err != nil {
		failures = append(failures, err)
	}
	var leases []Lease
	err = s.Transact(ctx, func(r Repository) error { var e error; leases, e = r.ExpiredLeases(nowUTC(), limit); return e })
	if err != nil {
		failures = append(failures, err)
	} else {
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
