package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type DecisionWrite struct {
	Decision string `json:"decision"`
}

func coreInteraction(row *InteractionRow) (agentcore.Interaction, error) {
	v := agentcore.Interaction{ID: agentcore.ID(row.ID), SessionID: agentcore.ID(row.SessionID), RunID: agentcore.ID(row.RunID), ToolCallID: agentcore.ID(row.ToolCallID), Kind: row.Kind, Status: row.Status, Version: agentcore.Version(row.RowVersion), Deadline: row.WaitDeadlineAt, ArgumentsHash: hexHash(row.RequestHash), ApprovalConsumedAt: row.ApprovalConsumedAt}
	var specification struct {
		Questions []agentcore.Question `json:"questions"`
	}
	if json.Unmarshal(row.Specification, &specification) != nil {
		return v, integrity()
	}
	v.Questions = specification.Questions
	if row.PendingReplyInputID != nil {
		id := agentcore.ID(*row.PendingReplyInputID)
		v.PendingReplyInputID = &id
	}
	return v, nil
}
func recordInteraction(st StateRepository, session *SessionRow, row *InteractionRow, plan agentcore.InteractionPlan, actor *agentcore.ActorRef, answer *agentcore.QuestionAnswer, decision *string, now time.Time) (uint64, error) {
	row.Status = plan.Interaction.Status
	row.RowVersion = uint64(plan.Interaction.Version)
	row.UpdatedAt = now
	row.PendingReplyInputID = nil
	if plan.Interaction.PendingReplyInputID != nil {
		id := uint64(*plan.Interaction.PendingReplyInputID)
		row.PendingReplyInputID = &id
	}
	if actor != nil {
		kind := actor.Kind
		id := "system"
		if actor.ID != nil {
			id = strconv.FormatUint(uint64(*actor.ID), 10)
		}
		row.DecidedByKind = &kind
		row.DecidedByID = &id
		row.DecidedAt = &now
	}
	seq, e := appendEvent(st, session, &row.RunID, "interaction/decided", "", map[string]any{"interaction_id": agentcore.ID(row.ID), "kind": row.Kind, "status": row.Status, "actor_ref": actor, "answer": answer, "decision": decision, "pending_reply_input_id": plan.Interaction.PendingReplyInputID, "reason": plan.Reason}, nil, now)
	if e != nil {
		return 0, e
	}
	row.ProjectionSeq = seq
	if answer != nil || decision != nil {
		row.AnswerEventSeq = &seq
	}
	if e = st.SaveInteraction(row); e != nil {
		return 0, e
	}
	return seq, nil
}

func settleInteractionTool(st StateRepository, session *SessionRow, run *RunRow, row *InteractionRow, plan agentcore.InteractionPlan, answer *agentcore.QuestionAnswer, now time.Time) error {
	if !plan.SettleTool {
		return nil
	}
	tool, e := st.ToolCall(row.ToolCallID, true)
	if e != nil {
		return e
	}
	if tool == nil {
		return integrity()
	}
	if tool.ResultEventSeq != nil {
		return nil
	}
	executed := plan.Executed
	content := "The requested action was not executed."
	if row.Kind == "question" {
		yes := true
		executed = &yes
		value := map[string]any{"interaction_id": agentcore.ID(row.ID), "status": "pending", "answer": nil}
		value["pending"] = true
		value["tool_call_id"] = agentcore.ID(row.ToolCallID)
		value["message"] = "No answer arrived before the wait ended. Continue useful independent work. This is pending, not a skipped answer or permission. A late answer will arrive as a user message associated with these questions."
		if answer != nil && plan.Delivery == "tool_result" {
			value["status"] = "answered"
			value["answer"] = answer
			delete(value, "pending")
			delete(value, "message")
		}
		bytes, e := json.Marshal(value)
		if e != nil {
			return e
		}
		content = string(bytes)
	}
	if e = settleToolBudget(st, run, tool, executed); e != nil {
		return e
	}
	if _, e = settleToolEvent(st, session, tool, plan.ToolStatus, executed, content, plan.Reason, nil, now); e != nil {
		return e
	}
	return nil
}

