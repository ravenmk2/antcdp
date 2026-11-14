package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type childReference struct {
	Kind      string       `json:"kind"`
	SessionID agentcore.ID `json:"session_id"`
	RunID     agentcore.ID `json:"run_id"`
}

func (s *Service) CreateChild(ctx context.Context, request agentcore.ChildRequest) (agentcore.ChildClaim, error) {
	var out agentcore.ChildClaim
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, request.Parent.Ref, true)
		if e != nil {
			return e
		}
		if x.Run.RootRunID != nil {
			return httpx.E(409, "CHILD_DEPTH_EXCEEDED", "不允许子任务再次委派")
		}
		if request.SessionID != 0 || request.RunID != 0 {
			return httpx.Invalid("child", "server_generated_ids")
		}
		if e = agentcore.ValidateInput(request.Content, request.Files); e != nil {
			return coreError(e)
		}
		parent, e := st.ToolCall(uint64(request.Parent.ID), true)
		if e != nil {
			return e
		}
		if parent == nil || parent.RunID != x.Run.ID || parent.ExecutionClass != "child" || parent.DispatchToken == nil || parent.ResultEventSeq != nil {
			return httpx.E(409, "CHILD_NOT_AUTHORIZED", "委派调用当前不可执行")
		}
		if len(parent.ExecutionRef) > 0 && string(parent.ExecutionRef) != "null" {
			var existing childReference
			if json.Unmarshal(parent.ExecutionRef, &existing) != nil || existing.Kind != "child" {
				return integrity()
			}
			out.Created = false
			return nil
		}
		call, e := preparedCall(st, request.Parent.Ref, parent)
		if e != nil {
			return e
		}
		var args struct {
			Task  string              `json:"task"`
			Files []agentcore.FileRef `json:"file_refs"`
		}
		if json.Unmarshal([]byte(call.Call.Arguments), &args) != nil {
			return integrity()
		}
		if args.Files == nil {
			args.Files = []agentcore.FileRef{}
		}
		files := request.Files
		if files == nil {
			files = []agentcore.FileRef{}
		}
		if !same(request.Content, []agentcore.TextBlock{{Type: "text", Text: args.Task}}) || !same(files, args.Files) {
			return httpx.E(409, "TOOL_ARGUMENTS_CHANGED", "子任务必须使用已批准的原始任务参数")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		rootSessionID, parentRunID := x.Session.ID, x.Run.ID
		v := &SessionRow{AgentID: x.Session.AgentID, ExecutionMode: x.Session.ExecutionMode, SessionKind: "child", RootSessionID: &rootSessionID, ParentRunID: &parentRunID, ExecutorUserID: x.Session.ExecutorUserID, Title: "子任务", ProjectContextID: x.Session.ProjectContextID, CloudComputerID: x.RootSession.CloudComputerID, SelectedModelBindingID: x.Session.SelectedModelBindingID, SelectedThinkingOptionKey: x.Session.SelectedThinkingOptionKey, LockedModelConfig: x.Session.LockedModelConfig, ModelSelectionHash: x.Session.ModelSelectionHash, ModelLockedAt: x.Session.ModelLockedAt, NextInputOrder: 1, SurfaceRevision: 1, RowVersion: 1, CreatedByActorKind: "system", CreatedByActorID: "system", CreatedAt: now, UpdatedAt: now, LastActivityAt: now}
		if e = st.InsertSession(v); e != nil {
			return e
		}
		zero, _ := json.Marshal(agentcore.Budget{})
		child := &RunRow{SessionID: v.ID, RootRunID: &parentRunID, ParentRunID: &parentRunID, ExecutorUserID: v.ExecutorUserID, OriginKind: "system", ActorKind: "system", ActorID: "system", Status: "preparing", AgentConfigVersion: x.Agent.RowVersion, ResourceConfigVersion: x.Agent.RowVersion, ExecutionPolicySnapshot: x.Run.ExecutionPolicySnapshot, ModelSelectionHash: v.ModelSelectionHash, BudgetLimit: x.Root.BudgetLimit, BudgetReserved: zero, BudgetUsed: zero, BudgetRevision: 1, ExecutorEpoch: x.Run.ExecutorEpoch, FenceVersion: 1, UsageCompleteness: "complete", CreatedAt: now, DeadlineAt: x.Run.DeadlineAt, UpdatedAt: now}
		if e = st.InsertRun(child); e != nil {
			return e
		}
		request.SessionID = agentcore.ID(v.ID)
		request.RunID = agentcore.ID(child.ID)
		coreS, e := coreSession(x.Session)
		if e != nil {
			return e
		}
		coreR, e := coreRun(x.Run)
		if e != nil {
			return e
		}
		plan, e := agentcore.PlanChild(coreS, coreR, request, now)
		if e != nil {
			return coreError(e)
		}
		count := agentcore.Budget{Children: 1}
		budget, _, e := plan.ParentBudget.Settle(plan.Reservation, &count)
		if e != nil {
			return coreError(e)
		}
		if e = saveLedger(st, x.Root, budget); e != nil {
			return e
		}
		v.ActiveRunID = &child.ID
		input := &InputRow{SessionID: v.ID, InputKind: "message", OriginKind: "system", ActorKind: "system", ActorID: "system", LastModifiedByKind: "system", LastModifiedByID: "system", Status: "claimed", QueueOrder: 1, ContentRevision: 1, RowVersion: 1, CreatedAt: now, UpdatedAt: now, QueueDeadlineAt: child.DeadlineAt, ClaimedAt: &now, ClaimedRunID: &child.ID}
		if e = st.InsertInput(input); e != nil {
			return e
		}
		if e = bindInputFiles(st, x.RootSession, input.ID, 0, request.Files, x.Execution.Model, now); e != nil {
			return e
		}
		view := InputView{ID: input.ID, SessionID: v.ID, Kind: "message", Content: request.Content, Files: files, Origin: "system", Actor: agentcore.ActorRef{Kind: "system"}, Delivery: "next_turn", State: "claimed", Position: 1, QueueDeadline: input.QueueDeadlineAt, Revision: 1, Version: s.tag("input", input.ID, 1), CreatedAt: now, UpdatedAt: now}
		input.AcceptedSeq = 1
		view.AcceptedSeq = 1
		seq, e := appendEvent(st, v, &child.ID, "input/accepted", "", map[string]any{"input": view}, nil, now)
		if e != nil {
			return e
		}
		input.CurrentContentSeq = seq
		input.Status = "pending"
		if e = s.claimInputMessage(st, v, child, input, 1, "next_turn", now); e != nil {
			return e
		}
		v.NextInputOrder = 2
		seq, e = appendEvent(st, v, &child.ID, "run/started", "", map[string]any{"run_id": agentcore.ID(child.ID), "trigger_input_id": nil, "root_run_id": agentcore.ID(x.Root.ID), "parent_run_id": agentcore.ID(x.Run.ID), "principal": x.Execution.Principal, "deadline_at": child.DeadlineAt, "execution_policy": child.ExecutionPolicySnapshot}, nil, now)
		if e != nil {
			return e
		}
		child.StartedSeq = &seq
		child.StartedAt = &now
		parent.ExecutionRef, e = json.Marshal(childReference{Kind: "child", SessionID: agentcore.ID(v.ID), RunID: agentcore.ID(child.ID)})
		if e != nil {
			return e
		}
		parent.Status = "running"
		parent.UpdatedAt = now
		if e = st.SaveToolCall(parent); e != nil {
			return e
		}
		if e = st.SaveRun(child); e != nil {
			return e
		}
		if e = st.SaveSession(v); e != nil {
			return e
		}
		from := x.Session.LastSeq + 1
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		out.Created = true
		out.Execution = agentcore.ExecutionContext{Ref: plan.Run.Ref, AgentID: agentcore.ID(v.AgentID), Principal: x.Execution.Principal, Authorization: x.Execution.Authorization, ContentSessionID: agentcore.ID(x.RootSession.ID), Policy: x.Execution.Policy, Model: x.Execution.Model, Binding: x.Execution.Binding, Deadline: child.DeadlineAt}
		out.Receipt = eventReceipt(v.ID, 1, v.LastSeq)
		if x.Session.LastSeq >= from {
			out.Receipt.Ranges = append(out.Receipt.Ranges, agentcore.EventRange{SessionID: agentcore.ID(x.Session.ID), From: agentcore.Seq(from), Through: agentcore.Seq(x.Session.LastSeq)})
		}
		return nil
	})
	return out, e
}

