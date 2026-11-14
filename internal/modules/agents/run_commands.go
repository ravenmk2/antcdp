package agents

import (
	"context"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type StopRunWrite struct {
	Reason string `json:"reason"`
}
type RetryRunWrite struct {
	ExpectedEndSeq agentcore.Seq `json:"expected_end_seq"`
}

func (s *Service) StopRun(ctx context.Context, raw string, id uint64, key string, w StopRunWrite) (*Result, error) {
	requested := false
	out, e := s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if utf8.RuneCountInString(w.Reason) > 200 {
			return httpx.Invalid("reason", "too_long")
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		initial, e := st.Run(id, false)
		if e != nil {
			return e
		}
		if initial == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, initial.SessionID, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "run.stop", "run:"+strconv.FormatUint(id, 10), w, func(rec *Receipt) error {
			v, e := s.sessionAccess(st, initial.SessionID, a, true, true)
			if e != nil {
				return e
			}
			row, e := st.Run(id, true)
			if e != nil {
				return e
			}
			if row == nil {
				return missing()
			}
			coreS, e := coreSession(v)
			if e != nil {
				return e
			}
			coreR, e := coreRun(row)
			if e != nil {
				return e
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			if v.ActiveRunID != nil && *v.ActiveRunID != id {
				return httpx.E(409, "RUN_CHANGED", "会话已有新的运行，请重新加载")
			}
			receipt, e := cancelSessionQueue(st, v, "user_stopped", now)
			if e != nil {
				return e
			}
			if len(receipt.Ranges) > 0 {
				out.Commits = append(out.Commits, receipt)
			}
			plan, e := agentcore.PlanStop(coreS, coreR, now, 10*time.Second)
			if e != nil {
				return coreError(e)
			}
			var accepted *agentcore.Seq
			out.Status = 200
			if coreR.Status.Active() {
				out.Status = 202
				requested = true
				if plan.Changed {
					from := v.LastSeq + 1
					old := row.Status
					row.Status = "stopping"
					row.StopRequestedAt = &now
					row.StopDeadlineAt = plan.Run.StopDeadline
					kind, actor := "user", strconv.FormatUint(a.User.ID, 10)
					row.StopActorKind = &kind
					row.StopActorID = &actor
					row.UpdatedAt = now
					seq, e := appendEvent(st, v, &row.ID, "run/state", "run-stop:"+strconv.FormatUint(id, 10), map[string]any{"run_id": agentcore.ID(id), "previous_status": old, "status": "stopping", "reason_code": "user_stopped", "reason": w.Reason}, nil, now)
					if e != nil {
						return e
					}
					position := agentcore.Seq(seq)
					accepted = &position
					row.ProjectionSeq = seq
					if e = st.SaveRun(row); e != nil {
						return e
					}
					if e = st.SaveSession(v); e != nil {
						return e
					}
					out.Commits = append(out.Commits, eventReceipt(v.ID, from, v.LastSeq))
				} else {
					position := agentcore.Seq(row.ProjectionSeq)
					accepted = &position
				}
			}
			out.Data = map[string]any{"run_id": agentcore.ID(id), "stop_requested": coreR.Status.Active(), "status": row.Status, "queue_paused": v.QueuePaused, "accepted_seq": accepted}
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
	if e == nil && requested && s.CancelRun != nil {
		s.CancelRun(agentcore.ID(id))
	}
	return out, e
}

// enqueueInternal is used only after current principal/configuration validation.
// It retains structured answer/continuation facts, with no hidden user message.
func (s *Service) enqueueInternal(st StateRepository, v *SessionRow, agent *Definition, a *identity.Auth, rec *Receipt, kind string, answer *agentcore.QuestionAnswer, question, retry *uint64, continuation *uint64, delivery string, now time.Time, approvals ...ApprovalReply) (*InputRow, InputView, error) {
	policy := corePolicy(agent)
	actorID := strconv.FormatUint(a.User.ID, 10)
	row := &InputRow{SessionID: v.ID, CommandReceiptID: &rec.ID, InputKind: kind, OriginKind: "human", ActorKind: "user", ActorID: actorID, LastModifiedByKind: "user", LastModifiedByID: actorID, Status: "pending", QueueOrder: v.NextInputOrder, QuestionInteractionID: question, RetryOfRunID: retry, ContinuationSeq: continuation, ContentRevision: 1, RowVersion: 1, CreatedAt: now, UpdatedAt: now, QueueDeadlineAt: now.Add(time.Duration(policy.QueueTimeoutSeconds) * time.Second)}
	if e := st.InsertInput(row); e != nil {
		return nil, InputView{}, e
	}
	v.NextInputOrder++
	row.AcceptedSeq = v.LastSeq + 1
	user := agentcore.ID(a.User.ID)
	view := InputView{ID: row.ID, SessionID: v.ID, Kind: kind, Content: []agentcore.TextBlock{}, Files: []agentcore.FileRef{}, Answer: answer, Origin: "human", Actor: agentcore.ActorRef{Kind: "user", ID: &user}, Delivery: delivery, State: "pending", Position: row.QueueOrder, QueueDeadline: row.QueueDeadlineAt, AcceptedSeq: row.AcceptedSeq, Revision: 1, Version: strings.Trim(s.tag("input", row.ID, 1), `"`), CreatedAt: now, UpdatedAt: now}
	if e := attachQuestionContext(st, row, &view); e != nil {
		return nil, view, e
	}
	if len(approvals) == 1 {
		view.Approval = &approvals[0]
	}
	seq, e := appendEvent(st, v, nil, "input/accepted", "", map[string]any{"input": view}, nil, now)
	if e != nil {
		return nil, view, e
	}
	row.CurrentContentSeq = seq
	if e = st.SaveInput(row); e != nil {
		return nil, view, e
	}
	return row, view, nil
}

func (s *Service) RetryRun(ctx context.Context, raw string, id uint64, key string, w RetryRunWrite) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		initial, e := st.Run(id, false)
		if e != nil {
			return e
		}
		if initial == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, initial.SessionID, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "run.retry", "run:"+strconv.FormatUint(id, 10), w, func(rec *Receipt) error {
			v, agent, _, _, e := s.executionTarget(ctx, tx, r, st, initial.SessionID, a)
			if e != nil {
				return e
			}
			row, e := st.Run(id, true)
			if e != nil {
				return e
			}
			if row == nil || row.RootRunID != nil {
				return missing()
			}
			if row.Status != "failed" && row.Status != "cancelled" && row.Status != "interrupted" {
				return httpx.E(409, "RUN_NOT_RETRYABLE", "运行不允许重试")
			}
			if row.EndedSeq == nil || *row.EndedSeq != uint64(w.ExpectedEndSeq) {
				return httpx.E(409, "RUN_END_CHANGED", "运行终态边界不匹配")
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			from := v.LastSeq + 1
			input, _, e := s.enqueueInternal(st, v, agent, a, rec, "continue", nil, nil, &row.ID, row.EndedSeq, "next_turn", now)
			if e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			out.Status = 202
			out.Data = InputAccepted{InputID: input.ID, RunID: nil, Delivery: "next_turn", QueuePaused: v.QueuePaused, AcceptedSeq: input.AcceptedSeq}
			out.Commits = append(out.Commits, eventReceipt(v.ID, from, v.LastSeq))
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
