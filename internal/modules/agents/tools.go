package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) papiCallSpec(spec agentcore.ToolSpec, raw string, grants []agentcore.PAPIGrant) agentcore.ToolSpec {
	if spec.MCP != nil || spec.Key != papi.CallTool || s.PAPI == nil {
		return spec
	}
	var target struct {
		API string `json:"api"`
	}
	if json.Unmarshal([]byte(raw), &target) != nil {
		return spec
	}
	op := s.PAPI.Operation(target.API)
	if op != nil && op.Effect == "write" && slices.ContainsFunc(grants, func(g agentcore.PAPIGrant) bool { return g.Code == op.Code }) {
		spec.ExecutionClass = "side_effect"
	}
	return spec
}

func preparedCall(st StateRepository, ref agentcore.ExecutionRef, row *ToolCallRow) (agentcore.PreparedToolCall, error) {
	var spec agentcore.ToolSpec
	if json.Unmarshal(row.ToolDefinitionSnapshot, &spec) != nil {
		return agentcore.PreparedToolCall{}, integrity()
	}
	event, e := st.EventAt(row.SessionID, row.ArgumentsEventSeq)
	if e != nil {
		return agentcore.PreparedToolCall{}, e
	}
	if event == nil {
		return agentcore.PreparedToolCall{}, integrity()
	}
	facts, e := decodeEvent(*event)
	if e != nil {
		return agentcore.PreparedToolCall{}, e
	}
	public, e := facts.toolCallDetails()
	if e != nil {
		return agentcore.PreparedToolCall{}, e
	}
	hash, e := agentcore.ContentHash(public.Arguments)
	if e != nil || hash != hexHash(row.ArgumentsHash) {
		return agentcore.PreparedToolCall{}, integrity()
	}
	return agentcore.PreparedToolCall{Ref: ref, ID: agentcore.ID(row.ID), ModelCallID: agentcore.ID(row.ModelCallID), Step: uint32(row.StepNo), Ordinal: uint32(row.CallOrdinal), Call: modelcore.ToolCall{ID: row.ProviderCallID, Name: spec.Definition.Name, Arguments: string(public.Arguments)}, Spec: spec}, nil
}
func settleToolBudget(st StateRepository, root *RunRow, call *ToolCallRow, executed *bool) error {
	var reservation agentcore.Reservation
	if json.Unmarshal(call.BudgetReservation, &reservation) != nil {
		return integrity()
	}
	if len(call.BudgetSettlement) > 0 && string(call.BudgetSettlement) != "null" {
		return nil
	}
	if executed == nil {
		return nil
	}
	l, e := ledger(root)
	if e != nil {
		return e
	}
	actual := agentcore.Budget{}
	if *executed {
		actual.ToolCalls = 1
	}
	l, settlement, e := l.Settle(reservation, &actual)
	if e != nil {
		return coreError(e)
	}
	call.BudgetSettlement, e = json.Marshal(settlement)
	if e != nil {
		return e
	}
	return saveLedger(st, root, l)
}
func (s *Service) blockTool(st StateRepository, x executionRows, row *ToolCallRow, reason, content string, now time.Time) (agentcore.DispatchAdmission, error) {
	no := false
	if e := settleToolBudget(st, x.Run, row, &no); e != nil {
		return agentcore.DispatchAdmission{}, e
	}
	if content == "" {
		content = "The tool was not executed: " + reason
	}
	commit, e := settleToolEvent(st, x.Session, row, "blocked", &no, content, reason, nil, now)
	if e != nil {
		return agentcore.DispatchAdmission{}, e
	}
	commit.Receipt.Ranges[0].Through = agentcore.Seq(x.Session.LastSeq)
	commit.Result.Receipt = commit.Receipt
	if e = st.SaveSession(x.Session); e != nil {
		return agentcore.DispatchAdmission{}, e
	}
	return agentcore.DispatchAdmission{Kind: "blocked", Completion: &commit.Result}, nil
}

func resolveToolProject(ctx context.Context, tx identity.Tx, r Repository, x executionRows, tool *ToolDescriptor, args json.RawMessage) (agentcore.ID, error) {
	id, e := tool.ProjectTarget(ctx, tx, x.Execution.Authorization, args)
	if e != nil || id == 0 {
		return 0, e
	}
	if !x.Execution.Authorization.Allows("project", agentcore.ID(id), "member") {
		return 0, nil
	}
	return agentcore.ID(id), nil
}

