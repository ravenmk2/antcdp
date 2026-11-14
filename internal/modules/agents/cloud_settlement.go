package agents

import (
	"context"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *CloudService) reconcileCloudLeases(ctx context.Context, limit int) error {
	var rows []CloudLeaseRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		var e error
		rows, e = cr.PendingLeases(limit)
		return e
	})
	if e != nil {
		return e
	}
	var errs []error
	for _, initial := range rows {
		if s.ExecutionReconciler != nil {
			if e = s.ExecutionReconciler(ctx, initial.RootRunID); e != nil {
				errs = append(errs, e)
			}
		}
		e = s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, cr CloudRepository) error {
			v, e := cr.Computer(initial.ComputerID, true)
			if e != nil {
				return e
			}
			root, e := st.Run(initial.RootRunID, false)
			if e != nil {
				return e
			}
			lease, e := cr.Lease(initial.RootRunID, true)
			if e != nil {
				return e
			}
			if v == nil || root == nil || lease == nil {
				return integrity()
			}
			if lease.ReleasedAt != nil {
				return nil
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			lease.UpdatedAt = now
			if root.FinishedAt == nil {
				return cr.SaveLease(lease)
			}
			pending, e := cr.CloudRootWorkPending(root.ID)
			if e != nil {
				return e
			}
			if pending {
				lease.State = "reconciling"
				return cr.SaveLease(lease)
			}
			lease.State = "released"
			lease.ReleasedAt = &now
			reason := "physical_completion_verified"
			lease.ReleaseReason = &reason
			if e = cr.SaveLease(lease); e != nil {
				return e
			}
			others, e := cr.ComputerLeases(v.ID)
			if e != nil {
				return e
			}
			if len(others) == 0 {
				v.IdleSince = now
			}
			v.LastActivityAt = now
			v.UpdatedAt = now
			return cr.SaveComputer(v)
		})
		if e != nil {
			errs = append(errs, e)
		}
	}
	return errors.Join(errs...)
}
