package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func validateObservation(q *ObservationQuery, kind string) error {
	base := Query{Page: q.Page, PageSize: q.PageSize}
	if e := validateQuery(&base); e != nil {
		return e
	}
	q.Page, q.PageSize = base.Page, base.PageSize
	allowed := ""
	switch kind {
	case "run":
		allowed = "preparing running stopping succeeded waiting_input failed cancelled interrupted"
	case "tool":
		allowed = "prepared waiting_approval dispatching running succeeded failed blocked cancelled outcome_unknown"
	case "interaction":
		allowed = "waiting continued reply_queued answered cancelled pending approved_once rejected expired unavailable"
	}
	if q.Status != "" && !strings.Contains(" "+allowed+" ", " "+q.Status+" ") {
		return httpx.Invalid("status", "unsupported")
	}
	if q.Kind != "" && q.Kind != "question" && q.Kind != "approval" {
		return httpx.Invalid("kind", "unsupported")
	}
	return nil
}
func (s *Service) CheckObservation(ctx context.Context, raw string, id uint64) error {
	_, e := s.observationAccess(ObservingContext(ctx), raw, func(tx identity.Tx, _ Repository, a *identity.Auth, _ *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		_, e = s.sessionAccess(st, id, a, false, false)
		return e
	})
	return e
}
func actorProjection(kind, id string) (agentcore.ActorRef, error) {
	out := agentcore.ActorRef{Kind: kind}
	if kind == "system" {
		return out, nil
	}
	if kind != "user" {
		return out, integrity()
	}
	n, e := strconv.ParseUint(id, 10, 64)
	if e != nil || n == 0 {
		return out, integrity()
	}
	out.ID = coreID(&n)
	return out, nil
}

