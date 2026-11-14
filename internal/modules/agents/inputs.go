package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func hexHash(hash []byte) string { return hex.EncodeToString(hash) }
func isImage(media string) bool {
	return media == "image/png" || media == "image/jpeg" || media == "image/webp"
}
func inputText(view InputView) string {
	parts := []string{}
	if view.Kind == "continue" {
		parts = append(parts, "[Explicit continuation request] Continue the prior task from its committed context. Do not automatically repeat any external action whose result remains unknown.")
	}
	for _, block := range view.Content {
		parts = append(parts, block.Text)
	}
	if view.Answer != nil {
		payload := any(view.Answer)
		if view.QuestionContext != nil {
			payload = map[string]any{"kind": "answer_to_pending_question", "tool": "ask_user_question", "tool_call_id": view.QuestionContext.ToolCallID, "questions": view.QuestionContext.Questions, "answer": view.Answer}
		}
		data, _ := json.Marshal(payload)
		parts = append(parts, string(data))
	}
	if view.Approval != nil {
		data, _ := json.Marshal(view.Approval)
		parts = append(parts, "[Response to prior approval request; the prior action was not executed. Current turn permissions still apply.]\n"+string(data))
	}
	if len(view.Files) > 0 {
		data, _ := json.Marshal(view.Files)
		parts = append(parts, "[Attached platform file references]\n"+string(data))
	}
	return strings.Join(parts, "\n\n")
}
func inputMessageData(view InputView) any {
	if view.Content == nil {
		view.Content = []agentcore.TextBlock{}
	}
	if view.Files == nil {
		view.Files = []agentcore.FileRef{}
	}
	return map[string]any{"input_id": agentcore.ID(view.ID), "revision": agentcore.Version(view.Revision), "origin_kind": view.Origin, "actor_ref": view.Actor, "source_ref": view.Source, "content": view.Content, "file_refs": view.Files, "question_answer": view.Answer, "question_context": view.QuestionContext, "approval_reply": view.Approval}
}

