package agents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type frozenModel struct {
	agentcore.LockedModel
	Display EffectiveSelection `json:"display"`
}

func contentAccess(v *SessionRow, a *identity.Auth) error {
	if v == nil {
		return missing()
	}
	if v.ExecutorUserID == 0 {
		return integrity()
	}
	if v.ExecutionMode == "interactive" {
		if v.ExecutorUserID != a.User.ID {
			return missing()
		}
		return nil
	}
	if v.ExecutionMode != "service" {
		return integrity()
	}
	if a.User.Role != "admin" {
		return httpx.E(403, "FORBIDDEN", "需要管理员权限")
	}
	return nil
}
func (s *Service) sessionAccess(st StateRepository, id uint64, a *identity.Auth, write, lock bool) (*SessionRow, error) {
	v, e := st.Session(id, false)
	if e != nil {
		return nil, e
	}
	if v == nil {
		return nil, missing()
	}
	if v.RootSessionID != nil {
		root, e := st.Session(*v.RootSessionID, false)
		if e != nil {
			return nil, e
		}
		if e = contentAccess(root, a); e != nil {
			return nil, e
		}
		if v.ExecutorUserID != root.ExecutorUserID || v.AgentID != root.AgentID {
			return nil, integrity()
		}
		if write {
			return nil, httpx.E(409, "CHILD_SESSION_READ_ONLY", "子任务会话只允许读取")
		}
	} else if e = contentAccess(v, a); e != nil {
		return nil, e
	}
	if lock {
		v, e = st.Session(id, true)
		if e != nil {
			return nil, e
		}
		if e = contentAccess(v, a); e != nil {
			return nil, e
		}
	}
	return v, nil
}
func (s *Service) configuration(v *SessionRow) SessionConfiguration {
	return SessionConfiguration{ID: v.ID, AgentID: v.AgentID, Mode: v.ExecutionMode, Title: v.Title, ProjectID: v.ProjectContextID, Selection: ModelSelection{strconv.FormatUint(v.SelectedModelBindingID, 10), v.SelectedThinkingOptionKey}, ModelLockedAt: v.ModelLockedAt, ArchivedAt: v.ArchivedAt, Version: strings.Trim(s.tag("session", v.ID, v.RowVersion), `"`), CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func (s *Service) selection(tx identity.Tx, r Repository, v *SessionRow) (agentcore.LockedModel, EffectiveSelection, error) {
	if s.Models == nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, unavailable()
	}
	rows, e := r.ModelBindings(v.AgentID, true)
	if e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	if e = decodeModels(rows); e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	var binding *ModelBinding
	for i := range rows {
		if rows[i].ID == v.SelectedModelBindingID {
			binding = &rows[i]
		}
	}
	if binding == nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, httpx.Invalid("model_selection.model_binding_id", "not_bound")
	}
	view, e := s.Models.ReadRuntimeModel(tx, binding.ModelID)
	if e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	// A binding can change while waiting for the model locks. Serialize with
	// configuration writes only after those parent locks, then read its current
	// grant again; the binding ID never changes its model definition identity.
	if _, e = r.Definition(v.AgentID, true); e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	current, e := r.ModelBindings(v.AgentID, true)
	if e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	if e = decodeModels(current); e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	var fresh *ModelBinding
	for i := range current {
		if current[i].ID == binding.ID {
			fresh = &current[i]
			break
		}
	}
	if fresh == nil || fresh.ModelID != binding.ModelID {
		return agentcore.LockedModel{}, EffectiveSelection{}, integrity()
	}
	binding = fresh
	if v.ModelLockedAt != nil {
		var frozen frozenModel
		if json.Unmarshal(v.LockedModelConfig, &frozen) != nil || frozen.SelectionHash == "" {
			return agentcore.LockedModel{}, EffectiveSelection{}, integrity()
		}
		current := view.Available && binding.RemovedAt == nil
		found := false
		for _, key := range binding.ThinkingOptions {
			found = found || key == frozen.ThinkingKey
		}
		current = current && found
		current = current && view.Capabilities.Text == "supported"
		if frozen.Capabilities.ToolCalling == "supported" && view.Capabilities.Tools != "supported" {
			current = false
		}
		if frozen.Capabilities.ImageInput == "supported" && view.Capabilities.Image != "supported" {
			current = false
		}
		frozen.Display.Locked = true
		frozen.Display.Availability = Availability{Available: current}
		if !current {
			reason := "MODEL_UNAVAILABLE"
			frozen.Display.Availability.Reason = &reason
		}
		return frozen.LockedModel, frozen.Display, nil
	}
	m, selection, e := s.resolveModel(view, *binding, v.SelectedThinkingOptionKey)
	if e != nil {
		return m, selection, e
	}
	if binding.RemovedAt != nil {
		selection.Availability.Available = false
		reason := "MODEL_UNAVAILABLE"
		selection.Availability.Reason = &reason
	}
	return m, selection, nil
}
func (s *Service) viewState(st StateRepository, v *SessionRow, user uint64) (ViewState, error) {
	out := ViewState{SessionID: v.ID}
	pref, e := st.Preference(user, v.ID, false)
	if e != nil {
		return out, e
	}
	if pref != nil {
		out.ViewedThroughSeq = pref.ViewedThroughSeq
		out.ViewedAt = pref.ViewedAt
	}
	out.LatestResult, e = st.LatestResult(v.ID)
	if e != nil {
		return out, e
	}
	out.UnviewedCount, e = st.UnviewedResults(v.ID, out.ViewedThroughSeq)
	out.HasUnviewed = out.UnviewedCount > 0
	return out, e
}
func (s *Service) detail(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, v *SessionRow, a *identity.Auth) (SessionDetail, error) {
	_, selection, e := s.selection(tx, r, v)
	if e != nil {
		return SessionDetail{}, e
	}
	agent, e := r.Definition(v.AgentID, false)
	if e != nil {
		return SessionDetail{}, e
	}
	if agent == nil {
		return SessionDetail{}, integrity()
	}
	counts, e := st.SessionCounts(v.ID)
	if e != nil {
		return SessionDetail{}, e
	}
	out := SessionDetail{Configuration: s.configuration(v), Principal: agentcore.PrincipalRef{Kind: "user", ID: agentcore.ID(v.ExecutorUserID)}, RootSessionID: v.RootSessionID, Selection: selection, State: SessionState{LastSeq: v.LastSeq, ActiveRunID: v.ActiveRunID, QueuePaused: v.QueuePaused, PendingInputCount: counts.Inputs, PendingInteractionCount: counts.Interactions, LastActivityAt: v.LastActivityAt, ScopeKind: agent.ScopeKind, Workspace: WorkspaceState{CWD: sessionCWD(v.ProjectContextID), Availability: "not_allocated"}}, Permissions: Permissions{Read: true}}
	var activeRootID *uint64
	if v.ActiveRunID != nil {
		run, e := st.Run(*v.ActiveRunID, false)
		if e != nil {
			return out, e
		}
		if run == nil {
			return out, integrity()
		}
		out.State.ActiveRunStatus = &run.Status
		activeRootID = &run.ID
		if run.RootRunID != nil {
			activeRootID = run.RootRunID
		}
	}
	if v.CloudComputerID != nil {
		out.State.Workspace.ComputerID = v.CloudComputerID
		cr, err := CloudStateFor(tx)
		if err != nil {
			return out, err
		}
		computer, err := cr.Computer(*v.CloudComputerID, false)
		if err != nil {
			return out, err
		}
		if computer == nil {
			return out, integrity()
		}
		out.State.Workspace.Availability = computer.State
		if computer.State == "ready" {
			out.State.Workspace.Availability = "available"
		}
		out.State.Workspace.BindingID = activeRootID
	}
	executor, e := executionAccount(tx, v, false)
	if e != nil {
		return out, e
	}
	access, e := checkSessionProjects(r, agent, executor, v.ProjectContextID)
	if e != nil {
		return out, e
	}
	out.State.AgentAccessAvailable = access.AgentAvailable
	out.State.ProjectContextAvailable = access.ContextAvailable
	if v.RootSessionID == nil {
		out.Permissions.Manage = true
		out.Permissions.Control = v.ArchivedAt == nil
		out.Permissions.Submit = v.ArchivedAt == nil && agent.Enabled && selection.Availability.Available && access.AgentAvailable && access.ContextAvailable
		out.Permissions.Answer = out.Permissions.Submit
		out.Permissions.Approve = out.Permissions.Submit && v.ExecutionMode == "interactive"
		pref, e := st.Preference(a.User.ID, v.ID, false)
		if e != nil {
			return out, e
		}
		rev := uint64(1)
		if pref != nil {
			out.Preference.Pinned = pref.Pinned
			rev = pref.RowVersion
		}
		out.Preference.Version = strings.Trim(s.tag(fmt.Sprintf("preference/%d", a.User.ID), v.ID, rev), `"`)
		view, e := s.viewState(st, v, a.User.ID)
		if e != nil {
			return out, e
		}
		out.ViewState = &view
	}
	return out, nil
}
func (s *Service) ListSessions(ctx context.Context, raw string, q SessionQuery) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		base := Query{Page: q.Page, PageSize: q.PageSize, Q: q.Q, Mode: q.Mode}
		if e := validateQuery(&base); e != nil {
			return e
		}
		q.Page = base.Page
		q.PageSize = base.PageSize
		q.Q = base.Q
		if q.Mode == "" {
			q.Mode = "interactive"
		}
		if q.Mode == "service" && a.User.Role != "admin" {
			return httpx.E(403, "FORBIDDEN", "需要管理员权限")
		}
		if q.Archived == "" {
			q.Archived = "false"
		}
		if q.Archived != "false" && q.Archived != "true" && q.Archived != "all" {
			return httpx.Invalid("archived", "unsupported")
		}
		if q.Attention != "" && q.Attention != "response_required" && q.Attention != "result_unviewed" || q.Attention != "" && q.Archived != "false" {
			return httpx.Invalid("attention", "invalid_filter")
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		items, total, e := st.Sessions(a.User.ID, q)
		if e != nil {
			return e
		}
		attention, e := attentionFor(tx)
		if e != nil {
			return e
		}
		for i := range items {
			facts, e := attention.AttentionFor(items[i].ID, a.User.ID)
			if e != nil {
				return e
			}
			facts.Latest, e = st.LatestResult(items[i].ID)
			if e != nil {
				return e
			}
			items[i].Attention = facts
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}

// The caller authorizes the trusted scope before this helper. Replayed creation
// additionally checks the returned session's current content permission.
func (s *Service) sessionReceipt(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, a *identity.Auth, out *Result, key, command, scope string, input any, fn func(*Receipt) error) error {
	if !keyPattern.MatchString(key) {
		return httpx.Invalid("Idempotency-Key", "invalid_format")
	}
	body, e := agentcore.CanonicalJSON(input)
	if e != nil {
		return e
	}
	hash := sha256.Sum256(body)
	kind, id := splitScope(scope)
	rec, e := r.Receipt(strconv.FormatUint(a.User.ID, 10), kind, id, command, key)
	if e != nil {
		return e
	}
	if rec != nil {
		if !hmac.Equal(rec.Hash, hash[:]) {
			return httpx.E(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求")
		}
		if rec.TargetKind != nil && *rec.TargetKind == "session" && rec.TargetID != nil {
			if _, e = s.sessionAccess(st, *rec.TargetID, a, false, false); e != nil {
				return e
			}
		}
		var saved savedResult
		if json.Unmarshal(rec.Result, &saved) != nil {
			return integrity()
		}
		out.Status = rec.ResponseStatus
		out.Data = saved.Data
		out.Tag = saved.Tag
		out.Location = saved.Location
		out.Replayed = true
		return nil
	}
	rec = &Receipt{ActorKind: "user", ActorID: strconv.FormatUint(a.User.ID, 10), ScopeKind: kind, ScopeID: id, Command: command, Key: key, Hash: hash[:], Status: "pending", Result: json.RawMessage(`{}`), CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	if e = r.InsertReceipt(rec); e != nil {
		return e
	}
	if e = fn(rec); e != nil {
		return e
	}
	data, e := json.Marshal(out.Data)
	if e != nil {
		return e
	}
	rec.Result, e = json.Marshal(savedResult{data, out.Tag, out.Location})
	if e != nil {
		return e
	}
	rec.ResponseStatus = out.Status
	rec.Status = "completed"
	now := time.Now().UTC().Truncate(time.Millisecond)
	rec.CompletedAt = &now
	return r.SaveReceipt(rec)
}
func (s *Service) CreateSession(ctx context.Context, raw, key string, w SessionCreate) (*Result, error) {
	id, err := idValue(w.AgentID, "agent_id")
	if err != nil {
		return nil, err
	}
	return s.accessWithAgent(ctx, raw, false, id, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "session.create", "sessions", w, func(rec *Receipt) error {
			return s.createSessionTx(ctx, tx, r, st, a, out, rec, w)
		})
	})
}
func (s *Service) GetSession(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := s.sessionAccess(st, id, a, false, false)
		if e != nil {
			return e
		}
		value, e := s.detail(ctx, tx, r, st, v, a)
		if e != nil {
			return e
		}
		out.Data = value
		return nil
	})
}
func (s *Service) GetSessionConfiguration(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := s.sessionAccess(st, id, a, false, false)
		if e != nil {
			return e
		}
		out.Data = s.configuration(v)
		out.Tag = s.tag("session", id, v.RowVersion)
		return nil
	})
}
func (s *Service) GetPreference(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, true, false); e != nil {
			return e
		}
		v, e := st.Preference(a.User.ID, id, false)
		if e != nil {
			return e
		}
		rev := uint64(1)
		pinned := false
		if v != nil {
			rev = v.RowVersion
			pinned = v.Pinned
		}
		out.Tag = s.tag(fmt.Sprintf("preference/%d", a.User.ID), id, rev)
		out.Data = SessionPreference{pinned, strings.Trim(out.Tag, `"`)}
		return nil
	})
}
func (s *Service) PatchPreference(ctx context.Context, raw string, id uint64, tag string, w PreferencePatch) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		if !w.Pinned.Set || w.Pinned.Null {
			return httpx.Invalid("pinned", "required")
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, id, a, true, true); e != nil {
			return e
		}
		v, e := st.Preference(a.User.ID, id, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if v == nil {
			v = &PreferenceRow{UserID: a.User.ID, SessionID: id, RowVersion: 1, CreatedAt: now, UpdatedAt: now}
		}
		kind := fmt.Sprintf("preference/%d", a.User.ID)
		if e = checkTag(tag, s.tag(kind, id, v.RowVersion)); e != nil {
			return e
		}
		if v.Pinned != w.Pinned.Value {
			v.Pinned = w.Pinned.Value
			v.RowVersion++
			v.UpdatedAt = now
			v.PinnedAt = nil
			if v.Pinned {
				v.PinnedAt = &now
			}
			if e = st.SavePin(v); e != nil {
				return e
			}
		}
		out.Tag = s.tag(kind, id, v.RowVersion)
		out.Data = SessionPreference{v.Pinned, strings.Trim(out.Tag, `"`)}
		return nil
	})
}
func (s *Service) AdvanceView(ctx context.Context, raw string, id uint64, w ViewStateWrite) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		seq, e := idValue(w.ThroughSeq, "through_seq")
		if e != nil {
			return e
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := s.sessionAccess(st, id, a, true, true)
		if e != nil {
			return e
		}
		result, e := st.ResultAt(id, seq)
		if e != nil {
			return e
		}
		if result == nil {
			return httpx.E(422, "VIEW_POSITION_INVALID", "查看位置必须对应已完成的会话执行结果")
		}
		pref, e := st.Preference(a.User.ID, id, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if pref == nil {
			pref = &PreferenceRow{UserID: a.User.ID, SessionID: id, RowVersion: 1, CreatedAt: now, UpdatedAt: now}
		}
		if seq > pref.ViewedThroughSeq {
			pref.ViewedThroughSeq = seq
			pref.ViewedAt = &now
			if e = st.AdvanceView(pref); e != nil {
				return e
			}
		}
		view, e := s.viewState(st, v, a.User.ID)
		if e != nil {
			return e
		}
		out.Data = view
		return nil
	})
}

