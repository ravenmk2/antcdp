package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) Recover(ctx context.Context, epoch string, limit int) (bool, error) {
	if epoch == "" || limit < 1 || limit > 1000 {
		return false, httpx.Invalid("recovery", "invalid_value")
	}
	var rows []RunRow
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		if e := st.ReleaseOldWorkers(epoch, time.Now().UTC().Truncate(time.Millisecond)); e != nil {
			return e
		}
		var e error
		rows, e = st.RecoverableRoots(epoch, limit)
		return e
	})
	if e != nil {
		return false, e
	}
	for _, row := range rows {
		ref := agentcore.ExecutionRef{SessionID: agentcore.ID(row.SessionID), RunID: agentcore.ID(row.ID), RootRunID: agentcore.ID(row.ID), Epoch: row.ExecutorEpoch, Fence: row.FenceVersion}
		if s.ResumeRoot != nil && row.Status == "running" && time.Now().Before(row.DeadlineAt) {
			execution, ok, err := s.recoverBackgroundParent(ctx, ref, epoch)
			if err != nil {
				return false, err
			}
			if ok {
				s.ResumeRoot(ctx, execution)
				continue
			}
		}
		receipt, e := s.EndRoot(ctx, ref, agentcore.RunEnd{Status: agentcore.Interrupted, Reason: "executor_restarted"})
		if e != nil {
			return false, e
		}
		if s.Committed != nil && len(receipt.Ranges) > 0 {
			s.Committed(ctx, receipt)
		}
	}
	return len(rows) < limit, nil
}

func (s *Service) ConvergeDue(ctx context.Context, now time.Time, limit int) ([]agentcore.CommitReceipt, error) {
	out := []agentcore.CommitReceipt{}
	if limit < 1 || limit > 1000 {
		return nil, httpx.Invalid("limit", "invalid_range")
	}
	settled, err := s.settleCompletedRoots(ctx, limit)
	if err != nil {
		return out, err
	}
	out = append(out, settled...)
	var roots []RunRow
	var inputs []InputRow
	var interactions []InteractionRow
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		var e error
		roots, e = st.DueRoots(now, limit)
		if e != nil {
			return e
		}
		inputs, e = st.DueInputs(now, limit)
		if e != nil {
			return e
		}
		interactions, e = st.DueInteractions(now, limit)
		return e
	})
	if e != nil {
		return nil, e
	}
	for _, row := range roots {
		end := agentcore.RunEnd{Status: agentcore.Interrupted, Reason: "model_attempt_expired"}
		if !now.Before(row.DeadlineAt) {
			end.Reason = "deadline_exceeded"
		}
		if row.StopDeadlineAt != nil && !now.Before(*row.StopDeadlineAt) {
			end = agentcore.RunEnd{Status: agentcore.Cancelled, Reason: "user_stopped"}
		}
		receipt, e := s.EndRoot(ctx, agentcore.ExecutionRef{SessionID: agentcore.ID(row.SessionID), RunID: agentcore.ID(row.ID), RootRunID: agentcore.ID(row.ID), Epoch: row.ExecutorEpoch, Fence: row.FenceVersion}, end)
		if e != nil {
			return out, e
		}
		if s.CancelRun != nil && len(receipt.Ranges) > 0 {
			s.CancelRun(agentcore.ID(row.ID))
		}
		if len(receipt.Ranges) > 0 {
			out = append(out, receipt)
		}
	}
	for _, row := range interactions {
		receipt, e := s.expireInteraction(ctx, row.ID, now)
		if e != nil {
			return out, e
		}
		if len(receipt.Ranges) > 0 {
			out = append(out, receipt)
		}
	}
	for _, row := range inputs {
		var receipt agentcore.CommitReceipt
		e = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			v, e := st.Session(row.SessionID, true)
			if e != nil {
				return e
			}
			if v == nil {
				return integrity()
			}
			input, e := st.Input(row.ID, true)
			if e != nil {
				return e
			}
			if input == nil || input.Status != "pending" || now.Before(input.QueueDeadlineAt) {
				return nil
			}
			from := v.LastSeq + 1
			input.Status = "expired"
			input.RowVersion++
			input.UpdatedAt = now
			input.EndedAt = &now
			reason := "queue_deadline_exceeded"
			input.EndReason = &reason
			if e = st.SaveInput(input); e != nil {
				return e
			}
			if _, e = appendEvent(st, v, nil, "input/expired", "", map[string]any{"input_id": agentcore.ID(input.ID), "revision": agentcore.Version(input.ContentRevision), "reason": reason}, nil, now); e != nil {
				return e
			}
			if e = returnLateAnswer(st, v, input, now); e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			receipt = eventReceipt(v.ID, from, v.LastSeq)
			return nil
		})
		if e != nil {
			return out, e
		}
		if len(receipt.Ranges) > 0 {
			out = append(out, receipt)
		}
	}
	return out, nil
}
func (s *Service) expireInteraction(ctx context.Context, id uint64, now time.Time) (agentcore.CommitReceipt, error) {
	var out agentcore.CommitReceipt
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		initial, e := st.Interaction(id, false)
		if e != nil {
			return e
		}
		if initial == nil {
			return nil
		}
		v, e := st.Session(initial.SessionID, true)
		if e != nil {
			return e
		}
		if v == nil {
			return integrity()
		}
		run, e := st.Run(initial.RunID, true)
		if e != nil {
			return e
		}
		if run == nil || run.RootRunID != nil {
			return integrity()
		}
		q, e := st.Interaction(id, true)
		if e != nil {
			return e
		}
		if q == nil || now.Before(q.WaitDeadlineAt) || q.Kind == "question" && q.Status != "waiting" || q.Kind == "approval" && q.Status != "pending" {
			return nil
		}
		ci, e := coreInteraction(q)
		if e != nil {
			return e
		}
		plan, e := agentcore.PlanInteractionExpiry(ci, now)
		if e != nil {
			return coreError(e)
		}
		from := v.LastSeq + 1
		if _, e = recordInteraction(st, v, q, plan, nil, nil, nil, now); e != nil {
			return e
		}
		if e = settleInteractionTool(st, v, run, q, plan, nil, now); e != nil {
			return e
		}
		if e = st.SaveSession(v); e != nil {
			return e
		}
		out = eventReceipt(v.ID, from, v.LastSeq)
		return nil
	})
	return out, e
}

