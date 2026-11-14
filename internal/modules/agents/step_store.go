package agents

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) claimInputMessage(st StateRepository, v *SessionRow, run *RunRow, input *InputRow, step uint64, delivery string, now time.Time) error {
	view, e := s.inputView(st, input)
	if e != nil {
		return e
	}
	input.Status = "claimed"
	input.RowVersion++
	input.ClaimedRunID = &run.ID
	input.ClaimedStepNo = &step
	input.ClaimedAt = &now
	input.UpdatedAt = now
	message := modelcore.Message{Role: "user", Content: inputText(view)}
	refs, e := st.InputFiles(input.ID)
	if e != nil {
		return e
	}
	for _, ref := range refs {
		file, e := st.File(ref.FileID, false)
		if e != nil {
			return e
		}
		if file == nil {
			return integrity()
		}
		if isImage(file.MediaType) {
			message.Images = append(message.Images, modelcore.ImagePart{MIME: file.MediaType, ContentSHA256: hexHash(ref.SourceSHA256)})
		}
	}
	seq, e := appendEvent(st, v, &run.ID, "input/message", "input-message:"+strconv.FormatUint(input.ID, 10), inputMessageData(view), &StoredEvent{Message: &message}, now)
	if e != nil {
		return e
	}
	input.MessageSeq = &seq
	if _, e = appendEvent(st, v, &run.ID, "input/claimed", "", map[string]any{"input_id": agentcore.ID(input.ID), "revision": agentcore.Version(input.ContentRevision), "run_id": agentcore.ID(run.ID), "delivery": delivery}, nil, now); e != nil {
		return e
	}
	if e = s.claimReply(st, v, input, now); e != nil {
		return e
	}
	return st.SaveInput(input)
}
func (s *Service) claimReply(st StateRepository, v *SessionRow, input *InputRow, now time.Time) error {
	if input.QuestionInteractionID == nil {
		return nil
	}
	q, e := st.Interaction(*input.QuestionInteractionID, true)
	if e != nil {
		return e
	}
	if q == nil || q.PendingReplyInputID == nil || *q.PendingReplyInputID != input.ID || (q.Kind == "question" && q.Status != "reply_queued" || q.Kind == "approval" && q.Status != "approved_once" && q.Status != "rejected") {
		return integrity()
	}
	view, e := s.inputView(st, input)
	if e != nil {
		return e
	}
	if q.Kind == "question" {
		q.Status = "answered"
	}
	q.PendingReplyInputID = nil
	q.RowVersion++
	q.UpdatedAt = now
	q.DecidedAt = &now
	kind, id := input.ActorKind, input.ActorID
	q.DecidedByKind = &kind
	q.DecidedByID = &id
	var decision *string
	if view.Approval != nil {
		decision = &view.Approval.Decision
	}
	seq, e := appendEvent(st, v, &q.RunID, "interaction/decided", "", map[string]any{"interaction_id": agentcore.ID(q.ID), "kind": q.Kind, "status": q.Status, "actor_ref": view.Actor, "answer": view.Answer, "decision": decision, "pending_reply_input_id": nil, "reason": "reply_claimed"}, nil, now)
	if e != nil {
		return e
	}
	q.AnswerEventSeq = &seq
	q.ProjectionSeq = seq
	return st.SaveInteraction(q)
}

// Only question replies steer a running turn; ordinary messages retain FIFO admission.
func (s *Service) claimQuestionReplies(st StateRepository, session *SessionRow, run *RunRow, step uint64, now time.Time) ([]agentcore.ID, error) {
	ids := []agentcore.ID{}
	if session.QueuePaused || run.RootRunID != nil || step <= 1 {
		return ids, nil
	}
	questions, err := st.SessionInteractions(session.ID)
	if err != nil {
		return nil, err
	}
	inputs := []*InputRow{}
	for _, question := range questions {
		if question.Kind != "question" || question.Status != "reply_queued" || question.PendingReplyInputID == nil {
			continue
		}
		input, err := st.Input(*question.PendingReplyInputID, true)
		if err != nil {
			return nil, err
		}
		if input != nil && input.Status == "pending" && now.Before(input.QueueDeadlineAt) {
			inputs = append(inputs, input)
		}
	}
	sort.Slice(inputs, func(i, j int) bool { return inputs[i].QueueOrder < inputs[j].QueueOrder })
	for _, input := range inputs {
		if err := s.claimInputMessage(st, session, run, input, step, "next_step", now); err != nil {
			return nil, err
		}
		ids = append(ids, agentcore.ID(input.ID))
	}
	return ids, nil
}