func childSummary(st StateRepository, v *SessionRow) (*string, error) {
	var text string
	after := uint64(0)
	for {
		rows, e := st.SurfaceEvents(v.ID, after, v.LastSeq, 500)
		if e != nil {
			return nil, e
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			after = row.Seq
			if row.EventType != "assistant/message" {
				continue
			}
			f, e := decodeEvent(row)
			if e != nil {
				return nil, e
			}
			if f.Message != nil && len(f.Message.ToolCalls) == 0 {
				text = f.Message.Content
			}
		}
	}
	if text == "" {
		return nil, nil
	}
	runes := []rune(text)
	if len(runes) > 2000 {
		text = string(runes[:2000])
	}
	return &text, nil
}
func delegation(st StateRepository, parentRun, childRun uint64) (*ToolCallRow, error) {
	rows, e := st.RunTools(parentRun)
	if e != nil {
		return nil, e
	}
	for _, row := range rows {
		if row.ExecutionClass != "child" || len(row.ExecutionRef) == 0 {
			continue
		}
		var ref childReference
		if json.Unmarshal(row.ExecutionRef, &ref) == nil && ref.Kind == "child" && uint64(ref.RunID) == childRun {
			return st.ToolCall(row.ID, true)
		}
	}
	return nil, integrity()
}