func (s *Service) interactionView(st StateRepository, row *InteractionRow) (InteractionView, error) {
	v := InteractionView{ID: row.ID, SessionID: row.SessionID, RunID: row.RunID, ToolCallID: row.ToolCallID, Kind: row.Kind, Version: strings.Trim(s.tag("interaction", row.ID, row.RowVersion), `"`), CreatedAt: row.CreatedAt, ExpiresAt: row.WaitDeadlineAt, UpdatedAt: row.UpdatedAt, Status: row.Status, PendingReply: row.PendingReplyInputID}
	var specification struct {
		Questions []agentcore.Question `json:"questions"`
		Action    *ApprovalAction      `json:"action"`
	}
	if json.Unmarshal(row.Specification, &specification) != nil {
		return v, integrity()
	}
	switch row.Kind {
	case "question":
		v.Questions = specification.Questions
		if agentcore.ValidateQuestions(v.Questions) != nil {
			return v, integrity()
		}
	case "approval":
		v.Action = specification.Action
		if v.Action == nil || v.Action.ToolKey == "" || !json.Valid(v.Action.Arguments) {
			return v, integrity()
		}
	default:
		return v, integrity()
	}
	if row.DecidedByKind != nil && row.DecidedByID != nil {
		actor, e := actorProjection(*row.DecidedByKind, *row.DecidedByID)
		if e != nil {
			return v, e
		}
		v.AnsweredBy = &actor
	}
	if row.AnswerEventSeq != nil {
		event, e := st.EventAt(row.SessionID, *row.AnswerEventSeq)
		if e != nil {
			return v, e
		}
		if event == nil {
			return v, integrity()
		}
		facts, e := decodeEvent(*event)
		if e != nil {
			return v, e
		}
		var payload struct {
			Answer   *agentcore.QuestionAnswer `json:"answer"`
			Decision *string                   `json:"decision"`
		}
		if json.Unmarshal(facts.Public, &payload) != nil {
			return v, integrity()
		}
		v.Answer = payload.Answer
		v.Decision = payload.Decision
	}
	return v, nil
}
func (s *Service) GetInteraction(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := st.Interaction(id, false)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, v.SessionID, a, false, false); e != nil {
			return e
		}
		out.Data, e = s.interactionView(st, v)
		out.Tag = s.tag("interaction", v.ID, v.RowVersion)
		return e
	})
}
func (s *Service) ListInteractions(ctx context.Context, raw string, id uint64, q ObservationQuery) (*Result, error) {
	if e := validateObservation(&q, "interaction"); e != nil {
		return nil, e
	}
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, false, false); e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.InteractionPage(id, q)
		if e != nil {
			return e
		}
		items := make([]InteractionView, 0, len(rows))
		for i := range rows {
			v, e := s.interactionView(st, &rows[i])
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
func runSummary(v RunRow, c RunCounts) RunSummary {
	root := v.ID
	if v.RootRunID != nil {
		root = *v.RootRunID
	}
	return RunSummary{ID: v.ID, SessionID: v.SessionID, RootRunID: root, ParentRunID: v.ParentRunID, TriggerInputID: v.TriggerInputID, Status: v.Status, Reason: v.EndReason, StartedAt: v.StartedAt, FinishedAt: v.FinishedAt, SettledAt: v.SettledAt, Deadline: v.DeadlineAt, Steps: v.CurrentStepNo, ModelCalls: c.ModelCalls, ToolCalls: c.ToolCalls, UsageCompleteness: v.UsageCompleteness}
}
func (s *Service) GetRun(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := st.Run(id, false)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, v.SessionID, a, false, false); e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		counts, e := repo.RunCounts(id)
		if e != nil {
			return e
		}
		actor, e := actorProjection(v.ActorKind, v.ActorID)
		if e != nil {
			return e
		}
		d := RunDetail{RunSummary: runSummary(*v, counts), Origin: v.OriginKind, Actor: actor, Principal: agentcore.PrincipalRef{Kind: "user", ID: agentcore.ID(v.ExecutorUserID)}, LastSeq: v.ProjectionSeq, EndSeq: v.EndedSeq, Budget: v.BudgetUsed, Physical: PhysicalActivity{State: "none", Unknown: counts.UnknownTools, Transfers: counts.PendingTransfers}}
		if v.SourceKind != nil && v.SourceID != nil {
			n, err := strconv.ParseUint(*v.SourceID, 10, 64)
			if err != nil || n == 0 {
				return integrity()
			}
			d.Source = &agentcore.SourceRef{Kind: *v.SourceKind, ID: agentcore.ID(n)}
		}
		if v.SettledAt != nil {
			d.Physical.State = "settled"
		} else if counts.UnknownTools+counts.PendingTransfers > 0 {
			d.Physical.State = "reconciling"
		} else if v.FinishedAt != nil {
			d.Physical.State = "settling"
		} else if counts.ActiveTools > 0 {
			d.Physical.State = "active"
		}
		if s.Sandboxes != nil {
			cloud, err := CloudStateFor(tx)
			if err != nil {
				return err
			}
			lease, err := cloud.Lease(d.RootRunID, false)
			if err != nil {
				return err
			}
			if lease != nil {
				frozen, err := st.RunContext(d.RootRunID)
				if err != nil {
					return err
				}
				if frozen == nil {
					return integrity()
				}
				d.Binding = map[string]any{"id": agentcore.ID(lease.RootRunID), "cloud_computer_id": agentcore.ID(lease.ComputerID), "runtime_generation": coreID(lease.RuntimeGeneration), "storage_generation": agentcore.ID(lease.StorageGeneration), "mode": lease.Mode, "state": lease.State, "cwd": frozen.CWD}
			}
		}
		out.Data = d
		return nil
	})
}
func (s *Service) ListRuns(ctx context.Context, raw string, id uint64, q ObservationQuery) (*Result, error) {
	if e := validateObservation(&q, "run"); e != nil {
		return nil, e
	}
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, false, false); e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.RunPage(id, false, q)
		if e != nil {
			return e
		}
		items := make([]RunSummary, 0, len(rows))
		for _, v := range rows {
			counts, e := repo.RunCounts(v.ID)
			if e != nil {
				return e
			}
			items = append(items, runSummary(v, counts))
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) ListChildren(ctx context.Context, raw string, id uint64, q ObservationQuery) (*Result, error) {
	if e := validateObservation(&q, "run"); e != nil {
		return nil, e
	}
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		run, e := st.Run(id, false)
		if e != nil {
			return e
		}
		if run == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, run.SessionID, a, false, false); e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.RunPage(id, true, q)
		if e != nil {
			return e
		}
		items := make([]ChildRunSummary, 0, len(rows))
		summaries, e := childResultSummaries(st, run.ID)
		if e != nil {
			return e
		}
		for _, v := range rows {
			root := v.ID
			if v.RootRunID != nil {
				root = *v.RootRunID
			}
			items = append(items, ChildRunSummary{ID: v.ID, SessionID: v.SessionID, RootRunID: root, ParentRunID: v.ParentRunID, Status: v.Status, Reason: v.EndReason, StartedAt: v.StartedAt, FinishedAt: v.FinishedAt, Summary: summaries[v.ID]})
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}