func (s *Service) BeginStep(ctx context.Context, ref agentcore.ExecutionRef, step uint32) (agentcore.StepBoundary, error) {
	var out agentcore.StepBoundary
	var committed agentcore.CommitReceipt
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if step == 0 || step > x.Execution.Policy.MaxSteps {
			return httpx.E(409, "STEP_LIMIT_EXCEEDED", "已达到步骤上限")
		}
		if uint64(step) != x.Run.CurrentStepNo+1 {
			return httpx.E(409, "STEP_ALREADY_STARTED", "步骤边界已经推进")
		}
		from := x.Session.LastSeq + 1
		x.Run.CurrentStepNo = uint64(step)
		x.Run.UpdatedAt = now
		if x.Run.Status == "preparing" {
			old := x.Run.Status
			x.Run.Status = "running"
			if _, e = appendEvent(st, x.Session, &x.Run.ID, "run/state", "", map[string]any{"run_id": ref.RunID, "previous_status": old, "status": "running", "reason_code": nil}, nil, now); e != nil {
				return e
			}
		}
		out.InputIDs, e = s.claimQuestionReplies(st, x.Session, x.Run, uint64(step), now)
		if e != nil {
			return e
		}
		if e = st.SaveRun(x.Run); e != nil {
			return e
		}
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		out.Session, e = coreSession(x.Session)
		if e != nil {
			return e
		}
		out.Manifest, _, e = loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		out.Ref = ref
		out.Step = step
		if x.Session.LastSeq >= from {
			committed = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
		}
		return nil
	})
	if e == nil && s.Committed != nil && len(committed.Ranges) > 0 {
		s.Committed(ctx, committed)
	}
	return out, e
}

// CommitContext compares against the currently visible projection while holding
// its revision. Unrelated queue and preference events do not invalidate it.
func (s *Service) CommitContext(ctx context.Context, ref agentcore.ExecutionRef, update agentcore.ContextUpdate) (agentcore.ContextCommit, error) {
	var out agentcore.ContextCommit
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		if x.Session.SurfaceRevision != uint64(update.SurfaceRevision) {
			return httpx.E(409, "SURFACE_CHANGED", "上下文发生变化")
		}
		m, facts, e := loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		visible := []agentcore.ContextFact{}
		for _, entry := range m.Entries {
			if entry.Kind == "context" {
				for _, seq := range entry.Sequences {
					if facts[seq].Context != nil {
						visible = append(visible, *facts[seq].Context)
					}
				}
			}
		}
		from := x.Session.LastSeq + 1
		now := time.Now().UTC().Truncate(time.Millisecond)
		for _, fact := range update.Events {
			if fact.Kind != "context/runtime" && fact.Kind != "context/skills" && fact.Kind != "context/authorization" {
				return httpx.Invalid("context", "invalid_kind")
			}
			changed, e := agentcore.ChangedContext(visible, fact)
			if e != nil {
				return e
			}
			if !changed {
				continue
			}
			var public map[string]any
			if json.Unmarshal(fact.Content, &public) != nil {
				return integrity()
			}
			if fact.Kind == "context/skills" {
				// Integrity participates in model-context change detection, but the
				// public directory exposes only the documented name/description.
				if entries, ok := public["entries"].([]any); ok {
					for _, entry := range entries {
						if fields, ok := entry.(map[string]any); ok {
							delete(fields, "integrity")
						}
					}
				}
			}
			if _, e = appendEvent(st, x.Session, &x.Run.ID, fact.Kind, "", public, &StoredEvent{Context: &fact}, now); e != nil {
				return e
			}
			visible = append(visible, fact)
		}
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		out.SurfaceRevision = agentcore.Version(x.Session.SurfaceRevision)
		if x.Session.LastSeq >= from {
			out.Receipt = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
		}
		return nil
	})
	return out, e
}
