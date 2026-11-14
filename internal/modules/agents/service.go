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

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type metadataKey struct{}

func WithMetadata(ctx context.Context, meta identity.Metadata) context.Context {
	return context.WithValue(ctx, metadataKey{}, meta)
}
func RepositoryFor(tx identity.Tx) (Repository, error) {
	p, ok := tx.(interface{ Agents() Repository })
	if !ok {
		return nil, unavailable()
	}
	return p.Agents(), nil
}
func (s *Service) access(ctx context.Context, raw string, admin bool, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	return s.accessWithAgent(ctx, raw, admin, 0, fn)
}
func (s *Service) accessWithAgent(ctx context.Context, raw string, admin bool, agentID uint64, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	if s.Identity == nil || s.ETag == nil {
		return nil, unavailable()
	}
	out := &Result{Status: 200}
	a, e := s.Identity.BusinessAccess(ctx, raw, func(tx identity.Tx) ([]uint64, error) { return robotAccountLocks(tx, agentID) }, func(tx identity.Tx, a *identity.Auth) error {
		if admin && a.User.Role != "admin" {
			return httpx.E(403, "FORBIDDEN", "需要管理员权限")
		}
		r, e := RepositoryFor(tx)
		if e != nil {
			return e
		}
		*out = Result{Status: 200}
		return fn(tx, r, a, out)
	})
	out.Auth = a
	if e == nil && s.Committed != nil {
		for _, receipt := range out.Commits {
			s.Committed(ctx, receipt)
		}
	}
	return out, e
}
func audit(ctx context.Context, tx identity.Tx, a *identity.Auth, action, kind string, id uint64) error {
	meta, _ := ctx.Value(metadataKey{}).(identity.Metadata)
	target := strconv.FormatUint(id, 10)
	e := identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: action, TargetType: kind, TargetID: &target, OccurredAt: time.Now().UTC(), Detail: json.RawMessage(`{}`)}
	if meta.RequestID != "" {
		e.RequestID = &meta.RequestID
	}
	if meta.IP != "" {
		e.IP = &meta.IP
	}
	return tx.Audit(e)
}
func (s *Service) definition(v *Definition) error {
	if v == nil {
		return missing()
	}
	if v.SchemaVersion != 1 || json.Unmarshal(v.BudgetJSON, &v.RuntimePolicy) != nil {
		return integrity()
	}
	if validateDefinition(v) != nil {
		return integrity()
	}
	v.QuestionTTL, v.ApprovalTTL = v.RuntimePolicy.QuestionTimeout, v.RuntimePolicy.ApprovalTimeout
	v.QueueTTL, v.RunTTL = v.RuntimePolicy.QueueTimeout, v.RuntimePolicy.RunTimeout
	v.Version = strings.Trim(s.tag("definition", v.ID, v.RowVersion), `"`)
	return nil
}
func encodeDefinition(v *Definition) error {
	var err error
	v.BudgetJSON, err = json.Marshal(v.RuntimePolicy)
	v.ConfigVersion = v.RowVersion
	return err
}

type savedResult struct {
	Data     json.RawMessage `json:"data"`
	Tag      string          `json:"tag"`
	Location string          `json:"location"`
}

