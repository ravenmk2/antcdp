package agents

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func settleToolEvent(st StateRepository, session *SessionRow, call *ToolCallRow, status string, executed *bool, content, reason string, extra map[string]any, now time.Time, images ...modelcore.ImagePart) (agentcore.ToolCommit, error) {
	if call.ResultEventSeq != nil {
		return loadToolCommit(st, call)
	}
	from := session.LastSeq + 1
	certainty := "known"
	if status == "outcome_unknown" {
		certainty = "unknown"
	}
	var why *string
	if reason != "" {
		why = &reason
	}
	data := map[string]any{"tool_call_id": agentcore.ID(call.ID), "status": status, "executed": executed, "content": []agentcore.ContentBlock{{Type: "text", Text: content}}, "truncated": false, "outcome": map[string]any{"certainty": certainty, "reason": why}}
	for key, value := range extra {
		data[key] = value
	}
	if len(images) > 0 && (call.ToolKey != "read_image" || status != "succeeded" || len(images) != 1 || images[0].Origin != "tool_image" || images[0].DataBase64 != "") {
		return agentcore.ToolCommit{}, integrity()
	}
	message := modelcore.Message{Role: "tool", ToolCallID: call.ProviderCallID, Content: content, Images: images}
	truncated, _ := data["truncated"].(bool)
	for {
		public, e := json.Marshal(data)
		if e != nil {
			return agentcore.ToolCommit{}, e
		}
		encoded, e := agentcore.CanonicalJSON(StoredEvent{Public: public, Message: &message, ModelCallID: agentcore.ID(call.ModelCallID), ToolCallID: call.ProviderCallID, Ordinal: uint32(call.CallOrdinal)})
		if e != nil {
			return agentcore.ToolCommit{}, e
		}
		if len(encoded) <= agentcore.MaxEventBytes {
			break
		}
		if len(content) == 0 {
			return agentcore.ToolCommit{}, httpx.E(422, "OUTPUT_LIMIT_EXCEEDED", "工具结果元数据超过事件上限")
		}
		content = content[:len(content)/2]
		for !utf8.ValidString(content) {
			content = content[:len(content)-1]
		}
		message.Content = content
		data["content"] = []agentcore.ContentBlock{{Type: "text", Text: content}}
		data["truncated"] = true
		truncated = true
	}
	seq, e := appendEvent(st, session, &call.RunID, "tool/result", agentcore.ToolResultKey(agentcore.ID(call.ID)), data, &StoredEvent{Message: &message, ModelCallID: agentcore.ID(call.ModelCallID), ToolCallID: call.ProviderCallID, Ordinal: uint32(call.CallOrdinal)}, now)
	if e != nil {
		return agentcore.ToolCommit{}, e
	}
	call.Status = status
	call.Executed = executed
	call.ResultEventSeq = &seq
	call.ErrorCode = why
	call.FinishedAt = &now
	call.UpdatedAt = now
	if e = st.SaveToolCall(call); e != nil {
		return agentcore.ToolCommit{}, e
	}
	receipt := eventReceipt(session.ID, from, session.LastSeq)
	receipt.ToolCallID = agentcore.ID(call.ID)
	receipt.ToolResultSessionID = agentcore.ID(session.ID)
	receipt.ToolResultSeq = agentcore.Seq(seq)
	return agentcore.ToolCommit{Receipt: receipt, Result: agentcore.ToolCompletion{Status: status, Executed: executed, Content: content, Truncated: truncated, Reason: reason, Receipt: receipt}}, nil
}
func loadToolCommit(st StateRepository, call *ToolCallRow) (agentcore.ToolCommit, error) {
	if call.ResultEventSeq == nil {
		return agentcore.ToolCommit{}, httpx.E(409, "TOOL_NOT_SETTLED", "工具结果尚未结算")
	}
	row, e := st.EventAt(call.SessionID, *call.ResultEventSeq)
	if e != nil {
		return agentcore.ToolCommit{}, e
	}
	if row == nil {
		return agentcore.ToolCommit{}, integrity()
	}
	facts, e := decodeEvent(*row)
	if e != nil {
		return agentcore.ToolCommit{}, e
	}
	var data struct {
		Content   []agentcore.ContentBlock `json:"content"`
		Truncated bool                     `json:"truncated"`
	}
	if json.Unmarshal(facts.Public, &data) != nil {
		return agentcore.ToolCommit{}, integrity()
	}
	content := ""
	for _, block := range data.Content {
		if block.Type == "text" {
			content += block.Text
		}
	}
	receipt := eventReceipt(call.SessionID, *call.ResultEventSeq, *call.ResultEventSeq)
	receipt.ToolCallID = agentcore.ID(call.ID)
	receipt.ToolResultSessionID = agentcore.ID(call.SessionID)
	receipt.ToolResultSeq = agentcore.Seq(*call.ResultEventSeq)
	reason := ""
	if call.ErrorCode != nil {
		reason = *call.ErrorCode
	}
	return agentcore.ToolCommit{Receipt: receipt, Result: agentcore.ToolCompletion{Status: call.Status, Executed: call.Executed, Content: content, Truncated: data.Truncated, Reason: reason, Receipt: receipt}}, nil
}
func (s *Service) ActivateBinding(ctx context.Context, ref agentcore.ExecutionRef, binding agentcore.BindingRef) (agentcore.CommitReceipt, error) {
	if s.Sandboxes == nil {
		return agentcore.CommitReceipt{}, httpx.E(409, "SANDBOX_UNAVAILABLE", "沙箱未配置")
	}
	return s.Sandboxes.activateBinding(ctx, ref, binding)
}