func (s *Service) PrepareDispatch(ctx context.Context, ref agentcore.ExecutionRef, id agentcore.ID) (agentcore.DispatchAdmission, error) {
	var out agentcore.DispatchAdmission
	var receipt agentcore.CommitReceipt
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		row, e := st.ToolCall(uint64(id), true)
		if e != nil {
			return e
		}
		if row == nil || row.RunID != x.Run.ID || row.ExecutorEpoch != ref.Epoch || row.FenceVersion != ref.Fence {
			return httpx.E(409, "EXECUTION_FENCED", "工具意图已失效")
		}
		if row.ResultEventSeq != nil {
			c, e := loadToolCommit(st, row)
			if e != nil {
				return e
			}
			out = agentcore.DispatchAdmission{Kind: "already_completed", Completion: &c.Result}
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		from := x.Session.LastSeq + 1
		call, e := preparedCall(st, ref, row)
		if e != nil {
			return e
		}
		if row.DispatchToken != nil {
			out.Kind = "await_result"
			return nil
		}
		binding, descriptor, resourceAuthorization, blocked, e := s.resolveDispatchTool(ctx, tx, r, x, call)
		if e != nil {
			return e
		}
		var projectID agentcore.ID
		if blocked == "" && descriptor.ProjectTarget != nil {
			projectID, e = resolveToolProject(ctx, tx, r, x, descriptor, json.RawMessage(call.Call.Arguments))
			if e != nil {
				return e
			}
			if projectID == 0 {
				blocked = "RESOURCE_ACCESS_DENIED"
			}
		}
		var blockedContent string
		if blocked == "" && papi.IsTool(call.Spec.Key) && call.Spec.MCP == nil {
			var authorization papi.Authorization
			authorization, e = s.PAPI.Prepare(ctx, x.Execution, call.Spec.Key, call.Call.Arguments)
			var failure *papi.Failure
			switch {
			case errors.As(e, &failure):
				blocked = failure.Code
				blockedContent = failure.Content()
			case e != nil:
				return e
			default:
				if call.Spec.Key == papi.CallTool && s.PAPI.Operation(authorization.Code).RequiresSandbox() {
					if x.Execution.Binding == nil || x.Execution.Binding.InstanceID == 0 {
						blocked = "SANDBOX_UNAVAILABLE"
						break
					}
				}
				resourceAuthorization, e = json.Marshal(authorization)
				if e != nil {
					return e
				}
			}
		} else if blocked == "" && call.Spec.MCP == nil {
			if s.Catalog.AuthorizeTool == nil {
				blocked = "TOOL_AUTHORIZATION_UNAVAILABLE"
			} else {
				resourceAuthorization, e = s.Catalog.AuthorizeTool(ctx, tx, x.Execution, *descriptor, json.RawMessage(call.Call.Arguments), binding.Constraints)
				if e != nil {
					return e
				}
				if len(resourceAuthorization) == 0 || !json.Valid(resourceAuthorization) || len(resourceAuthorization) > 64<<10 {
					return integrity()
				}
			}
		}
		if blocked != "" {
			out, e = s.blockTool(st, x, row, blocked, blockedContent, now)
			if e == nil {
				receipt = out.Completion.Receipt
			}
			return e
		}
		call.Spec.Policy = binding.Policy
		action, e := agentcore.CheckToolPolicy(x.Execution, call.Spec)
		if e != nil {
			return coreError(e)
		}
		if action == "blocked" || action == "root_intervention_required" {
			out, e = s.blockTool(st, x, row, action, "", now)
			if e == nil {
				receipt = out.Completion.Receipt
			}
			return e
		}
		if row.InteractionID != nil {
			interaction := agentcore.ID(*row.InteractionID)
			out = agentcore.DispatchAdmission{Kind: "await_interaction", InteractionID: &interaction}
			return nil
		}
		if action == "approval" {
			approved, err := consumeApprovalResponse(st, x, row, call, now)
			if err != nil {
				return err
			}
			if !approved {
				interaction, err := s.openInteraction(st, x, row, call, "approval", now)
				if err != nil {
					return err
				}
				out = agentcore.DispatchAdmission{Kind: "await_interaction", InteractionID: &interaction}
				receipt = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
				return nil
			}
		}
		l, e := ledger(x.Run)
		if e != nil {
			return e
		}
		l, res, e := l.Reserve(agentcore.Budget{ToolCalls: 1})
		if e != nil {
			out, e = s.blockTool(st, x, row, "BUDGET_EXCEEDED", "", now)
			if e == nil {
				receipt = out.Completion.Receipt
			}
			return e
		}
		row.BudgetReservation, e = json.Marshal(res)
		if e != nil {
			return e
		}
		if e = saveLedger(st, x.Run, l); e != nil {
			return e
		}
		if call.Spec.ExecutionClass == "question" {
			interaction, e := s.openInteraction(st, x, row, call, "question", now)
			if e != nil {
				return e
			}
			out = agentcore.DispatchAdmission{Kind: "await_interaction", InteractionID: &interaction}
			receipt = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
			return nil
		}
		token := NewStorageKey()
		row.DispatchToken = &token
		row.Status = "dispatching"
		row.DispatchStartedAt = &now
		row.StartedAt = &now
		row.UpdatedAt = now
		row.AgentConfigVersion = x.Agent.RowVersion
		row.ResourceConfigVersion = x.Agent.RowVersion
		authorization := map[string]any{"principal": x.Execution.Principal, "tool_binding_id": agentcore.ID(binding.ID), "agent_configuration_revision": agentcore.Version(x.Agent.RowVersion), "constraints": binding.Constraints, "resource": resourceAuthorization}
		if call.Spec.MCP != nil {
			delete(authorization, "tool_binding_id")
			authorization["mcp_binding_id"] = strconv.FormatUint(binding.ID, 10)
		}
		if projectID != 0 {
			authorization["project_id"] = projectID
		}
		row.AuthorizationSnapshot, e = json.Marshal(authorization)
		if e != nil {
			return e
		}
		if e = st.SaveToolCall(row); e != nil {
			return e
		}
		out = agentcore.DispatchAdmission{Kind: "execute", Permit: agentcore.DispatchPermit{Call: call, Token: token, Deadline: row.DeadlineAt, Authorization: row.AuthorizationSnapshot, ProjectID: projectID}}
		if _, e = appendEvent(st, x.Session, &x.Run.ID, "tool/state", "", map[string]any{"tool_call_id": agentcore.ID(row.ID), "status": "running"}, nil, now); e != nil {
			return e
		}
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		receipt = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
		return nil
	})
	if e == nil && out.Completion != nil && len(receipt.Ranges) == 0 {
		receipt = out.Completion.Receipt
	}
	if e == nil && s.Committed != nil && len(receipt.Ranges) > 0 {
		s.Committed(ctx, receipt)
	}
	return out, e
}