func splitScope(scope string) (string, string) {
	kind, id, ok := strings.Cut(scope, ":")
	if !ok {
		return kind, "0"
	}
	return kind, id
}
func (s *Service) command(ctx context.Context, raw, key, command, scope string, input any, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	kind, scopeID := splitScope(scope)
	var agentID uint64
	if kind == "agent" {
		agentID, _ = strconv.ParseUint(scopeID, 10, 64)
	}
	return s.accessWithAgent(ctx, raw, true, agentID, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if !keyPattern.MatchString(key) {
			return httpx.Invalid("Idempotency-Key", "invalid_format")
		}
		b, e := agentcore.CanonicalJSON(input)
		if e != nil {
			return e
		}
		digest := sha256.Sum256(b)
		kind, scopeID := splitScope(scope)
		old, e := r.Receipt(strconv.FormatUint(a.User.ID, 10), kind, scopeID, command, key)
		if e != nil {
			return e
		}
		if old != nil {
			if !hmac.Equal(old.Hash, digest[:]) {
				return httpx.E(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求")
			}
			var v savedResult
			if json.Unmarshal(old.Result, &v) != nil {
				return integrity()
			}
			out.Data = v.Data
			out.Status = old.ResponseStatus
			out.Tag = v.Tag
			out.Location = v.Location
			out.Replayed = true
			return nil
		}
		rec := &Receipt{ActorKind: "user", ActorID: strconv.FormatUint(a.User.ID, 10), ScopeKind: kind, ScopeID: scopeID, Command: command, Key: key, Hash: digest[:], Status: "pending", Result: json.RawMessage(`{}`), CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
		if e = r.InsertReceipt(rec); e != nil {
			return e
		}
		if e = fn(tx, r, a, out); e != nil {
			return e
		}
		targetID, _ := strconv.ParseUint(scopeID, 10, 64)
		targetKind := kind
		if v, ok := out.Data.(*Definition); ok {
			targetID = v.ID
			targetKind = "agent"
		}
		if targetID != 0 {
			rec.TargetKind = &targetKind
			rec.TargetID = &targetID
		}
		data, e := json.Marshal(out.Data)
		if e != nil {
			return e
		}
		rec.Result, e = json.Marshal(savedResult{data, out.Tag, out.Location})
		if e != nil {
			return e
		}
		rec.Status = "completed"
		rec.ResponseStatus = out.Status
		now := time.Now().UTC()
		rec.CompletedAt = &now
		if e = r.SaveReceipt(rec); e != nil {
			return e
		}
		return audit(ctx, tx, a, command, targetKind, targetID)
	})
}
func (s *Service) ListDefinitions(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		rows, total, e := r.Definitions(q)
		if e != nil {
			return e
		}
		items := []DefinitionSummary{}
		for i := range rows {
			v := &rows[i]
			if e = s.definition(v); e != nil {
				return e
			}
			items = append(items, DefinitionSummary{ID: v.ID, Code: v.Code, Name: v.Name, Description: v.Description, Mode: v.Mode, Enabled: v.Enabled, DefaultModelBindingID: v.DefaultModelBindingID, ScopeKind: v.ScopeKind, ScopeID: v.ScopeID, RobotUserID: v.RobotUserID, PoolCapacity: v.PoolCapacity, ModelCount: v.ModelCount, ToolCount: v.ToolCount, MCPCount: v.MCPCount, Version: v.Version, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt})
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetDefinition(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		if e = s.definition(v); e != nil {
			return e
		}
		return s.definitionResult(r, out, v)
	})
}

// CheckActivation validates saved configuration without enabling the agent.
// Return the checked definition and its ETag so activation still detects edits.
func (s *Service) CheckActivation(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		if v == nil || v.DeletedAt != nil {
			return missing()
		}
		if e := s.validateEnabled(ctx, tx, r, id); e != nil {
			return e
		}
		v, e = r.Definition(id, false)
		if e != nil {
			return e
		}
		if e = s.definition(v); e != nil {
			return e
		}
		return s.definitionResult(r, out, v)
	})
}

