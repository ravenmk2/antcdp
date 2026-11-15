package agents

import (
	"context"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *CloudService) ProcessPending(ctx context.Context, limit int) error {
	var rows []CloudOperationRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		var e error
		rows, e = cr.PendingCloudOperations(s.Epoch, time.Now().UTC(), limit)
		return e
	})
	if e != nil {
		return e
	}
	var errs []error
	for _, row := range rows {
		if e = s.product().ProcessOperation(ctx, row.ID); e != nil {
			errs = append(errs, e)
		}
	}
	if e = s.reconcileCloudLeases(ctx, limit*4); e != nil {
		errs = append(errs, e)
	}
	return errors.Join(errs...)
}
func (s *CloudService) CancelFamily(ctx context.Context, x agentcore.ExecutionContext) error {
	var rows []CloudExecutionRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		var e error
		rows, e = cr.LeaseExecutions(uint64(x.Ref.RootRunID))
		return e
	})
	if e != nil {
		return e
	}
	var errs []error
	for _, row := range rows {
		if row.FinishedAt == nil {
			if e = s.reconcileCommand(ctx, row, true); e != nil {
				errs = append(errs, e)
			}
		}
	}
	return errors.Join(errs...)
}
func (s *CloudService) Reconcile(ctx context.Context, x agentcore.ExecutionContext) error {
	if s.ExecutionReconciler != nil {
		return s.ExecutionReconciler(ctx, uint64(x.Ref.RootRunID))
	}
	return nil
}
