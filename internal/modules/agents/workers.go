package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) WorkerStarted(ctx context.Context, ref agentcore.ExecutionRef) error {
	return s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, ref, true)
		if err != nil {
			return err
		}
		previous, err := st.WorkerReference(x.Run.ID, true)
		if err != nil {
			return err
		}
		if previous != nil {
			return httpx.E(409, "WORKER_ALREADY_STARTED", "本次运行已启动执行线程")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		return st.InsertResourceReference(&ResourceReferenceRow{HolderKind: "run_worker", HolderID: idString(x.Run.ID), ResourceKind: "local_worker", ResourceID: x.Root.ID, State: "active", ExecutorEpoch: ref.Epoch, FenceVersion: ref.Fence, CreatedAt: now, UpdatedAt: now})
	})
}

func (s *Service) WorkerStopped(ctx context.Context, ref agentcore.ExecutionRef) error {
	return s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		worker, err := st.WorkerReference(uint64(ref.RunID), true)
		if err != nil {
			return err
		}
		if worker == nil || worker.ExecutorEpoch != ref.Epoch || worker.FenceVersion != ref.Fence {
			return integrity()
		}
		if worker.ReleasedAt != nil {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		reason := "local_worker_returned"
		worker.State, worker.ReleasedAt, worker.UpdatedAt, worker.ReleaseReason = "released", &now, now, &reason
		return st.SaveResourceReference(worker)
	})
}