func (s *Service) CreateDefinition(ctx context.Context, raw, key string, w DefinitionCreate) (*Result, error) {
	return s.command(ctx, raw, key, "agent.create", "agents", w, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if w.Enabled.Null {
			return httpx.Invalid("enabled", "null_not_allowed")
		}
		code := cryptox.ID()
		var e error
		v := &Definition{Code: code, Name: w.Name, Description: w.Description, Mode: w.Mode, SystemPrompt: w.SystemPrompt, RuntimePolicy: defaultRuntimePolicy(), SchemaVersion: 1, RowVersion: 1, Creator: a.User.ID, ScopeKind: w.ScopeKind, PoolCapacity: w.PoolCapacity}
		if w.RuntimePolicy != nil {
			v.RuntimePolicy = *w.RuntimePolicy
		}
		if w.ScopeID != nil {
			scopeID, err := idValue(*w.ScopeID, "scope_id")
			if err != nil {
				return err
			}
			v.ScopeID = &scopeID
		}
		if v.Mode == "service" && v.PoolCapacity == nil {
			v.PoolCapacity = new(1)
		}
		if w.Enabled.Set && w.Enabled.Value {
			return httpx.Invalid("enabled", "default_model_required")
		}
		if e = validateDefinition(v); e != nil {
			return e
		}
		exists, e := r.ScopeExists(v.ScopeKind, v.ScopeID)
		if e != nil {
			return e
		}
		if !exists {
			return httpx.Invalid("scope_id", "unavailable")
		}
		if v.Mode == "service" {
			now := time.Now().UTC().Truncate(time.Millisecond)
			robot := &identity.User{AccountType: "robot", Username: "bot_" + code[:26], DisplayName: v.Name, Role: "user", CreatedAt: now, UpdatedAt: now}
			if e = tx.InsertUser(robot); e != nil {
				return e
			}
			robot.Status = "disabled"
			if e = tx.SaveUser(robot); e != nil {
				return e
			}
			v.RobotUserID = &robot.ID
		}
		if e = encodeDefinition(v); e != nil {
			return e
		}
		if e = r.InsertDefinition(v); e != nil {
			return e
		}
		if e = insertServiceCloudTemplate(tx, v, w.CloudEnvironment); e != nil {
			return e
		}
		if e = s.definition(v); e != nil {
			return e
		}
		out.Status = 201
		out.Location = fmt.Sprintf("/api/v1/admin/agents/definitions/%d", v.ID)
		return s.definitionResult(r, out, v)
	})
}
func (s *Service) PatchDefinition(ctx context.Context, raw string, id uint64, tag string, w DefinitionPatch) (*Result, error) {
	return s.agentAccess(ctx, raw, id, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if !w.Name.Set && !w.Description.Set && !w.SystemPrompt.Set && !w.Enabled.Set && !w.RuntimePolicy.Set && !w.PoolCapacity.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		if w.Name.Null || w.Description.Null || w.SystemPrompt.Null || w.Enabled.Null || w.RuntimePolicy.Null || w.PoolCapacity.Null {
			return httpx.Invalid("body", "null_not_allowed")
		}
		// The parent/model locks precede the Agent lock when enabling execution.
		if w.Enabled.Set && w.Enabled.Value {
			if e := s.validateEnabled(ctx, tx, r, id); e != nil {
				return e
			}
		}
		v, e := r.Definition(id, true)
		if e != nil {
			return e
		}
		if e = s.definition(v); e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("definition", id, v.RowVersion)); e != nil {
			return e
		}
		if v.DeletedAt != nil {
			return missing()
		}
		old := *v
		if w.Name.Set {
			v.Name = w.Name.Value
		}
		if w.Description.Set {
			v.Description = w.Description.Value
		}
		if w.SystemPrompt.Set {
			v.SystemPrompt = w.SystemPrompt.Value
		}
		if w.Enabled.Set {
			v.Enabled = w.Enabled.Value
		}
		if w.RuntimePolicy.Set {
			v.RuntimePolicy = w.RuntimePolicy.Value
		}
		if w.PoolCapacity.Set {
			v.PoolCapacity = &w.PoolCapacity.Value
		}
		if e = validateDefinition(v); e != nil {
			return e
		}
		if !same(old, v) {
			v.RowVersion++
			if e = encodeDefinition(v); e != nil {
				return e
			}
			if e = r.SaveDefinition(v); e != nil {
				return e
			}
			if e = syncRobot(tx, v); e != nil {
				return e
			}
			if old.Enabled && !v.Enabled {
				if e = s.cancelAgentQueue(tx, r, out, id, "AGENT_DISABLED"); e != nil {
					return e
				}
			}
			if e = audit(ctx, tx, a, "agent.update", "agent", id); e != nil {
				return e
			}
		}
		if e = s.definition(v); e != nil {
			return e
		}
		return s.definitionResult(r, out, v)
	})
}
func (s *Service) DeleteDefinition(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.command(ctx, raw, key, "agent.delete", fmt.Sprintf("agent:%d", id), struct{}{}, func(tx identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := r.Definition(id, true)
		if e != nil {
			return e
		}
		if e = s.definition(v); e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("definition", id, v.RowVersion)); e != nil {
			return e
		}
		used, e := r.AgentHasActiveWork(id)
		if e != nil {
			return e
		}
		if used {
			return inUse()
		}
		if e = s.cancelAgentQueue(tx, r, out, id, "AGENT_DELETED"); e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		v.Enabled, v.DeletedAt = false, &now
		v.RowVersion++
		if e = encodeDefinition(v); e != nil {
			return e
		}
		if e = r.SaveDefinition(v); e != nil {
			return e
		}
		if e = syncRobot(tx, v); e != nil {
			return e
		}
		out.Status = 204
		return nil
	})
}
func (s *Service) ModelReferenceCheck(_ context.Context, tx identity.Tx, kind string, id uint64) (bool, error) {
	r, e := RepositoryFor(tx)
	if e != nil {
		return false, e
	}
	return r.ModelReferenced(kind, id)
}
