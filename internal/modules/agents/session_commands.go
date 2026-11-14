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

func (s *Service) PatchSessionConfiguration(ctx context.Context, raw string, id uint64, tag string, w SessionPatch) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if !w.Title.Set && !w.ProjectID.Set && !w.Selection.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		if w.Title.Null || w.Selection.Null {
			return httpx.Invalid("body", "null_not_allowed")
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		current, e := s.sessionAccess(st, id, a, true, false)
		if e != nil {
			return e
		}
		var selection ModelSelection
		if w.Selection.Set {
			selection = w.Selection.Value
			candidate := *current
			candidate.SelectedModelBindingID, e = idValue(selection.BindingID, "model_selection.model_binding_id")
			if e != nil {
				return e
			}
			candidate.SelectedThinkingOptionKey = selection.Thinking
			if current.ModelLockedAt != nil {
				return httpx.E(409, "MODEL_SELECTION_LOCKED", "会话模型已经锁定")
			}
			_, resolved, e := s.selection(tx, r, &candidate)
			if e != nil {
				return e
			}
			if !resolved.Availability.Available {
				return httpx.E(409, "MODEL_UNAVAILABLE", "模型当前不可用")
			}
		}
		var project *uint64
		if w.ProjectID.Set && !w.ProjectID.Null {
			n, e := idValue(w.ProjectID.Value, "project_context_id")
			if e != nil {
				return e
			}
			agent, e := r.Definition(current.AgentID, true)
			if e != nil {
				return e
			}
			if e = s.definition(agent); e != nil {
				return e
			}
			executor, e := runtimeOwner(tx, current)
			if e != nil {
				return e
			}
			access, e := checkSessionProjects(r, agent, executor, &n)
			if e != nil {
				return e
			}
			if !access.AgentAvailable || !access.ContextAvailable {
				return httpx.E(403, "FORBIDDEN", "无法访问此项目")
			}
			project = &n
		}
		v, e := s.sessionAccess(st, id, a, true, true)
		if e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("session", id, v.RowVersion)); e != nil {
			return e
		}
		if v.ArchivedAt != nil && (w.Selection.Set || w.ProjectID.Set) {
			return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
		}
		if w.Selection.Set && v.ModelLockedAt != nil {
			return httpx.E(409, "MODEL_SELECTION_LOCKED", "会话模型已经锁定")
		}
		if w.ProjectID.Set {
			counts, e := st.SessionCounts(id)
			if e != nil {
				return e
			}
			if v.ActiveRunID != nil || v.ActiveCompactionID != nil || counts.Inputs > 0 {
				return httpx.E(409, "SESSION_NOT_IDLE", "项目上下文只能在会话空闲时修改")
			}
		}
		fields := []string{}
		if w.Title.Set {
			title := strings.TrimSpace(w.Title.Value)
			if title == "" || utf8.RuneCountInString(title) > 200 {
				return httpx.Invalid("title", "invalid_length")
			}
			if e = s.pinSessionTitle(st, v, "user", time.Now().UTC().Truncate(time.Millisecond)); e != nil {
				return e
			}
			if v.Title != title {
				v.Title = title
				fields = append(fields, "title")
			}
		}
		if w.ProjectID.Set && !same(v.ProjectContextID, project) {
			v.ProjectContextID = project
			fields = append(fields, "project_context_id")
		}
		if w.Selection.Set {
			binding, e := idValue(selection.BindingID, "model_selection.model_binding_id")
			if e != nil {
				return e
			}
			if binding != v.SelectedModelBindingID || selection.Thinking != v.SelectedThinkingOptionKey {
				v.SelectedModelBindingID = binding
				v.SelectedThinkingOptionKey = selection.Thinking
				fields = append(fields, "model_selection")
			}
		}
		if len(fields) > 0 {
			now := time.Now().UTC().Truncate(time.Millisecond)
			from := v.LastSeq + 1
			v.RowVersion++
			v.UpdatedAt = now
			uid := agentcore.ID(a.User.ID)
			if _, e = appendEvent(st, v, nil, "session/configured", "", map[string]any{"configuration": s.configuration(v), "changed_fields": fields, "actor_ref": agentcore.ActorRef{Kind: "user", ID: &uid}}, nil, now); e != nil {
				return e
			}
			if e = st.SaveSession(v); e != nil {
				return e
			}
			out.Commits = append(out.Commits, eventReceipt(id, from, v.LastSeq))
		}
		out.Data = s.configuration(v)
		out.Tag = s.tag("session", id, v.RowVersion)
		return nil
	})
}
func (s *Service) ArchiveSession(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.archive(ctx, raw, id, tag, key, false)
}
func (s *Service) RestoreSession(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.archive(ctx, raw, id, tag, key, true)
}
func (s *Service) archive(ctx context.Context, raw string, id uint64, tag, key string, restore bool) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, true, false); e != nil {
			return e
		}
		command := "session.archive"
		if restore {
			command = "session.restore"
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, command, "session:"+strconv.FormatUint(id, 10), struct{}{}, func(rec *Receipt) error {
			v, e := s.sessionAccess(st, id, a, true, true)
			if e != nil {
				return e
			}
			if e = checkTag(tag, s.tag("session", id, v.RowVersion)); e != nil {
				return e
			}
			state, e := coreSession(v)
			if e != nil {
				return e
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			from := v.LastSeq + 1
			uid := agentcore.ID(a.User.ID)
			author := agentcore.ActorRef{Kind: "user", ID: &uid}
			changed := false
			if restore {
				plan, e := agentcore.PlanRestore(state, state.Version)
				if e != nil {
					return coreError(e)
				}
				changed = plan.Version != state.Version
				if changed {
					v.ArchivedAt = nil
					v.ArchivedByUserID = nil
					v.QueuePaused = false
					v.RowVersion = uint64(plan.Version)
				}
			} else {
				pending := []InputRow{}
				for page := 1; ; page++ {
					rows, total, e := st.Inputs(id, InputQuery{Page: page, PageSize: 100, State: "pending"})
					if e != nil {
						return e
					}
					pending = append(pending, rows...)
					if len(pending) >= total {
						break
					}
				}
				interactions, e := st.SessionInteractions(id)
				if e != nil {
					return e
				}
				coreInputs := []agentcore.Input{}
				for _, row := range pending {
					coreInputs = append(coreInputs, agentcore.Input{ID: agentcore.ID(row.ID), SessionID: agentcore.ID(id), State: row.Status, Version: agentcore.Version(row.RowVersion)})
				}
				coreInteractions := []agentcore.Interaction{}
				for _, row := range interactions {
					coreInteractions = append(coreInteractions, agentcore.Interaction{ID: agentcore.ID(row.ID), SessionID: agentcore.ID(id), Kind: row.Kind, Status: row.Status, Version: agentcore.Version(row.RowVersion)})
				}
				plan, e := agentcore.PlanArchive(state, state.Version, coreInputs, coreInteractions, now)
				if e != nil {
					return coreError(e)
				}
				changed = plan.Session.Version != state.Version
				if changed {
					v.ArchivedAt = &now
					v.ArchivedByUserID = &a.User.ID
					v.QueuePaused = true
					v.RowVersion = uint64(plan.Session.Version)
					for i := range pending {
						row := &pending[i]
						row.Status = "cancelled"
						row.RowVersion++
						row.UpdatedAt = now
						row.EndedAt = &now
						reason := "session_archived"
						row.EndReason = &reason
						if e = st.SaveInput(row); e != nil {
							return e
						}
						if _, e = appendEvent(st, v, nil, "input/cancelled", "", map[string]any{"input_id": agentcore.ID(row.ID), "revision": agentcore.Version(row.ContentRevision), "reason": reason, "actor_ref": author}, nil, now); e != nil {
							return e
						}
					}
					for i := range interactions {
						row := &interactions[i]
						if row.Kind != "question" || row.Status != "waiting" && row.Status != "continued" && row.Status != "reply_queued" {
							continue
						}
						row.Status = "cancelled"
						row.PendingReplyInputID = nil
						row.RowVersion++
						row.UpdatedAt = now
						if e = st.SaveInteraction(row); e != nil {
							return e
						}
						if _, e = appendEvent(st, v, &row.RunID, "interaction/decided", "", map[string]any{"interaction_id": agentcore.ID(row.ID), "kind": row.Kind, "status": row.Status, "actor_ref": author, "answer": nil, "decision": nil, "pending_reply_input_id": nil, "reason": "session_archived"}, nil, now); e != nil {
							return e
						}
					}
				}
			}
			if changed {
				v.UpdatedAt = now
				reason := "session_archived"
				if restore {
					reason = "session_restored"
				}
				if _, e = appendEvent(st, v, nil, "queue/state", "", map[string]any{"queue_paused": v.QueuePaused, "reason": reason, "actor_ref": author}, nil, now); e != nil {
					return e
				}
				if _, e = appendEvent(st, v, nil, "session/configured", "", map[string]any{"configuration": s.configuration(v), "changed_fields": []string{"archived_at"}, "actor_ref": author}, nil, now); e != nil {
					return e
				}
				if e = st.SaveSession(v); e != nil {
					return e
				}
				out.Commits = append(out.Commits, eventReceipt(id, from, v.LastSeq))
			}
			out.Data = s.configuration(v)
			out.Tag = s.tag("session", id, v.RowVersion)
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
func (s *Service) ResumeQueue(ctx context.Context, raw string, id uint64, key string) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "queue.resume", "session:"+strconv.FormatUint(id, 10), struct{}{}, func(rec *Receipt) error {
			v, _, _, _, e := s.executionTarget(ctx, tx, r, st, id, a)
			if e != nil {
				return e
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			uid := agentcore.ID(a.User.ID)
			seq := v.LastSeq
			if v.QueuePaused {
				from := v.LastSeq + 1
				v.QueuePaused = false
				seq, e = appendEvent(st, v, nil, "queue/state", "", map[string]any{"queue_paused": false, "reason": "user_resumed", "actor_ref": agentcore.ActorRef{Kind: "user", ID: &uid}}, nil, now)
				if e != nil {
					return e
				}
				if e = st.SaveSession(v); e != nil {
					return e
				}
				out.Commits = append(out.Commits, eventReceipt(id, from, v.LastSeq))
			}
			out.Status = 202
			out.Data = map[string]any{"queue_paused": false, "accepted_seq": agentcore.Seq(seq)}
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