// A child's visible summary is the parent's atomically committed tool result,
// not a fresh interpretation of the child's private/native model history.
func childResultSummaries(st StateRepository, runID uint64) (map[uint64]*string, error) {
	rows, e := st.RunTools(runID)
	if e != nil {
		return nil, e
	}
	out := map[uint64]*string{}
	for _, row := range rows {
		if row.ExecutionClass != "child" || row.ResultEventSeq == nil {
			continue
		}
		event, e := st.EventAt(row.SessionID, *row.ResultEventSeq)
		if e != nil {
			return nil, e
		}
		if event == nil {
			return nil, integrity()
		}
		record, e := projectEvent(*event)
		if e != nil {
			return nil, e
		}
		var body struct {
			Child *struct {
				RunID   agentcore.ID `json:"run_id"`
				Summary *string      `json:"result_summary"`
			} `json:"child_result"`
		}
		raw, e := json.Marshal(record.Data)
		if e != nil {
			return nil, e
		}
		if e = json.Unmarshal(raw, &body); e != nil {
			return nil, integrity()
		}
		if body.Child != nil {
			out[uint64(body.Child.RunID)] = body.Child.Summary
		}
	}
	return out, nil
}
func (s *Service) ListToolCalls(ctx context.Context, raw string, id uint64, q ObservationQuery) (*Result, error) {
	if e := validateObservation(&q, "tool"); e != nil {
		return nil, e
	}
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		run, e := st.Run(id, false)
		if e != nil {
			return e
		}
		if run == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, run.SessionID, a, false, false); e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.ToolPage(id, q)
		if e != nil {
			return e
		}
		items := make([]map[string]any, 0, len(rows))
		for _, v := range rows {
			event, e := st.EventAt(v.SessionID, v.ArgumentsEventSeq)
			if e != nil {
				return e
			}
			if event == nil {
				return integrity()
			}
			facts, e := decodeEvent(*event)
			if e != nil {
				return e
			}
			var call struct {
				Arguments json.RawMessage `json:"arguments"`
				Policy    string          `json:"policy"`
			}
			if json.Unmarshal(facts.Public, &call) != nil || len(call.Arguments) == 0 {
				return integrity()
			}
			certainty := "pending"
			if v.Status == "outcome_unknown" {
				certainty = "unknown"
			} else if v.ResultEventSeq != nil {
				certainty = "known"
			}
			var reconciliation any
			if v.LastReconciledSeq != nil {
				event, e := st.EventAt(v.SessionID, *v.LastReconciledSeq)
				if e != nil {
					return e
				}
				if event == nil {
					return integrity()
				}
				facts, e := decodeEvent(*event)
				if e != nil {
					return e
				}
				var data struct {
					Status     string `json:"observed_status"`
					ObservedAt any    `json:"observed_at"`
				}
				if json.Unmarshal(facts.Public, &data) != nil {
					return integrity()
				}
				reconciliation = map[string]any{"status": data.Status, "observed_at": data.ObservedAt, "event_seq": agentcore.Seq(*v.LastReconciledSeq)}
			}
			items = append(items, map[string]any{"id": agentcore.ID(v.ID), "run_id": agentcore.ID(v.RunID), "step": v.StepNo, "index": v.CallOrdinal, "tool_key": v.ToolKey, "mcp_server_id": coreID(v.MCPServerID), "mcp_binding_id": coreID(v.MCPBindingID), "mcp_tool_name": v.MCPToolName, "arguments": call.Arguments, "arguments_hash": hex.EncodeToString(v.ArgumentsHash), "execution_class": v.ExecutionClass, "policy": call.Policy, "status": v.Status, "interaction_id": coreID(v.InteractionID), "prepared_at": v.CreatedAt, "dispatched_at": v.DispatchStartedAt, "finished_at": v.FinishedAt, "result_event_seq": seqPointer(v.ResultEventSeq), "executed": v.Executed, "outcome": map[string]any{"certainty": certainty, "reason": v.ErrorCode}, "reconciliation": reconciliation})
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}