func (s *Service) openInteraction(st StateRepository, x executionRows, row *ToolCallRow, call agentcore.PreparedToolCall, kind string, now time.Time) (agentcore.ID, error) {
	deadline := agentcore.BoundedDeadline(now, x.Execution.Policy.ApprovalTimeoutSeconds, x.Run.DeadlineAt)
	status := "pending"
	var spec json.RawMessage
	if kind == "question" {
		deadline = agentcore.BoundedDeadline(now, x.Execution.Policy.QuestionTimeoutSeconds, x.Run.DeadlineAt)
		status = "waiting"
		var q struct {
			Questions []agentcore.Question `json:"questions"`
		}
		if json.Unmarshal([]byte(call.Call.Arguments), &q) != nil {
			return 0, integrity()
		}
		if e := agentcore.ValidateQuestions(q.Questions); e != nil {
			return 0, coreError(e)
		}
		spec, _ = json.Marshal(q)
	} else {
		summary := []rune(call.Spec.Definition.Description)
		if len(summary) > 1000 {
			summary = summary[:1000]
		}
		spec, _ = json.Marshal(map[string]any{"action": map[string]any{"tool_key": row.ToolKey, "summary": string(summary), "arguments": json.RawMessage(call.Call.Arguments), "arguments_hash": hexHash(row.ArgumentsHash)}})
	}
	q := &InteractionRow{SessionID: x.Session.ID, RunID: x.Run.ID, ToolCallID: row.ID, Kind: kind, Status: status, RequestHash: row.ArgumentsHash, Specification: spec, WaitDeadlineAt: deadline, RowVersion: 1, CreatedAt: now, UpdatedAt: now}
	if e := st.InsertInteraction(q); e != nil {
		return 0, e
	}
	view, e := s.interactionView(st, q)
	if e != nil {
		return 0, e
	}
	seq, e := appendEvent(st, x.Session, &x.Run.ID, "interaction/asked", "", map[string]any{"interaction": view, "child_source_run_id": nil}, nil, now)
	if e != nil {
		return 0, e
	}
	q.RequestEventSeq = seq
	q.ProjectionSeq = seq
	if e = st.SaveInteraction(q); e != nil {
		return 0, e
	}
	row.InteractionID = &q.ID
	row.Status = "waiting_approval"
	if kind == "question" {
		row.Status = "running"
	}
	row.UpdatedAt = now
	if e = st.SaveToolCall(row); e != nil {
		return 0, e
	}
	if e = st.SaveSession(x.Session); e != nil {
		return 0, e
	}
	return agentcore.ID(q.ID), nil
}