var _ agentcore.RecoveryStore = (*Service)(nil)

// Resume at a closed tool boundary. Unconfirmed external operations use the
// normal interruption path and are never dispatched a second time.
func (s *Service) recoverBackgroundParent(ctx context.Context, ref agentcore.ExecutionRef, epoch string) (execution agentcore.ExecutionContext, resume bool, err error) {
	var receipt agentcore.CommitReceipt
	err = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		// Most historical roots have no background call. Only acquire live
		// execution authority when a resumable boundary actually exists.
		calls, e := st.RunTools(uint64(ref.RunID))
		if e != nil {
			return e
		}
		var deliveredStep uint64
		hasBackground := false
		for _, c := range calls {
			if c.ResultEventSeq == nil {
				return nil
			}
			if c.ExecutionClass == "child" && len(c.ExecutionRef) > 0 {
				var child childReference
				if json.Unmarshal(c.ExecutionRef, &child) != nil {
					return integrity()
				}
				if child.Background {
					hasBackground = true
					deliveredStep = max(deliveredStep, child.DeliveredStep)
				}
			}
		}
		if !hasBackground {
			return nil
		}
		x, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		active, pending, e := visitChildReports(st, x.Session, x.Run, false, time.Time{})
		if e != nil {
			return e
		}
		deliveredAtBoundary := deliveredStep > 0 && deliveredStep == x.Run.CurrentStepNo
		if !active && !pending && !deliveredAtBoundary {
			return nil
		}
		models, e := st.RunModelCalls(x.Run.ID)
		if e != nil {
			return e
		}
		for _, c := range models {
			if c.Status == "running" || (!active && !pending && c.Purpose == "generation" && c.StepNo >= deliveredStep) {
				return nil
			}
		}
		family, e := st.FamilyRuns(x.Run.ID)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		from := x.Session.LastSeq + 1
		for i := range family {
			child := &family[i]
			if child.ID == x.Run.ID || agentcore.RunStatus(child.Status).Terminal() {
				continue
			}
			session, e := st.Session(child.SessionID, true)
			if e != nil {
				return e
			}
			if session == nil {
				return integrity()
			}
			child, e = st.Run(child.ID, true)
			if e != nil {
				return e
			}
			if child == nil {
				return integrity()
			}
			start := session.LastSeq + 1
			if e = s.endOne(st, session, child, agentcore.RunEnd{Status: agentcore.Interrupted, Reason: "executor_restarted"}, now); e != nil {
				return e
			}
			if _, e = s.settleChildResult(st, x.Session, session, x.Run, child, now); e != nil {
				return e
			}
			if e = st.SaveSession(session); e != nil {
				return e
			}
			receipt.Ranges = append(receipt.Ranges, eventReceipt(session.ID, start, session.LastSeq).Ranges...)
		}
		if x.Session.LastSeq >= from {
			receipt.Ranges = append(receipt.Ranges, eventReceipt(x.Session.ID, from, x.Session.LastSeq).Ranges...)
		}
		x.Run.ExecutorEpoch = epoch
		x.Run.FenceVersion++
		if e = st.SaveRun(x.Run); e != nil {
			return e
		}
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		execution = x.Execution
		execution.Ref.Epoch = epoch
		execution.Ref.Fence = x.Run.FenceVersion
		execution.CompletedSteps = uint32(x.Run.CurrentStepNo)
		resume = true
		return nil
	})
	if err == nil && len(receipt.Ranges) > 0 && s.Committed != nil {
		s.Committed(ctx, receipt)
	}
	return
}