func (s *Service) Snapshot(ctx context.Context, raw string, id uint64, limit int) (*Result, error) {
	return s.observationAccess(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		initial, e := s.sessionAccess(st, id, a, false, false)
		if e != nil {
			return e
		}
		// Match the writer's provider/model before Session lock order. detail's
		// repeated projection only reacquires the locks already held here.
		if _, _, e = s.selection(tx, r, initial); e != nil {
			return e
		}
		v, e := s.sessionAccess(st, id, a, false, true)
		if e != nil {
			return e
		}
		if v.RowVersion != initial.RowVersion {
			return httpx.E(409, "SNAPSHOT_CHANGED", "会话配置已变化，请重试快照")
		}
		detail, e := s.detail(ctx, tx, r, st, v, a)
		if e != nil {
			return e
		}
		repo, e := observationsFor(tx)
		if e != nil {
			return e
		}
		history, e := historyPage(st, repo, v, HistoryQuery{Limit: limit})
		if e != nil {
			return e
		}
		state := SnapshotState{Configuration: detail.Configuration, Selection: detail.Selection, Permissions: detail.Permissions, View: detail.ViewState, RunID: v.ActiveRunID, RunStatus: detail.State.ActiveRunStatus, QueuePaused: v.QueuePaused, Inputs: []InputSummary{}, Interactions: []InteractionView{}}
		state.Conversation, e = loadConversationProjection(st, id, v.LastSeq)
		if e != nil {
			return e
		}
		inputs, total, e := st.Inputs(id, InputQuery{Page: 1, PageSize: 50, State: "pending"})
		if e != nil {
			return e
		}
		state.InputTotal = total
		state.InputsTruncated = total > len(inputs)
		for i := range inputs {
			input, e := s.inputView(st, &inputs[i])
			if e != nil {
				return e
			}
			text := ""
			for _, block := range input.Content {
				text += block.Text
			}
			runes := []rune(text)
			if len(runes) > 256 {
				text = string(runes[:256])
			}
			state.Inputs = append(state.Inputs, InputSummary{ID: input.ID, Kind: input.Kind, Delivery: input.Delivery, Preview: text, Actor: input.Actor, Deadline: input.QueueDeadline, Version: input.Version})
		}
		interactions, total, e := repo.InteractionPage(id, ObservationQuery{Page: 1, PageSize: 20, Status: "unresolved"})
		if e != nil {
			return e
		}
		state.InteractionTotal = total
		state.InteractionsTruncated = total > len(interactions)
		for i := range interactions {
			view, e := s.interactionView(st, &interactions[i])
			if e != nil {
				return e
			}
			state.Interactions = append(state.Interactions, view)
		}
		for {
			encoded, e := json.Marshal(state)
			if e != nil {
				return e
			}
			if len(encoded) <= 512<<10 {
				break
			}
			if len(state.Interactions) > 0 {
				state.Interactions = state.Interactions[:len(state.Interactions)-1]
				state.InteractionsTruncated = true
			} else if len(state.Inputs) > 0 {
				state.Inputs = state.Inputs[:len(state.Inputs)-1]
				state.InputsTruncated = true
			} else {
				return fmt.Errorf("snapshot fixed state exceeds limit")
			}
		}
		out.Data = ObservationSnapshot{SessionID: id, Through: v.LastSeq, State: state, Records: history.Records, Before: history.Before, HasMore: history.HasMore}
		return nil
	})
}