func (s *Service) createSessionTx(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, a *identity.Auth, out *Result, rec *Receipt, w SessionCreate) error {
	id, e := idValue(w.AgentID, "agent_id")
	if e != nil {
		return e
	}
	agent, e := r.Definition(id, false)
	if e != nil {
		return e
	}
	if e = s.definition(agent); e != nil {
		return e
	}
	if agent.Mode == "service" && a.User.Role != "admin" {
		return httpx.E(403, "FORBIDDEN", "需要管理员权限")
	}
	title := "新会话"
	if w.Title.Set {
		if w.Title.Null {
			return httpx.Invalid("title", "null_not_allowed")
		}
		title = strings.TrimSpace(w.Title.Value)
	}
	if title == "" || utf8.RuneCountInString(title) > 200 {
		return httpx.Invalid("title", "invalid_length")
	}
	v := &SessionRow{AgentID: id, ExecutionMode: agent.Mode, SessionKind: "root", Title: title, ExecutorUserID: a.User.ID, NextInputOrder: 1, RowVersion: 1, CreatedByActorKind: "user", CreatedByActorID: strconv.FormatUint(a.User.ID, 10), LockedModelConfig: json.RawMessage(`null`)}
	executor := a.User
	if agent.Mode == "service" {
		if agent.RobotUserID == nil {
			return integrity()
		}
		v.ExecutorUserID = *agent.RobotUserID
		executor, e = executionAccount(tx, v, false)
		if e != nil {
			return e
		}
	}
	if e = setInitialProject(r, v, agent, executor, w.ProjectID); e != nil {
		return e
	}
	if !agent.Enabled || agent.DefaultModelBindingID == nil {
		return httpx.E(409, "AGENT_UNAVAILABLE", "智能体当前不可用")
	}
	v.SelectedModelBindingID = *agent.DefaultModelBindingID
	bindings, e := r.ModelBindings(id, false)
	if e != nil {
		return e
	}
	for _, b := range bindings {
		if b.ID == v.SelectedModelBindingID {
			v.SelectedThinkingOptionKey = b.DefaultThinking
		}
	}
	if w.Selection != nil {
		v.SelectedModelBindingID, e = idValue(w.Selection.BindingID, "model_selection.model_binding_id")
		if e != nil {
			return e
		}
		v.SelectedThinkingOptionKey = w.Selection.Thinking
	}
	_, selection, e := s.selection(tx, r, v)
	if e != nil {
		return e
	}
	current, e := r.Definition(id, true)
	if e != nil {
		return e
	}
	if current == nil || current.RowVersion != agent.RowVersion || !current.Enabled {
		return httpx.E(409, "AGENT_UNAVAILABLE", "智能体配置已变化，请重新加载")
	}
	if !selection.Availability.Available {
		return httpx.E(409, "MODEL_UNAVAILABLE", "所选模型当前不可用")
	}
	if e = requireSessionProjects(r, current, executor, v.ProjectContextID); e != nil {
		return e
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	v.CreatedAt = now
	v.UpdatedAt = now
	v.LastActivityAt = now
	if e = st.InsertSession(v); e != nil {
		return e
	}
	titleSource := "default"
	if w.Title.Set {
		titleSource = "user"
	}
	if e = s.pinSessionTitle(st, v, titleSource, now); e != nil {
		return e
	}
	if e = st.SaveSession(v); e != nil {
		return e
	}
	detail, e := s.detail(ctx, tx, r, st, v, a)
	if e != nil {
		return e
	}
	out.Data = detail
	out.Status = 201
	out.Location = fmt.Sprintf("/api/v1/agents/sessions/%d", v.ID)
	kind := "session"
	rec.TargetKind = &kind
	rec.TargetID = &v.ID
	return audit(ctx, tx, a, "agent_session.create", "session", v.ID)
}
