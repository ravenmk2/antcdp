package models

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type metadataKey struct{}

func WithMetadata(ctx context.Context, meta identity.Metadata) context.Context {
	return context.WithValue(ctx, metadataKey{}, meta)
}
func repository(tx identity.Tx) (Repository, error) {
	p, ok := tx.(interface{ Models() Repository })
	if !ok {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "模型存储暂不可用")
	}
	return p.Models(), nil
}
func (s *Service) access(ctx context.Context, raw string, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	if s.Identity == nil || s.ETag == nil {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "模型服务暂不可用")
	}
	out := &Result{Status: 200}
	a, err := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		if a.User.Role != "admin" {
			return httpx.E(403, "FORBIDDEN", "需要管理员权限")
		}
		r, e := repository(tx)
		if e != nil {
			return e
		}
		*out = Result{Status: 200}
		return fn(tx, r, a, out)
	})
	out.Auth = a
	return out, err
}
func audit(ctx context.Context, tx identity.Tx, a *identity.Auth, action, kind string, id uint64) error {
	meta, _ := ctx.Value(metadataKey{}).(identity.Metadata)
	target := strconv.FormatUint(id, 10)
	detail := json.RawMessage(`{}`)
	event := identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: action, TargetType: kind, TargetID: &target, OccurredAt: time.Now().UTC(), Detail: detail}
	if meta.RequestID != "" {
		event.RequestID = &meta.RequestID
	}
	if meta.IP != "" {
		event.IP = &meta.IP
	}
	return tx.Audit(event)
}
func (s *Service) provider(v *Provider) error {
	if v == nil {
		return missing()
	}
	if v.SchemaVersion != 1 || !v.SecretValid || json.Unmarshal(v.StoredConfig, &v.Config) != nil {
		return integrity()
	}
	if v.Config.BaseURL != v.BaseURL {
		return integrity()
	}
	v.Authentication = Authentication{Method: v.AuthMethod, HasSecret: v.HasSecret}
	v.Version = strings.Trim(s.tag("provider", v.ID, v.RowVersion), `"`)
	return nil
}
func (s *Service) definition(v *Definition) error {
	if v == nil {
		return missing()
	}
	if v.SchemaVersion != 1 || json.Unmarshal(v.CapabilitiesJSON, &v.Capabilities) != nil || json.Unmarshal(v.ThinkingJSON, &v.Thinking) != nil {
		return integrity()
	}
	v.ThinkingLevels, v.ThinkingMapping = thinkingConfig(v.Thinking)
	v.Version = strings.Trim(s.tag("definition", v.ID, v.RowVersion), `"`)
	return nil
}
func (s *Service) references(ctx context.Context, tx identity.Tx, kind string, id uint64) (bool, error) {
	if s.ReferenceCheck == nil {
		return false, nil
	}
	return s.ReferenceCheck(ctx, tx, kind, id)
}
func (s *Service) ProviderTypes(ctx context.Context, raw string) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, _ Repository, _ *identity.Auth, out *Result) error {
		if s.Types == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "模型适配器未配置")
		}
		out.Data = s.Types()
		return nil
	})
}
func (s *Service) ListProviders(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		rows, total, e := r.Providers(q)
		if e != nil {
			return e
		}
		items := make([]ProviderSummary, 0, len(rows))
		for i := range rows {
			v := &rows[i]
			if e = s.provider(v); e != nil {
				return e
			}
			items = append(items, ProviderSummary{AuthMethod: v.AuthMethod, IconKey: v.IconKey, ID: v.ID, Code: v.Code, Name: v.Name, Description: v.Description, Type: v.Type, Enabled: v.Enabled, Endpoint: v.BaseURL, ModelCount: v.ModelCount, HasSecret: v.HasSecret, Version: v.Version, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt})
		}
		out.Data = items
		out.Pagination = &Pagination{q.Page, q.PageSize, total}
		return nil
	})
}
func (s *Service) GetProvider(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("provider", id, v.RowVersion)
		return nil
	})
}
func (s *Service) ListDefinitions(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		rows, total, e := r.Definitions(q)
		if e != nil {
			return e
		}
		items := make([]DefinitionSummary, 0, len(rows))
		for i := range rows {
			v := &rows[i]
			if e = s.definition(v); e != nil {
				return e
			}
			items = append(items, DefinitionSummary{IconKey: v.IconKey, ID: v.ID, ProviderID: v.ProviderID, Name: v.Name, RemoteModelID: v.RemoteModelID, Protocol: v.Protocol, Enabled: v.Enabled, Capabilities: v.Capabilities, Version: v.Version})
		}
		out.Data = items
		out.Pagination = &Pagination{q.Page, q.PageSize, total}
		return nil
	})
}
func (s *Service) GetDefinition(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		if e = s.definition(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("definition", id, v.RowVersion)
		return nil
	})
}