func (s *Service) AnswerInteraction(ctx context.Context, raw string, id uint64, tag, key string, answer agentcore.QuestionAnswer) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		initial, e := st.Interaction(id, false)
		if e != nil {
			return e
		}
		if initial == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, initial.SessionID, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "interaction.answer", "interaction:"+strconv.FormatUint(id, 10), answer, func(rec *Receipt) error {
			v, agent, _, _, e := s.executionTarget(ctx, tx, r, st, initial.SessionID, a)
			if e != nil {
				return e
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
			if q == nil {
				return missing()
			}
			if q.Status == "answered" || q.Status == "reply_queued" {
				return httpx.E(409, "INTERACTION_ALREADY_ANSWERED", "问题已有答案或排队答复")
			}
			if e = checkTag(tag, s.tag("interaction", id, q.RowVersion)); e != nil {
				return e
			}
			ci, e := coreInteraction(q)
			if e != nil {
				return e
			}
			cs, e := coreSession(v)
			if e != nil {
				return e
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			from := v.LastSeq + 1
			if e = agentcore.ValidateAnswer(ci.Questions, answer); e != nil {
				return coreError(e)
			}
			if q.Kind != "question" || q.Status != "waiting" && q.Status != "continued" {
				return httpx.E(409, "INTERACTION_CLOSED", "问题已关闭")
			}
			if run.Status == "stopping" || !agentcore.RunStatus(run.Status).Active() || !now.Before(run.DeadlineAt) {
				ci.Deadline = now
			}
			var input *InputRow
			var replyID agentcore.ID
			if ci.Status != "waiting" || !now.Before(ci.Deadline) || cs.ActiveRunID == nil || *cs.ActiveRunID != ci.RunID {
				delivery := "next_turn"
				if cs.ActiveRunID != nil && !cs.QueuePaused {
					delivery = "next_step"
				}
				input, _, e = s.enqueueInternal(st, v, agent, a, rec, "question_reply", &answer, &q.ID, nil, nil, delivery, now)
				if e != nil {
					return e
				}
				replyID = agentcore.ID(input.ID)
			}
			uid := agentcore.ID(a.User.ID)
			author := agentcore.ActorRef{Kind: "user", ID: &uid}
			plan, e := agentcore.PlanAnswer(cs, ci, agentcore.Version(q.RowVersion), author, answer, replyID, now)
			if e != nil {
				return coreError(e)
			}
			seq, e := recordInteraction(st, v, q, plan, &author, &answer, nil, now)
			if e != nil {
				return e
			}
			if e = settleInteractionTool(st, v, run, q, plan, &answer, now); e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			var inputID, runID *agentcore.ID
			if input != nil {
				inputID = &replyID
			} else {
				id := agentcore.ID(q.RunID)
				runID = &id
			}
			out.Data = map[string]any{"interaction_id": agentcore.ID(id), "status": q.Status, "delivery": plan.Delivery, "input_id": inputID, "run_id": runID, "queue_paused": v.QueuePaused, "accepted_seq": agentcore.Seq(seq)}
			out.Tag = s.tag("interaction", id, q.RowVersion)
			out.Commits = append(out.Commits, eventReceipt(v.ID, from, v.LastSeq))
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}

func (s *Service) DecideInteraction(ctx context.Context, raw string, id uint64, tag, key string, w DecisionWrite) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		initial, e := st.Interaction(id, false)
		if e != nil {
			return e
		}
		if initial == nil {
			return missing()
		}
		session, e := s.sessionAccess(st, initial.SessionID, a, true, false)
		if e != nil {
			return e
		}
		if session.ExecutionMode != "interactive" {
			return httpx.E(403, "APPROVAL_NOT_ALLOWED", "服务型智能体不接受一次性批准")
		}
		if w.Decision != "approve_once" && w.Decision != "reject" {
			return httpx.Invalid("decision", "unsupported")
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "interaction.decide", "interaction:"+strconv.FormatUint(id, 10), w, func(rec *Receipt) error {
			v, agent, _, _, e := s.executionTarget(ctx, tx, r, st, session.ID, a)
			if e != nil {
				return e
			}
			run, e := st.Run(initial.RunID, true)
			if e != nil {
				return e
			}
			if run == nil {
				return integrity()
			}
			q, e := st.Interaction(id, true)
			if e != nil {
				return e
			}
			if q == nil {
				return missing()
			}
			if e = checkTag(tag, s.tag("interaction", id, q.RowVersion)); e != nil {
				return e
			}
			ci, e := coreInteraction(q)
			if e != nil {
				return e
			}
			cs, e := coreSession(v)
			if e != nil {
				return e
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			from := v.LastSeq + 1
			uid := agentcore.ID(a.User.ID)
			author := agentcore.ActorRef{Kind: "user", ID: &uid}
			plan, e := agentcore.PlanDecision(cs, ci, agentcore.Version(q.RowVersion), author, w.Decision == "approve_once", now)
			if e != nil {
				return coreError(e)
			}
			input, _, e := s.enqueueInternal(st, v, agent, a, rec, "approval_reply", nil, &q.ID, nil, nil, "next_turn", now, ApprovalReply{InteractionID: q.ID, Decision: w.Decision})
			if e != nil {
				return e
			}
			replyID := agentcore.ID(input.ID)
			plan.Interaction.PendingReplyInputID = &replyID
			seq, e := recordInteraction(st, v, q, plan, &author, nil, &w.Decision, now)
			if e != nil {
				return e
			}
			if e = settleInteractionTool(st, v, run, q, plan, nil, now); e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			out.Data = map[string]any{"interaction_id": agentcore.ID(id), "status": q.Status, "tool_call_id": agentcore.ID(q.ToolCallID), "executed": false, "input_id": agentcore.ID(input.ID), "delivery": "next_turn", "accepted_seq": agentcore.Seq(seq)}
			out.Tag = s.tag("interaction", id, q.RowVersion)
			out.Commits = append(out.Commits, eventReceipt(v.ID, from, v.LastSeq))
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
