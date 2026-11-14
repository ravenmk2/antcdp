package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func pendingInput(st StateRepository, session, id uint64, now time.Time) (*InputRow, error) {
	v, e := st.Input(id, true)
	if e != nil {
		return nil, e
	}
	if v == nil || v.SessionID != session {
		return nil, missing()
	}
	if v.Status != "pending" {
		return nil, httpx.E(409, "INPUT_NOT_PENDING", "输入已不在待处理队列")
	}
	if !now.Before(v.QueueDeadlineAt) {
		return nil, httpx.E(409, "INPUT_EXPIRED", "输入已经到期")
	}
	return v, nil
}
func (s *Service) EditInput(ctx context.Context, raw string, session, id uint64, tag string, w InputEdit) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, _, model, _, e := s.executionTarget(ctx, tx, r, st, session, a)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		row, e := pendingInput(st, session, id, now)
		if e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("input", id, row.RowVersion)); e != nil {
			return e
		}
		view, e := s.inputView(st, row)
		if e != nil {
			return e
		}
		original := view
		if row.InputKind == "approval_reply" {
			return httpx.E(409, "INPUT_NOT_EDITABLE", "审批回应不能改写，请移除后重新作出决定")
		}
		if row.InputKind == "question_reply" {
			if !w.Answer.Set || w.Answer.Null || w.Content.Set || w.Files.Set {
				return httpx.Invalid("question_answer", "required")
			}
			if row.QuestionInteractionID == nil {
				return integrity()
			}
			question, e := st.Interaction(*row.QuestionInteractionID, true)
			if e != nil {
				return e
			}
			if question == nil || question.SessionID != session {
				return integrity()
			}
			var spec struct {
				Questions []agentcore.Question `json:"questions"`
			}
			if json.Unmarshal(question.Specification, &spec) != nil {
				return integrity()
			}
			if e = agentcore.ValidateAnswer(spec.Questions, w.Answer.Value); e != nil {
				return coreError(e)
			}
			view.Answer = &w.Answer.Value
		} else {
			if w.Answer.Set || !w.Content.Set && !w.Files.Set || w.Content.Null || w.Files.Null {
				return httpx.Invalid("body", "invalid_patch")
			}
			if w.Content.Set {
				view.Content = w.Content.Value
			}
			if w.Files.Set {
				view.Files = w.Files.Value
			}
			if e = agentcore.ValidateInput(view.Content, view.Files); e != nil {
				return coreError(e)
			}
		}
		if !same(original.Content, view.Content) || !same(original.Files, view.Files) || !same(original.Answer, view.Answer) {
			if e = bindInputFiles(st, v, row.ID, a.User.ID, view.Files, model, now); e != nil {
				return e
			}
			from := v.LastSeq + 1
			previous := row.ContentRevision
			row.ContentRevision++
			row.RowVersion++
			row.UpdatedAt = now
			row.LastModifiedByKind = "user"
			row.LastModifiedByID = strconv.FormatUint(a.User.ID, 10)
			view.Revision = row.ContentRevision
			view.Version = strings.Trim(s.tag("input", id, row.RowVersion), `"`)
			view.UpdatedAt = now
			uid := agentcore.ID(a.User.ID)
			modifier := agentcore.ActorRef{Kind: "user", ID: &uid}
			view.ModifiedBy = &modifier
			seq, e := appendEvent(st, v, nil, "input/updated", "", map[string]any{"input": view, "previous_revision": agentcore.Version(previous), "actor_ref": modifier}, nil, now)
			if e != nil {
				return e
			}
			row.CurrentContentSeq = seq
			if e = st.SaveInput(row); e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			out.Commits = append(out.Commits, eventReceipt(session, from, v.LastSeq))
		}
		out.Data = view
		out.Tag = s.tag("input", id, row.RowVersion)
		return nil
	})
}
func (s *Service) RemoveInput(ctx context.Context, raw string, session, id uint64, tag, key string) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, session, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "input.remove", "input:"+strconv.FormatUint(id, 10), struct {
			SessionID agentcore.ID `json:"session_id"`
		}{agentcore.ID(session)}, func(rec *Receipt) error {
			v, e := s.sessionAccess(st, session, a, true, true)
			if e != nil {
				return e
			}
			if v.ArchivedAt != nil {
				return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			row, e := pendingInput(st, session, id, now)
			if e != nil {
				return e
			}
			if e = checkTag(tag, s.tag("input", id, row.RowVersion)); e != nil {
				return e
			}
			from := v.LastSeq + 1
			row.Status = "removed"
			row.RowVersion++
			row.UpdatedAt = now
			row.EndedAt = &now
			reason := "user_removed"
			row.EndReason = &reason
			if e = st.SaveInput(row); e != nil {
				return e
			}
			uid := agentcore.ID(a.User.ID)
			author := agentcore.ActorRef{Kind: "user", ID: &uid}
			if _, e = appendEvent(st, v, nil, "input/removed", "", map[string]any{"input_id": agentcore.ID(row.ID), "revision": agentcore.Version(row.ContentRevision), "reason": reason, "actor_ref": author}, nil, now); e != nil {
				return e
			}
			if e = returnLateAnswer(st, v, row, now); e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			out.Status = 204
			out.Commits = append(out.Commits, eventReceipt(session, from, v.LastSeq))
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
func returnLateAnswer(st StateRepository, session *SessionRow, input *InputRow, now time.Time) error {
	if input.QuestionInteractionID == nil {
		return nil
	}
	question, e := st.Interaction(*input.QuestionInteractionID, true)
	if e != nil {
		return e
	}
	if question == nil {
		return integrity()
	}
	if session.ArchivedAt != nil || question.PendingReplyInputID == nil || *question.PendingReplyInputID != input.ID {
		return nil
	}
	switch {
	case question.Kind == "question" && question.Status == "reply_queued":
		question.Status = "continued"
	case question.Kind == "approval" && (question.Status == "approved_once" || question.Status == "rejected"):
		question.Status = "pending"
		if !now.Before(question.WaitDeadlineAt) {
			question.Status = "expired"
		}
		question.DecidedAt, question.DecidedByKind, question.DecidedByID, question.AnswerEventSeq = nil, nil, nil, nil
	default:
		return nil
	}
	question.PendingReplyInputID = nil
	question.RowVersion++
	question.UpdatedAt = now
	if e = st.SaveInteraction(question); e != nil {
		return e
	}
	_, e = appendEvent(st, session, &question.RunID, "interaction/decided", "", map[string]any{"interaction_id": agentcore.ID(question.ID), "kind": question.Kind, "status": question.Status, "actor_ref": nil, "answer": nil, "decision": nil, "pending_reply_input_id": nil, "reason": "reply_removed"}, nil, now)
	return e
}