func (s *Service) executionTarget(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, id uint64, a *identity.Auth) (*SessionRow, *Definition, agentcore.LockedModel, EffectiveSelection, error) {
	v, e := s.sessionAccess(st, id, a, true, false)
	if e != nil {
		return nil, nil, agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	model, selection, e := s.selection(tx, r, v)
	if e != nil {
		return nil, nil, model, selection, e
	}
	agent, e := r.Definition(v.AgentID, true)
	if e != nil {
		return nil, nil, model, selection, e
	}
	if e = s.definition(agent); e != nil {
		return nil, nil, model, selection, e
	}
	locked, e := s.sessionAccess(st, id, a, true, true)
	if e != nil {
		return nil, nil, model, selection, e
	}
	if locked.RowVersion != v.RowVersion {
		return nil, nil, model, selection, httpx.E(409, "MODEL_SELECTION_CHANGED", "会话配置已变化，请重新加载")
	}
	if locked.ArchivedAt != nil {
		return nil, nil, model, selection, httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
	}
	if !agent.Enabled {
		return nil, nil, model, selection, httpx.E(409, "AGENT_UNAVAILABLE", "智能体当前不可用")
	}
	if !selection.Availability.Available {
		return nil, nil, model, selection, httpx.E(409, "MODEL_UNAVAILABLE", "所选模型当前不可用")
	}
	executor, e := runtimeOwner(tx, locked)
	if e != nil {
		return nil, nil, model, selection, e
	}
	if e = requireSessionProjects(r, agent, executor, locked.ProjectContextID); e != nil {
		return nil, nil, model, selection, e
	}
	return locked, agent, model, selection, nil
}
func coreRun(v *RunRow) (agentcore.Run, error) {
	root := v.ID
	if v.RootRunID != nil {
		root = *v.RootRunID
	}
	out := agentcore.Run{Ref: agentcore.ExecutionRef{SessionID: agentcore.ID(v.SessionID), RunID: agentcore.ID(v.ID), RootRunID: agentcore.ID(root), Epoch: v.ExecutorEpoch, Fence: v.FenceVersion}, Principal: agentcore.PrincipalRef{Kind: "user", ID: agentcore.ID(v.ExecutorUserID)}, Status: agentcore.RunStatus(v.Status), Step: uint32(v.CurrentStepNo), Deadline: v.DeadlineAt, StopDeadline: v.StopDeadlineAt, Reason: ""}
	if v.TriggerInputID != nil {
		out.TriggerInputID = agentcore.ID(*v.TriggerInputID)
	}
	if v.ParentRunID != nil {
		id := agentcore.ID(*v.ParentRunID)
		out.ParentRunID = &id
	}
	if v.EndedSeq != nil {
		seq := agentcore.Seq(*v.EndedSeq)
		out.EndedSeq = &seq
	}
	if v.EndReason != nil {
		out.Reason = *v.EndReason
	}
	if json.Unmarshal(v.ExecutionPolicySnapshot, &out.Policy) != nil || json.Unmarshal(v.BudgetLimit, &out.Budget.Limit) != nil || json.Unmarshal(v.BudgetReserved, &out.Budget.Reserved) != nil || json.Unmarshal(v.BudgetUsed, &out.Budget.Used) != nil {
		return out, integrity()
	}
	out.Budget.Version = agentcore.Version(v.BudgetRevision)
	return out, nil
}
func (s *Service) inputView(st StateRepository, row *InputRow) (InputView, error) {
	v, e := st.EventAt(row.SessionID, row.CurrentContentSeq)
	if e != nil {
		return InputView{}, e
	}
	if v == nil {
		return InputView{}, integrity()
	}
	facts, e := decodeEvent(*v)
	if e != nil {
		return InputView{}, e
	}
	var payload struct {
		Input InputView `json:"input"`
	}
	if json.Unmarshal(facts.Public, &payload) != nil || payload.Input.ID != row.ID {
		return InputView{}, integrity()
	}
	out := payload.Input
	if out.Content == nil {
		out.Content = []agentcore.TextBlock{}
	}
	if out.Files == nil {
		out.Files = []agentcore.FileRef{}
	}
	out.State = row.Status
	if row.InputKind != "question_reply" || row.ClaimedStepNo != nil && *row.ClaimedStepNo == 1 {
		out.Delivery = "next_turn"
	} else if row.ClaimedStepNo != nil {
		out.Delivery = "next_step"
	}
	out.ClaimedRunID = row.ClaimedRunID
	out.Revision = row.ContentRevision
	out.Version = strings.Trim(s.tag("input", row.ID, row.RowVersion), `"`)
	out.UpdatedAt = row.UpdatedAt
	if e = attachQuestionContext(st, row, &out); e != nil {
		return InputView{}, e
	}
	return out, nil
}
func attachQuestionContext(st StateRepository, row *InputRow, view *InputView) error {
	if row.InputKind != "question_reply" || row.QuestionInteractionID == nil {
		return nil
	}
	q, err := st.Interaction(*row.QuestionInteractionID, false)
	if err != nil {
		return err
	}
	if q == nil {
		return integrity()
	}
	interaction, err := coreInteraction(q)
	if err != nil {
		return err
	}
	view.Source = &agentcore.SourceRef{Kind: "interaction", ID: agentcore.ID(q.ID)}
	view.QuestionContext = &QuestionReplyContext{ToolCallID: agentcore.ID(q.ToolCallID), Questions: interaction.Questions}
	return nil
}
func inputFromPlan(plan agentcore.Input, row *InputRow, version string) InputView {
	if plan.Content == nil {
		plan.Content = []agentcore.TextBlock{}
	}
	if plan.Files == nil {
		plan.Files = []agentcore.FileRef{}
	}
	return InputView{ID: row.ID, SessionID: row.SessionID, Kind: row.InputKind, Content: plan.Content, Files: plan.Files, Answer: plan.Answer, Origin: row.OriginKind, Actor: plan.Actor, Source: plan.Source, Delivery: plan.Delivery, State: row.Status, Position: row.QueueOrder, QueueDeadline: row.QueueDeadlineAt, AcceptedSeq: row.AcceptedSeq, Revision: row.ContentRevision, Version: version, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}
func (s *Service) SubmitInput(ctx context.Context, raw string, id uint64, key string, w InputCreate) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "input.submit", "session:"+strconv.FormatUint(id, 10), w, func(rec *Receipt) error {
			return s.submitInputTx(ctx, tx, r, st, a, out, rec, id, w)
		})
	})
}
func (s *Service) ListInputs(ctx context.Context, raw string, id uint64, q InputQuery) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		if q.Page == 0 {
			q.Page = 1
		}
		if q.PageSize == 0 {
			q.PageSize = 20
		}
		if q.Page < 1 || q.PageSize < 1 || q.PageSize > 100 {
			return httpx.Invalid("page", "invalid_range")
		}
		if q.State == "" {
			q.State = "pending"
		}
		switch q.State {
		case "pending", "claimed", "removed", "expired", "cancelled":
		default:
			return httpx.Invalid("state", "unsupported")
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, false, false); e != nil {
			return e
		}
		rows, total, e := st.Inputs(id, q)
		if e != nil {
			return e
		}
		items := []InputView{}
		for i := range rows {
			v, e := s.inputView(st, &rows[i])
			if e != nil {
				return e
			}
			items = append(items, v)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetInput(ctx context.Context, raw string, session, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, session, a, false, false); e != nil {
			return e
		}
		row, e := st.Input(id, false)
		if e != nil {
			return e
		}
		if row == nil || row.SessionID != session {
			return missing()
		}
		view, e := s.inputView(st, row)
		if e != nil {
			return e
		}
		out.Data = view
		out.Tag = s.tag("input", id, row.RowVersion)
		return nil
	})
}