func (s *Service) CompleteTool(ctx context.Context, ref agentcore.ExecutionRef, result agentcore.ToolResult) (agentcore.ToolCommit, error) {
	var out agentcore.ToolCommit
	outputFile, storageErr := s.stageToolOutput(ctx, ref, result)
	if storageErr != nil {
		outputFile = nil
	}
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, ref, false)
		if e != nil {
			return e
		}
		row, e := st.ToolCall(uint64(result.Call.ID), true)
		if e != nil {
			return e
		}
		if row == nil || row.RunID != x.Run.ID || row.ExecutorEpoch != ref.Epoch || row.FenceVersion != ref.Fence {
			return httpx.E(409, "EXECUTION_FENCED", "工具结果所属执行已失效")
		}
		if row.ResultEventSeq != nil {
			out, e = loadToolCommit(st, row)
			return e
		}
		if row.DispatchToken == nil {
			return integrity()
		}
		obs := result.Observation
		switch obs.Status {
		case "succeeded", "failed", "blocked", "cancelled", "outcome_unknown":
		default:
			return httpx.Invalid("status", "invalid_value")
		}
		if obs.Status == "outcome_unknown" {
			obs.Executed = nil
		}
		if obs.Executed == nil && obs.Status != "outcome_unknown" {
			return integrity()
		}
		if len(obs.ExecutionReference) > 32<<10 || len(obs.ExecutionReference) > 0 && !json.Valid(obs.ExecutionReference) {
			return integrity()
		}
		row.ExecutionRef = obs.ExecutionReference
		truncated := obs.Truncated
		content := obs.Content
		limit := result.Call.Spec.ResultLimit
		if limit <= 0 || limit > toolOutputInlineLimit(row.ToolKey) {
			limit = toolOutputInlineLimit(row.ToolKey)
		}
		inlineLimit := min(limit, toolOutputInlineLimit(row.ToolKey))
		extra := map[string]any{"truncated": truncated}
		if detail := diagnostic.Copy(obs.Diagnostic); detail != nil {
			extra["diagnostic"] = detail
		}
		if obs.Truncated {
			extra["source_truncated"] = true
		}
		if outputFile != nil {
			output, err := bindToolOutput(st, outputFile, row, x.RootSession.ID, time.Now().UTC().Truncate(time.Millisecond))
			if err != nil {
				return err
			}
			extra["output_file"] = output
			notice := fmt.Sprintf("\n\n[Full captured output retained: %d bytes, file_id=%q.]", output.Size, idString(outputFile.ID))
			if slices.ContainsFunc(x.Context.Tools, func(tool FrozenTool) bool { return tool.Spec.Key == "read_tool_output" }) {
				notice += " Use read_tool_output to page or search the retained output."
			}
			content = agentcore.HeadTail(content, inlineLimit-len(notice), "\n\n[... middle omitted ...]\n\n") + notice
			extra["truncated"] = true
		} else if len(content) > inlineLimit {
			notice := "\n\n[Platform notice: output retention unavailable; omitted text cannot be recovered from this result. Request a smaller range from the source.]"
			content = agentcore.HeadTail(content, inlineLimit-len(notice), "\n\n[... middle omitted ...]\n\n") + notice
			extra["truncated"] = true
		}
		from := x.Session.LastSeq + 1
		if row.ToolKey == "todo_write" && obs.Status == "succeeded" && row.MCPBindingID == nil {
			list, _, err := ParseTodos(obs.Metadata)
			if err != nil {
				return integrity()
			}
			event := struct {
				TodoList
				ToolCallID agentcore.ID `json:"tool_call_id"`
			}{list, agentcore.ID(row.ID)}
			if _, err = appendEvent(st, x.Session, &row.RunID, "todo/write", "", event, nil, time.Now().UTC()); err != nil {
				return err
			}
		} else if len(obs.Metadata) > 0 {
			if e = validateToolMetadata(tx, x, row, obs.Metadata, extra); e != nil {
				return e
			}
		}
		if e = settleToolBudget(st, x.Run, row, obs.Executed); e != nil {
			return e
		}
		out, e = settleToolEvent(st, x.Session, row, obs.Status, obs.Executed, content, obs.Reason, extra, time.Now().UTC().Truncate(time.Millisecond))
		if e != nil {
			return e
		}
		out.Receipt.Ranges[0].From = agentcore.Seq(from)
		out.Receipt.Ranges[0].Through = agentcore.Seq(x.Session.LastSeq)
		out.Result.Receipt = out.Receipt
		return st.SaveSession(x.Session)
	})
	return out, e
}
func (s *Service) LookupCompletion(ctx context.Context, id agentcore.ID) (agentcore.ToolCommit, error) {
	var out agentcore.ToolCommit
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		row, e := st.ToolCall(uint64(id), false)
		if e != nil {
			return e
		}
		if row == nil {
			return missing()
		}
		out, e = loadToolCommit(st, row)
		return e
	})
	return out, e
}
func (s *Service) RecordReconciliation(ctx context.Context, evidence agentcore.ReconciliationEvidence) (agentcore.CommitReceipt, error) {
	var out agentcore.CommitReceipt
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		v, e := st.Session(uint64(evidence.Ref.SessionID), true)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		row, e := st.ToolCall(uint64(evidence.CallID), true)
		if e != nil {
			return e
		}
		if row == nil || row.SessionID != v.ID || row.RunID != uint64(evidence.Ref.RunID) || row.ExecutorEpoch != evidence.Ref.Epoch || row.FenceVersion != evidence.Ref.Fence {
			return httpx.E(409, "EXECUTION_FENCED", "对账证据不属于原执行")
		}
		if row.ResultEventSeq == nil || row.Status != "outcome_unknown" {
			return httpx.E(409, "TOOL_NOT_UNKNOWN", "工具不是待核实状态")
		}
		if evidence.ObservedStatus != "succeeded" && evidence.ObservedStatus != "failed" && evidence.ObservedStatus != "cancelled" {
			return httpx.Invalid("observed_status", "invalid_value")
		}
		// Verified runtime disappearance can prove physical cancellation while
		// leaving whether the original command started unknown.
		if evidence.Executed == nil && evidence.ObservedStatus != "cancelled" {
			return httpx.Invalid("executed", "required")
		}
		if row.ReconciledOutcome != nil {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		seq, e := appendEvent(st, v, &row.RunID, "tool/reconciled", "tool-reconciled:"+strconv.FormatUint(row.ID, 10), map[string]any{"tool_call_id": agentcore.ID(row.ID), "observed_status": evidence.ObservedStatus, "executed": evidence.Executed, "reason": evidence.Reason, "observed_at": evidence.ObservedAt, "evidence_summary": "verified_adapter_observation"}, nil, now)
		if e != nil {
			return e
		}
		row.ReconciledOutcome = &evidence.ObservedStatus
		row.LastReconciledSeq = &seq
		row.UpdatedAt = now
		if e = st.SaveToolCall(row); e != nil {
			return e
		}
		if e = st.SaveSession(v); e != nil {
			return e
		}
		out = eventReceipt(v.ID, seq, seq)
		return nil
	})
	return out, e
}
