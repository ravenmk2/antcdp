package agents

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type PendingCandidate struct {
	SessionID uint64 `db:"session_id"`
	InputID   uint64 `db:"input_id"`
}

func (s *Service) background(ctx context.Context, fn func(identity.Tx, Repository, StateRepository) error) error {
	if s.Store == nil {
		return unavailable()
	}
	store, e := s.Store()
	if e != nil {
		return e
	}
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, e := RepositoryFor(tx)
		if e != nil {
			return e
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		return fn(tx, r, st)
	})
}
func runtimeOwner(tx identity.Tx, v *SessionRow) (*identity.User, error) {
	return executionAccount(tx, v, true)
}

func executionAccount(tx identity.Tx, v *SessionRow, active bool) (*identity.User, error) {
	if v.ExecutorUserID == 0 || v.ExecutionMode != "interactive" && v.ExecutionMode != "service" {
		return nil, integrity()
	}
	users, err := tx.LockUsers([]uint64{v.ExecutorUserID})
	if err != nil {
		return nil, err
	}
	user := users[v.ExecutorUserID]
	if user == nil {
		return nil, integrity()
	}
	if (user.AccountType == "robot") != (v.ExecutionMode == "service") {
		return nil, integrity()
	}
	if active && (user.Status != "active" || user.DeletedAt != nil) {
		return nil, httpx.E(409, "PRINCIPAL_UNAVAILABLE", "执行账号当前不可用")
	}
	return user, nil
}
func coreInput(view InputView, row *InputRow) (agentcore.Input, error) {
	v := agentcore.Input{ID: agentcore.ID(row.ID), SessionID: agentcore.ID(row.SessionID), Kind: row.InputKind, Origin: row.OriginKind, Actor: view.Actor, Source: view.Source, ModifiedBy: view.ModifiedBy, Content: view.Content, Files: view.Files, Answer: view.Answer, Delivery: "next_turn", State: row.Status, Position: row.QueueOrder, AcceptedSeq: agentcore.Seq(row.AcceptedSeq), Revision: agentcore.Version(row.ContentRevision), Version: agentcore.Version(row.RowVersion), QueueDeadline: row.QueueDeadlineAt}
	if row.ClaimedRunID != nil {
		id := agentcore.ID(*row.ClaimedRunID)
		v.ClaimedRunID = &id
	}
	if row.MessageSeq != nil {
		seq := agentcore.Seq(*row.MessageSeq)
		v.MessageSeq = &seq
	}
	return v, nil
}
func (s *Service) Candidates(ctx context.Context, cursor agentcore.ScanCursor, limit int) (agentcore.CandidatePage, error) {
	var out agentcore.CandidatePage
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		out = agentcore.CandidatePage{Items: []agentcore.Candidate{}}
		if limit < 1 || limit > 100 {
			return httpx.Invalid("limit", "invalid_range")
		}
		rows, e := st.PendingCandidates(uint64(cursor.After), limit+1)
		if e != nil {
			return e
		}
		if len(rows) > limit {
			rows = rows[:limit]
			out.Next = &agentcore.ScanCursor{After: agentcore.ID(rows[len(rows)-1].SessionID)}
		}
		for _, v := range rows {
			out.Items = append(out.Items, agentcore.Candidate{SessionID: agentcore.ID(v.SessionID), InputID: agentcore.ID(v.InputID)})
		}
		return nil
	})
	return out, e
}
func (s *Service) ClaimRoot(ctx context.Context, request agentcore.ClaimRequest) (agentcore.ClaimResult, error) {
	var out agentcore.ClaimResult
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		out = agentcore.ClaimResult{}
		initial, e := st.Session(uint64(request.Candidate.SessionID), false)
		if e != nil {
			return e
		}
		if initial == nil {
			return nil
		}
		owner, e := executionAccount(tx, initial, false)
		if e != nil {
			return e
		}
		if owner.Status != "active" || owner.DeletedAt != nil {
			session, err := st.Session(initial.ID, true)
			if err != nil {
				return err
			}
			out.Receipt, err = cancelSessionQueue(st, session, "PRINCIPAL_UNAVAILABLE", time.Now().UTC())
			return err
		}
		model, selection, e := s.selection(tx, r, initial)
		if e != nil {
			return e
		}
		agent, e := r.Definition(initial.AgentID, true)
		if e != nil {
			return e
		}
		if e = s.definition(agent); e != nil {
			return e
		}
		if s.Sandboxes != nil {
			cr, e := CloudStateFor(tx)
			if e != nil {
				return e
			}
			if _, e = cr.Connection(true); e != nil {
				return e
			}
		}
		v, e := st.Session(initial.ID, true)
		if e != nil {
			return e
		}
		if v == nil {
			return nil
		}
		if v.RowVersion != initial.RowVersion || v.ArchivedAt != nil || v.QueuePaused || v.ActiveRunID != nil || v.ActiveCompactionID != nil {
			return nil
		}
		if !agent.Enabled || agent.DeletedAt != nil || !selection.Availability.Available {
			reason := "AGENT_UNAVAILABLE"
			if !selection.Availability.Available {
				reason = "MODEL_UNAVAILABLE"
			}
			out.Receipt, e = cancelSessionQueue(st, v, reason, time.Now().UTC())
			return e
		}
		input, e := st.Input(uint64(request.Candidate.InputID), true)
		if e != nil {
			return e
		}
		if input == nil || input.SessionID != v.ID || input.Status != "pending" {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if !now.Before(input.QueueDeadlineAt) {
			return nil
		}
		access, e := checkSessionProjects(r, agent, owner, v.ProjectContextID)
		if e != nil {
			return e
		}
		if !access.AgentAvailable || !access.ContextAvailable {
			reason := "PROJECT_CONTEXT_UNAVAILABLE"
			if !access.AgentAvailable {
				reason = "AGENT_ACCESS_REVOKED"
			}
			out.Receipt, e = cancelSessionQueue(st, v, reason, now)
			return e
		}
		snapshot := policySnapshot{corePolicy(agent)}
		snapshotJSON, e := json.Marshal(snapshot)
		if e != nil {
			return e
		}

		var computer *CloudComputerRow
		if s.Sandboxes != nil {
			var ready bool
			computer, ready, e = s.Sandboxes.prepareCloudAdmission(ctx, tx, r, st, agent, v)
			out.Receipt = eventReceipt(v.ID, initial.LastSeq+1, v.LastSeq)
			if e != nil {
				var public *httpx.Error
				if errors.As(e, &public) && public.Status < 500 {
					_, e = cancelSessionQueue(st, v, public.Code, now)
					out.Receipt = eventReceipt(v.ID, initial.LastSeq+1, v.LastSeq)
					return e
				}
				return e
			}
			if !ready {
				return nil
			}
		}

		view, e := s.inputView(st, input)
		if e != nil {
			return e
		}
		coreI, e := coreInput(view, input)
		if e != nil {
			return e
		}
		coreS, e := coreSession(v)
		if e != nil {
			return e
		}
		limits, e := json.Marshal(agentcore.LimitFromPolicy(snapshot.Policy))
		if e != nil {
			return e
		}
		zero, e := json.Marshal(agentcore.Budget{})
		if e != nil {
			return e
		}
		row := &RunRow{SessionID: v.ID, TriggerInputID: &input.ID, RetryOfRunID: input.RetryOfRunID, ExecutorUserID: v.ExecutorUserID, OriginKind: input.OriginKind, ActorKind: input.ActorKind, ActorID: input.ActorID, SourceKind: input.SourceKind, SourceID: input.SourceID, Status: "preparing", AgentConfigVersion: agent.RowVersion, ResourceConfigVersion: agent.RowVersion, ExecutionPolicySnapshot: snapshotJSON, ModelSelectionHash: v.ModelSelectionHash, BudgetLimit: limits, BudgetReserved: zero, BudgetUsed: zero, BudgetRevision: 1, ExecutorEpoch: request.Epoch, FenceVersion: 1, UsageCompleteness: "complete", CreatedAt: now, DeadlineAt: now.Add(time.Duration(snapshot.RunTimeoutSeconds) * time.Second), UpdatedAt: now, ContinuationSeq: input.ContinuationSeq}
		if request.Epoch == "" {
			return httpx.Invalid("epoch", "required")
		}
		if e = st.InsertRun(row); e != nil {
			return e
		}
		frozen, e := s.freezeRunContext(ctx, tx, r, st, row, agent, owner, model)
		if e != nil {
			return e
		}
		plan, e := agentcore.PlanClaim(coreS, coreI, agentcore.ID(row.ID), request.Epoch, snapshot.Policy, now)
		if e != nil {
			return coreError(e)
		}
		from := initial.LastSeq + 1
		v.ActiveRunID = &row.ID
		input.Status = "claimed"
		input.RowVersion = uint64(plan.Input.Version)
		input.ClaimedRunID = &row.ID
		step := uint64(1)
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
		seq, e := appendEvent(st, v, &row.ID, "input/message", "input-message:"+strconv.FormatUint(input.ID, 10), inputMessageData(view), &StoredEvent{Message: &message}, now)
		if e != nil {
			return e
		}
		input.MessageSeq = &seq
		if e = s.prepareSessionTitle(st, v, input, view, seq, now); e != nil {
			return e
		}
		if e = s.claimReply(st, v, input, now); e != nil {
			return e
		}
		if _, e = appendEvent(st, v, &row.ID, "input/claimed", "", map[string]any{"input_id": agentcore.ID(input.ID), "revision": agentcore.Version(input.ContentRevision), "run_id": agentcore.ID(row.ID), "delivery": "next_turn"}, nil, now); e != nil {
			return e
		}
		seq, e = appendEvent(st, v, &row.ID, "run/started", "", map[string]any{"run_id": agentcore.ID(row.ID), "trigger_input_id": agentcore.ID(input.ID), "root_run_id": agentcore.ID(row.ID), "parent_run_id": nil, "principal": coreS.Principal, "deadline_at": row.DeadlineAt, "execution_policy": snapshot}, nil, now)
		if e != nil {
			return e
		}
		row.StartedSeq = &seq
		row.StartedAt = &now
		if e = st.SaveRun(row); e != nil {
			return e
		}
		if e = st.SaveInput(input); e != nil {
			return e
		}
		if e = st.SaveSession(v); e != nil {
			return e
		}
		out.Claimed = true
		out.Execution = agentcore.ExecutionContext{Ref: plan.Run.Ref, AgentID: agentcore.ID(v.AgentID), Principal: coreS.Principal, ContentSessionID: agentcore.ID(v.ID), Policy: snapshot.Policy, Authorization: frozen.Authorization, Model: model, Deadline: row.DeadlineAt}
		if computer != nil {
			out.Execution.Binding, e = s.Sandboxes.createCloudLease(tx, computer, agent, row, frozen.Row.CWD)
			if e != nil {
				return e
			}
		}
		out.Receipt = eventReceipt(v.ID, from, v.LastSeq)
		return nil
	})
	if e == nil && !out.Claimed && len(out.Receipt.Ranges) > 0 && s.Committed != nil {
		s.Committed(ctx, out.Receipt)
	}
	return out, e
}