func (s *Service) submitInputTx(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, a *identity.Auth, out *Result, rec *Receipt, id uint64, w InputCreate) error {
	var e error
	if w.Content == nil {
		return httpx.Invalid("content", "required")
	}
	if e = agentcore.ValidateInput(w.Content, w.Files); e != nil {
		return coreError(e)
	}
	v, agent, model, selection, e := s.executionTarget(ctx, tx, r, st, id, a)
	if e != nil {
		return e
	}
	session, e := coreSession(v)
	if e != nil {
		return e
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	policy := corePolicy(agent)
	user := agentcore.ID(a.User.ID)
	author := agentcore.ActorRef{Kind: "user", ID: &user}
	row := &InputRow{SessionID: id, CommandReceiptID: &rec.ID, InputKind: "message", OriginKind: "human", ActorKind: "user", ActorID: strconv.FormatUint(a.User.ID, 10), LastModifiedByKind: "user", LastModifiedByID: strconv.FormatUint(a.User.ID, 10), Status: "pending", QueueOrder: v.NextInputOrder, ContentRevision: 1, RowVersion: 1, CreatedAt: now, UpdatedAt: now, QueueDeadlineAt: now.Add(time.Duration(policy.QueueTimeoutSeconds) * time.Second)}
	if e = st.InsertInput(row); e != nil {
		return e
	}
	files := w.Files
	if files == nil {
		files = []agentcore.FileRef{}
	}
	plan, e := agentcore.PlanAdmission(agentcore.AdmissionState{Session: session, Candidate: model, Policy: policy}, agentcore.AdmissionCommand{InputID: agentcore.ID(row.ID), Actor: author, Origin: "human", Kind: "message", Content: w.Content, Files: files, ExpectedModelHash: w.ExpectedHash}, now)
	if e != nil {
		return coreError(e)
	}
	from := v.LastSeq + 1
	if v.ModelLockedAt == nil {
		selection.Locked = true
		v.ModelLockedAt = &now
		v.LockedModelConfig, e = json.Marshal(frozenModel{model, selection})
		if e != nil {
			return e
		}
		v.ModelSelectionHash, e = hex.DecodeString(model.SelectionHash)
		if e != nil {
			return integrity()
		}
		v.RowVersion = uint64(plan.Session.Version)
		v.UpdatedAt = now
		if _, e = appendEvent(st, v, nil, "session/configured", "", map[string]any{"configuration": s.configuration(v), "changed_fields": []string{"model_locked_at"}, "actor_ref": author}, nil, now); e != nil {
			return e
		}
	}
	row.AcceptedSeq = v.LastSeq + 1
	row.CurrentContentSeq = row.AcceptedSeq
	v.NextInputOrder = plan.Session.NextInputOrder
	if e = bindInputFiles(st, v, row.ID, a.User.ID, files, model, now); e != nil {
		return e
	}
	view := inputFromPlan(plan.Input, row, strings.Trim(s.tag("input", row.ID, row.RowVersion), `"`))
	if _, e = appendEvent(st, v, nil, "input/accepted", "", map[string]any{"input": view}, nil, now); e != nil {
		return e
	}
	if e = st.SaveInput(row); e != nil {
		return e
	}
	if e = st.SaveSession(v); e != nil {
		return e
	}
	out.Status = 202
	out.Data = InputAccepted{InputID: row.ID, Delivery: "next_turn", QueuePaused: v.QueuePaused, AcceptedSeq: row.AcceptedSeq}
	out.Commits = append(out.Commits, eventReceipt(id, from, v.LastSeq))
	kind := "session"
	rec.TargetKind = &kind
	rec.TargetID = &v.ID
	return nil
}