// mutate performs a normal transaction and records the management audit event.
func (s *Service) mutate(ctx context.Context, raw, action, kind string, id uint64, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if err := fn(tx, r, a, out); err != nil {
			return err
		}
		switch v := out.Data.(type) {
		case *Provider:
			id = v.ID
		case *Definition:
			id = v.ID
		}
		return audit(ctx, tx, a, action, kind, id)
	})
}
func (s *Service) writeSecret(r Repository, p *Provider, a AuthenticationWrite) error {
	if a.Secret.Operation == "keep" {
		if a.Method != p.AuthMethod {
			return httpx.Invalid("authentication", "keep_method_mismatch")
		}
		return nil
	}
	value := ""
	if a.Secret.Operation == "replace" {
		if s.Cipher == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "凭据加密暂不可用")
		}
		var e error
		value, e = s.Cipher(fmt.Sprintf("models/provider/%d/authentication", p.ID), *a.Secret.Value, true)
		if e != nil {
			return e
		}
	}
	if e := r.SetSecret(p.ID, value); e != nil {
		return e
	}
	p.AuthMethod = a.Method
	p.HasSecret = value != ""
	p.SecretValid = true
	return nil
}
func (s *Service) CreateProvider(ctx context.Context, raw string, w ProviderCreate) (*Result, error) {
	return s.mutate(ctx, raw, "model_provider.create", "model_provider", 0, func(_ identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if w.Config != nil {
			config := *w.Config
			w.Config = &config
		}
		if e := validateIcon(w.IconKey); e != nil {
			return e
		}
		w.Name = strings.TrimSpace(w.Name)
		if e := names(w.Name, w.Description); e != nil {
			return e
		}
		if !validType(w.Type) {
			return httpx.Invalid("provider_type", "unsupported")
		}
		if e := validateConfig(w.Config); e != nil {
			return e
		}
		if e := validateAuth(w.Type, w.Authentication, true); e != nil {
			return e
		}
		if w.Enabled.Null {
			return httpx.Invalid("enabled", "invalid_format")
		}
		code, e := codeValue(w.Code)
		if e != nil {
			return e
		}
		p := &Provider{IconKey: w.IconKey, Code: code, Name: w.Name, Description: w.Description, Type: w.Type, Enabled: true, Config: *w.Config, BaseURL: w.Config.BaseURL, AuthMethod: w.Authentication.Method, IdentityConfig: json.RawMessage(`{}`), SchemaVersion: 1, RowVersion: 1, ConfigVersion: 1, SecretRevision: 1, SecretValid: true, Creator: a.User.ID}
		if w.Enabled.Set {
			p.Enabled = w.Enabled.Value
		}
		p.StoredConfig, e = json.Marshal(p.Config)
		if e != nil {
			return e
		}
		if e = r.InsertProvider(p); e != nil {
			return e
		}
		if e = s.writeSecret(r, p, *w.Authentication); e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		out.Data = p
		out.Status = 201
		out.Tag = s.tag("provider", p.ID, p.RowVersion)
		out.Location = fmt.Sprintf("/api/v1/admin/models/providers/%d", p.ID)
		return nil
	})
}
func (s *Service) PatchProvider(ctx context.Context, raw string, id uint64, tag string, w ProviderPatch) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(p.ID) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		if !w.IconKey.Set && !w.Name.Set && !w.Description.Set && !w.Enabled.Set && !w.Config.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		if w.Name.Null || w.Description.Null || w.Enabled.Null || w.Config.Null {
			return httpx.Invalid("body", "null_not_allowed")
		}
		old := *p
		if w.IconKey.Set {
			p.IconKey = nil
			if !w.IconKey.Null {
				p.IconKey = &w.IconKey.Value
			}
		}
		if e = validateIcon(p.IconKey); e != nil {
			return e
		}
		if w.Name.Set {
			p.Name = strings.TrimSpace(w.Name.Value)
		}
		if w.Description.Set {
			p.Description = w.Description.Value
		}
		if w.Enabled.Set {
			p.Enabled = w.Enabled.Value
		}
		if w.Config.Set {
			p.Config = w.Config.Value
			if e = validateConfig(&p.Config); e != nil {
				return e
			}
			if p.Config.BaseURL != old.Config.BaseURL || !same(p.Config.Region, old.Config.Region) {
				used, err := r.ProviderReferenced(id)
				if err != nil {
					return err
				}
				external, err := s.references(ctx, tx, "model_provider", id)
				if err != nil {
					return err
				}
				if used || external {
					return inUse()
				}
			}
		}
		if e = names(p.Name, p.Description); e != nil {
			return e
		}
		if !same(old.Config, p.Config) || p.Enabled != old.Enabled {
			p.ConfigVersion++
		}
		if !same(p.IconKey, old.IconKey) || p.Name != old.Name || p.Description != old.Description || p.ConfigVersion != old.ConfigVersion {
			p.RowVersion++
			p.BaseURL = p.Config.BaseURL
			p.StoredConfig, e = json.Marshal(p.Config)
			if e != nil {
				return e
			}
			if e = r.SaveProvider(p); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "model_provider.update", "model_provider", id); e != nil {
				return e
			}
		}
		if e = s.provider(p); e != nil {
			return e
		}
		out.Data = p
		out.Tag = s.tag("provider", id, p.RowVersion)
		return nil
	})
}
func (s *Service) UpdateAuthentication(ctx context.Context, raw string, id uint64, tag string, w AuthenticationWrite) (*Result, error) {
	return s.mutate(ctx, raw, "model_provider.authentication", "model_provider", id, func(tx identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(p.ID) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		if e = validateAuth(p.Type, &w, false); e != nil {
			return e
		}
		if p.AuthMethod != w.Method {
			used, err := r.ProviderReferenced(id)
			if err != nil {
				return err
			}
			external, err := s.references(ctx, tx, "model_provider", id)
			if err != nil {
				return err
			}
			if used || external {
				return inUse()
			}
		}
		changed := w.Secret.Operation == "replace" || p.AuthMethod != w.Method || w.Secret.Operation == "clear" && p.HasSecret
		if e = s.writeSecret(r, p, w); e != nil {
			return e
		}
		if changed {
			p.RowVersion++
			p.ConfigVersion++
			p.SecretRevision++
			if e = r.SaveProvider(p); e != nil {
				return e
			}
		}
		if e = s.provider(p); e != nil {
			return e
		}
		out.Data = p
		out.Tag = s.tag("provider", id, p.RowVersion)
		return nil
	})
}
func (s *Service) DeleteProvider(ctx context.Context, raw string, id uint64, tag string) (*Result, error) {
	return s.mutate(ctx, raw, "model_provider.delete", "model_provider", id, func(tx identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(p.ID) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		used, e := s.references(ctx, tx, "model_provider", id)
		if e != nil {
			return e
		}
		if p.ModelCount > 0 || used {
			return inUse()
		}
		if e = r.DeleteProvider(id); e != nil {
			return e
		}
		out.Status = 204
		out.Data = nil
		return nil
	})
}
func (s *Service) lockDefinition(r Repository, id uint64) (*Provider, *Definition, error) {
	d, e := r.Definition(id, false)
	if e != nil {
		return nil, nil, e
	}
	if d == nil {
		return nil, nil, missing()
	}
	p, e := r.Provider(d.ProviderID)
	if e != nil {
		return nil, nil, e
	}
	if e = s.provider(p); e != nil {
		return nil, nil, e
	}
	d, e = r.Definition(id, true)
	if e != nil {
		return nil, nil, e
	}
	if e = s.definition(d); e != nil {
		return nil, nil, e
	}
	return p, d, nil
}
func (s *Service) CreateDefinition(ctx context.Context, raw string, w DefinitionCreate) (*Result, error) {
	return s.mutate(ctx, raw, "model_definition.create", "model_definition", 0, func(_ identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		id, e := validID(w.ProviderID)
		if e != nil {
			return e
		}
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(p.ID) {
			return testingBusy()
		}
		if w.Enabled.Null {
			return httpx.Invalid("enabled", "invalid_format")
		}
		d := &Definition{IconKey: w.IconKey, ProviderID: id, RemoteModelID: w.RemoteModelID, Name: strings.TrimSpace(w.Name), Description: w.Description, Protocol: w.Protocol, Enabled: true, Capabilities: w.Capabilities, ContextWindow: w.ContextWindow, MaxOutput: w.MaxOutput, Parameters: w.Parameters, Thinking: w.Thinking, SchemaVersion: 1, RowVersion: 1, ConfigVersion: 1, Creator: a.User.ID}
		if d.Thinking == nil {
			d.Thinking, e = s.resolveThinking(p.Type, d.Protocol, w.ThinkingLevels, w.ThinkingMapping)
			if e != nil {
				return e
			}
		}
		if w.Enabled.Set {
			d.Enabled = w.Enabled.Value
		}
		if e = s.validateDefinition(p, d); e != nil {
			return e
		}
		if e = encodeDefinition(d); e != nil {
			return e
		}
		if e = r.InsertDefinition(d); e != nil {
			return e
		}
		if e = s.definition(d); e != nil {
			return e
		}
		out.Data = d
		out.Status = 201
		out.Tag = s.tag("definition", d.ID, d.RowVersion)
		out.Location = fmt.Sprintf("/api/v1/admin/models/definitions/%d", d.ID)
		return nil
	})
}
func encodeDefinition(d *Definition) error {
	var e error
	d.CapabilitiesJSON, e = json.Marshal(d.Capabilities)
	if e != nil {
		return e
	}
	d.ThinkingJSON, e = json.Marshal(d.Thinking)
	return e
}
func (s *Service) PatchDefinition(ctx context.Context, raw string, id uint64, tag string, w DefinitionPatch) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		p, d, e := s.lockDefinition(r, id)
		if e != nil {
			return e
		}
		if s.isTesting(p.ID) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("definition", id, d.RowVersion)); e != nil {
			return e
		}
		if !w.IconKey.Set && !w.Name.Set && !w.Description.Set && !w.Enabled.Set && !w.Capabilities.Set && !w.ContextWindow.Set && !w.MaxOutput.Set && !w.Parameters.Set && !w.Thinking.Set && !w.ThinkingLevels.Set && !w.ThinkingMapping.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		if w.Name.Null || w.Description.Null || w.Enabled.Null || w.Capabilities.Null || w.ContextWindow.Null || w.MaxOutput.Null || w.Parameters.Null || w.Thinking.Null || w.ThinkingLevels.Null || w.ThinkingMapping.Null {
			return httpx.Invalid("body", "null_not_allowed")
		}
		old := *d
		if w.IconKey.Set {
			d.IconKey = nil
			if !w.IconKey.Null {
				d.IconKey = &w.IconKey.Value
			}
		}
		if w.Name.Set {
			d.Name = strings.TrimSpace(w.Name.Value)
		}
		if w.Description.Set {
			d.Description = w.Description.Value
		}
		if w.Enabled.Set {
			d.Enabled = w.Enabled.Value
		}
		if w.Capabilities.Set {
			d.Capabilities = w.Capabilities.Value
		}
		if w.ContextWindow.Set {
			d.ContextWindow = w.ContextWindow.Value
		}
		if w.MaxOutput.Set {
			d.MaxOutput = w.MaxOutput.Value
		}
		if w.Parameters.Set {
			d.Parameters = w.Parameters.Value
		}
		if w.Thinking.Set {
			d.Thinking = w.Thinking.Value
		}
		if w.ThinkingLevels.Set || w.ThinkingMapping.Set {
			levels, mapping := thinkingConfig(d.Thinking)
			if w.ThinkingLevels.Set {
				levels = w.ThinkingLevels.Value
			}
			if p.Type != "custom" {
				mapping = nil
			}
			if w.ThinkingMapping.Set {
				mapping = w.ThinkingMapping.Value
			}
			d.Thinking, e = s.resolveThinking(p.Type, d.Protocol, levels, mapping)
			if e != nil {
				return e
			}
		}
		if e = s.validateDefinition(p, d); e != nil {
			return e
		}
		if !same(old, d) {
			d.RowVersion++
			if d.Enabled != old.Enabled || d.ContextWindow != old.ContextWindow || d.MaxOutput != old.MaxOutput || !same(d.Capabilities, old.Capabilities) || !same(d.Parameters, old.Parameters) || !same(d.Thinking, old.Thinking) {
				d.ConfigVersion++
			}
			if e = encodeDefinition(d); e != nil {
				return e
			}
			if e = r.SaveDefinition(d); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "model_definition.update", "model_definition", id); e != nil {
				return e
			}
		}
		if e = s.definition(d); e != nil {
			return e
		}
		out.Data = d
		out.Tag = s.tag("definition", id, d.RowVersion)
		return nil
	})
}
func (s *Service) DeleteDefinition(ctx context.Context, raw string, id uint64, tag string) (*Result, error) {
	return s.mutate(ctx, raw, "model_definition.delete", "model_definition", id, func(tx identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		p, d, e := s.lockDefinition(r, id)
		if e != nil {
			return e
		}
		if s.isTesting(p.ID) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("definition", id, d.RowVersion)); e != nil {
			return e
		}
		used, e := s.references(ctx, tx, "model_definition", id)
		if e != nil {
			return e
		}
		if used {
			return inUse()
		}
		if e = r.DeleteDefinition(id); e != nil {
			return e
		}
		out.Data = nil
		out.Status = 204
		return nil
	})
}