// EndRoot locks every family Session before Run rows. Logical termination never
// releases a physical reference or silently replays an uncertain dispatch.
func (s *Service) EndRoot(ctx context.Context, ref agentcore.ExecutionRef, end agentcore.RunEnd) (agentcore.CommitReceipt, error) {
	var out agentcore.CommitReceipt
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		out = agentcore.CommitReceipt{}
		if !end.Status.Terminal() || ref.RunID != ref.RootRunID {
			return httpx.Invalid("run_end", "invalid_state")
		}
		// Child creation also holds this root Session lock, so the following
		// family enumeration cannot miss a concurrently committed child.
		rootSession, e := st.Session(uint64(ref.SessionID), true)
		if e != nil {
			return e
		}
		if rootSession == nil {
			return missing()
		}
		family, e := st.FamilyRuns(uint64(ref.RunID))
		if e != nil {
			return e
		}
		if len(family) == 0 {
			return missing()
		}
		ids := []uint64{}
		for _, row := range family {
			ids = append(ids, row.SessionID)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		sessions := map[uint64]*SessionRow{}
		starts := map[uint64]uint64{}
		for _, id := range ids {
			if sessions[id] != nil {
				continue
			}
			v, e := st.Session(id, true)
			if e != nil {
				return e
			}
			if v == nil {
				return integrity()
			}
			sessions[id] = v
			starts[id] = v.LastSeq + 1
		}
		root, e := st.Run(uint64(ref.RunID), true)
		if e != nil {
			return e
		}
		if root == nil || root.SessionID != uint64(ref.SessionID) || root.RootRunID != nil {
			return missing()
		}
		if root.ExecutorEpoch != ref.Epoch {
			return httpx.E(409, "EXECUTION_FENCED", "执行器已失效")
		}
		if agentcore.RunStatus(root.Status).Terminal() {
			if root.EndedSeq == nil {
				return integrity()
			}
			out = eventReceipt(root.SessionID, *root.EndedSeq, *root.EndedSeq)
			return nil
		}
		if root.FenceVersion != ref.Fence {
			return httpx.E(409, "EXECUTION_FENCED", "执行器已失效")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if end.Reason == "model_attempt_expired" {
			due := false
			for _, member := range family {
				calls, e := st.RunModelCalls(member.ID)
				if e != nil {
					return e
				}
				for _, call := range calls {
					if call.Status == "running" && !now.Before(call.DeadlineAt.Add(15*time.Second)) {
						due = true
					}
				}
			}
			if !due {
				return nil
			}
		}
		// Children are settled first. The parent's delegation call is closed
		// below in the same transaction, so no observer sees a detached child.
		for i := len(family) - 1; i >= 0; i-- {
			if family[i].ID == root.ID {
				continue
			}
			child, e := st.Run(family[i].ID, true)
			if e != nil {
				return e
			}
			if child == nil {
				return integrity()
			}
			if agentcore.RunStatus(child.Status).Terminal() {
				continue
			}
			childEnd := agentcore.RunEnd{Status: agentcore.Interrupted, Reason: "parent_run_ended"}
			if end.Status == agentcore.Succeeded {
				return httpx.E(409, "CHILD_NOT_SETTLED", "子任务尚未结算")
			}
			if e = s.endOne(st, sessions[child.SessionID], child, root, childEnd, now); e != nil {
				return e
			}
			if _, e = s.settleChildResult(st, sessions[root.SessionID], sessions[child.SessionID], root, child, now); e != nil {
				return e
			}
		}
		if e = s.endOne(st, sessions[root.SessionID], root, root, end, now); e != nil {
			return e
		}
		if e = settleFamily(st, root, sessions, now); e != nil {
			return e
		}
		for _, id := range ids {
			v := sessions[id]
			if v.LastSeq >= starts[id] {
				out.Ranges = append(out.Ranges, agentcore.EventRange{SessionID: agentcore.ID(id), From: agentcore.Seq(starts[id]), Through: agentcore.Seq(v.LastSeq)})
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
		}
		return nil
	})
	return out, e
}
func (s *Service) endOne(st StateRepository, session *SessionRow, row, root *RunRow, end agentcore.RunEnd, now time.Time) error {
	modelCalls, e := st.RunModelCalls(row.ID)
	if e != nil {
		return e
	}
	for i := range modelCalls {
		call := &modelCalls[i]
		if call.Purpose != "generation" || call.ResponseEventSeq != nil || call.Status != "running" {
			continue
		}
		reason := "MODEL_RESULT_UNCONFIRMED"
		message := modelcore.Message{Role: "assistant"}
		seq, e := appendEvent(st, session, &row.ID, "assistant/attempt", "model-result:"+strconv.FormatUint(call.ID, 10), map[string]any{"attempt_id": agentcore.ID(call.ID), "model_call_id": agentcore.ID(call.ID), "status": "interrupted", "content": []agentcore.ContentBlock{}, "partial": false, "reason_code": reason}, &StoredEvent{Message: &message, ModelCallID: agentcore.ID(call.ID)}, now)
		if e != nil {
			return e
		}
		call.ResponseEventSeq = &seq
		call.Status = "interrupted"
		call.ErrorCode = &reason
		call.FinishedAt = &now
		if e = settleModelBudget(st, root, call, modelcore.Usage{}); e != nil {
			return e
		}
		if e = st.SaveModelCall(call); e != nil {
			return e
		}
		if end.Status == agentcore.Succeeded {
			end = agentcore.RunEnd{Status: agentcore.Interrupted, Reason: reason}
		}
	}
	state, e := coreSession(session)
	if e != nil {
		return e
	}
	run, e := coreRun(row)
	if e != nil {
		return e
	}
	pending := []InputRow{}
	for page := 1; ; page++ {
		rows, total, e := st.Inputs(session.ID, InputQuery{Page: page, PageSize: 100, State: "pending"})
		if e != nil {
			return e
		}
		pending = append(pending, rows...)
		if len(pending) >= total {
			break
		}
	}
	interactions, e := st.SessionInteractions(session.ID)
	if e != nil {
		return e
	}
	inputs := []agentcore.Input{}
	for _, v := range pending {
		i := agentcore.Input{ID: agentcore.ID(v.ID), SessionID: agentcore.ID(v.SessionID), State: v.Status, Delivery: "next_turn", Version: agentcore.Version(v.RowVersion)}

		inputs = append(inputs, i)
	}
	questions := []agentcore.Interaction{}
	for _, v := range interactions {
		questions = append(questions, agentcore.Interaction{ID: agentcore.ID(v.ID), SessionID: agentcore.ID(v.SessionID), RunID: agentcore.ID(v.RunID), Kind: v.Kind, Status: v.Status, Version: agentcore.Version(v.RowVersion)})
	}
	tools, e := st.RunTools(row.ID)
	if e != nil {
		return e
	}
	unsettled := false
	for _, call := range tools {
		unsettled = unsettled || call.ResultEventSeq == nil
	}
	if end.Status == agentcore.Succeeded && unsettled {
		end = agentcore.RunEnd{Status: agentcore.Failed, Reason: "TOOL_GROUP_INCOMPLETE"}
	}
	plan, e := agentcore.PlanEnd(state, run, end, inputs, questions)
	if e != nil {
		return coreError(e)
	}
	if !plan.Changed {
		return nil
	}
	physical := "none"
	for i := range tools {
		call := &tools[i]
		if call.ResultEventSeq != nil {
			if call.Status == "outcome_unknown" {
				physical = "reconciling"
			}
			continue
		}
		executed := false
		resultStatus := "cancelled"
		resultExecuted := &executed
		reason := "RUN_ENDED"
		if (call.Status == "dispatching" || call.Status == "running") && call.ExecutionClass != "question" {
			resultStatus = "outcome_unknown"
			resultExecuted = nil
			reason = "TOOL_RESULT_UNCONFIRMED"
			physical = "reconciling"
		}
		if call.ExecutionClass == "question" && call.InteractionID != nil {
			resultStatus = "succeeded"
			executed = true
			resultExecuted = &executed
			reason = "question_pending"
		}
		if e = settleToolBudget(st, root, call, resultExecuted); e != nil {
			return e
		}
		if _, e = settleToolEvent(st, session, call, resultStatus, resultExecuted, "执行已结束，工具没有可确认的完整结果。", reason, nil, now); e != nil {
			return e
		}
	}
	for i, planned := range plan.Inputs {
		v := &pending[i]
		if uint64(planned.Version) == v.RowVersion {
			continue
		}
		v.Status = planned.State
		if planned.State == "cancelled" {
			v.EndedAt = &now
			reason := "RUN_ENDED"
			v.EndReason = &reason
		}
		v.RowVersion = uint64(planned.Version)
		v.UpdatedAt = now
		if e = st.SaveInput(v); e != nil {
			return e
		}
		view, e := s.inputView(st, v)
		if e != nil {
			return e
		}
		if _, e = appendEvent(st, session, nil, "input/updated", "", map[string]any{"input": view, "previous_revision": agentcore.Version(v.ContentRevision), "actor_ref": agentcore.ActorRef{Kind: "system"}}, nil, now); e != nil {
			return e
		}
	}
	for i, planned := range plan.Interactions {
		v := &interactions[i]
		if planned.Status == v.Status {
			continue
		}
		v.Status = planned.Status
		v.RowVersion = uint64(planned.Version)
		v.UpdatedAt = now
		if e = st.SaveInteraction(v); e != nil {
			return e
		}
		if _, e = appendEvent(st, session, &row.ID, "interaction/decided", "", map[string]any{"interaction_id": agentcore.ID(v.ID), "kind": v.Kind, "status": v.Status, "actor_ref": nil, "answer": nil, "decision": nil, "pending_reply_input_id": stringID(v.PendingReplyInputID), "reason": "run_ended"}, nil, now); e != nil {
			return e
		}
	}
	if session.QueuePaused != plan.Session.QueuePaused {
		session.QueuePaused = plan.Session.QueuePaused
		if _, e = appendEvent(st, session, &row.ID, "queue/state", "", map[string]any{"queue_paused": session.QueuePaused, "reason": "run_ended", "actor_ref": nil}, nil, now); e != nil {
			return e
		}
	}
	row.Status = string(plan.Run.Status)
	row.FenceVersion = plan.Run.Ref.Fence
	row.FinishedAt = &now
	row.UpdatedAt = now
	row.EndReason = nil
	if plan.Run.Reason != "" {
		row.EndReason = &plan.Run.Reason
	}
	seq, e := appendEvent(st, session, &row.ID, "run/ended", "run-ended:"+strconv.FormatUint(row.ID, 10), map[string]any{"run_id": agentcore.ID(row.ID), "status": row.Status, "reason_code": row.EndReason, "finished_at": now, "usage_completeness": row.UsageCompleteness, "physical_activity_state": physical}, nil, now)
	if e != nil {
		return e
	}
	row.EndedSeq = &seq
	return st.SaveRun(row)
}