func (s *Service) settleChildResult(st StateRepository, parentSession, childSession *SessionRow, root, child *RunRow, now time.Time) (agentcore.ToolCommit, error) {
	call, e := delegation(st, root.ID, child.ID)
	if e != nil {
		return agentcore.ToolCommit{}, e
	}
	if call.ResultEventSeq != nil {
		return loadToolCommit(st, call)
	}
	summary, e := childSummary(st, childSession)
	if e != nil {
		return agentcore.ToolCommit{}, e
	}
	result := map[string]any{"session_id": agentcore.ID(child.SessionID), "run_id": agentcore.ID(child.ID), "status": child.Status, "reason_code": child.EndReason, "result_summary": summary, "artifact_ids": []agentcore.ID{}}
	content, e := json.Marshal(result)
	if e != nil {
		return agentcore.ToolCommit{}, e
	}
	yes := true
	if e = settleToolBudget(st, root, call, &yes); e != nil {
		return agentcore.ToolCommit{}, e
	}
	return settleToolEvent(st, parentSession, call, "succeeded", &yes, string(content), "", map[string]any{"child_result": result}, now)
}
func (s *Service) EndChild(ctx context.Context, ref agentcore.ExecutionRef, end agentcore.ChildEnd) (agentcore.ChildCommit, error) {
	var out agentcore.ChildCommit
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		initial, e := st.Run(uint64(ref.RunID), false)
		if e != nil {
			return e
		}
		if initial == nil || initial.RootRunID == nil || *initial.RootRunID != uint64(ref.RootRunID) {
			return missing()
		}
		rootInitial, e := st.Run(*initial.RootRunID, false)
		if e != nil {
			return e
		}
		if rootInitial == nil {
			return integrity()
		}
		parentSession, e := st.Session(rootInitial.SessionID, true)
		if e != nil {
			return e
		}
		childSession, e := st.Session(initial.SessionID, true)
		if e != nil {
			return e
		}
		if parentSession == nil || childSession == nil {
			return integrity()
		}
		root, e := st.Run(rootInitial.ID, true)
		if e != nil {
			return e
		}
		child, e := st.Run(initial.ID, true)
		if e != nil {
			return e
		}
		if root == nil || child == nil || child.ExecutorEpoch != ref.Epoch {
			return integrity()
		}
		fromParent, fromChild := parentSession.LastSeq+1, childSession.LastSeq+1
		now := time.Now().UTC().Truncate(time.Millisecond)
		if !agentcore.RunStatus(child.Status).Terminal() {
			if child.FenceVersion != ref.Fence {
				return httpx.E(409, "EXECUTION_FENCED", "子任务执行已失效")
			}
			if e = s.endOne(st, childSession, child, root, end.End, now); e != nil {
				return e
			}
		}
		commit, e := s.settleChildResult(st, parentSession, childSession, root, child, now)
		if e != nil {
			return e
		}
		if e = st.SaveSession(parentSession); e != nil {
			return e
		}
		if e = st.SaveSession(childSession); e != nil {
			return e
		}
		out.Receipt = commit.Receipt
		out.Receipt.Ranges = nil
		if parentSession.LastSeq >= fromParent {
			out.Receipt.Ranges = append(out.Receipt.Ranges, agentcore.EventRange{SessionID: agentcore.ID(parentSession.ID), From: agentcore.Seq(fromParent), Through: agentcore.Seq(parentSession.LastSeq)})
		}
		if childSession.LastSeq >= fromChild {
			out.Receipt.Ranges = append(out.Receipt.Ranges, agentcore.EventRange{SessionID: agentcore.ID(childSession.ID), From: agentcore.Seq(fromChild), Through: agentcore.Seq(childSession.LastSeq)})
		}
		if len(out.Receipt.Ranges) == 0 {
			out.Receipt.Ranges = commit.Receipt.Ranges
		}
		out.Result = commit.Result
		out.Result.Receipt = out.Receipt
		return nil
	})
	return out, e
}

var _ agentcore.RunStore = (*Service)(nil)
var _ agentcore.StepStore = (*Service)(nil)
var _ agentcore.ToolStore = (*Service)(nil)
