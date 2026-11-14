package webaccess

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

func WithMetadata(ctx context.Context, m identity.Metadata) context.Context {
	return context.WithValue(ctx, metadataKey{}, m)
}
func repository(tx identity.Tx) (Repository, error) {
	v, ok := tx.(interface{ WebAccess() Repository })
	if !ok {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "网络检索存储暂不可用")
	}
	return v.WebAccess(), nil
}
func (s *Service) access(ctx context.Context, raw string, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	if s.Identity == nil || s.ETag == nil {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "网络检索暂不可用")
	}
	out := &Result{Status: 200}
	a, e := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
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
	return out, e
}
func audit(ctx context.Context, tx identity.Tx, a *identity.Auth, action, kind string, id uint64) error {
	meta, _ := ctx.Value(metadataKey{}).(identity.Metadata)
	target := strconv.FormatUint(id, 10)
	event := identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: action, TargetType: kind, TargetID: &target, OccurredAt: time.Now().UTC(), Detail: json.RawMessage(`{}`)}
	if meta.RequestID != "" {
		event.RequestID = &meta.RequestID
	}
	if meta.IP != "" {
		event.IP = &meta.IP
	}
	return tx.Audit(event)
}
func (s *Service) provider(p *Provider) error {
	if p == nil {
		return missing()
	}
	if p.SchemaVersion != 1 || !p.SecretValid || json.Unmarshal(p.StoredConfig, &p.Config) != nil || json.Unmarshal(p.SupportedJSON, &p.Supported) != nil || p.Config.BaseURL != p.BaseURL || p.AuthMethod != "api_key" || !same(p.Supported, capabilities(p.Type)) {
		return integrity()
	}
	p.Authentication = Authentication{Method: p.AuthMethod, HasSecret: p.HasSecret}
	p.Version = strings.Trim(s.tag("provider", p.ID, p.RowVersion), `"`)
	return nil
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
		for i := range rows {
			if e = s.provider(&rows[i]); e != nil {
				return e
			}
		}
		out.Data = rows
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetProvider(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		out.Data = p
		out.Tag = s.tag("provider", id, p.RowVersion)
		return nil
	})
}
func (s *Service) writeSecret(r Repository, p *Provider, a AuthenticationWrite) error {
	if a.Secret.Operation == "keep" {
		return nil
	}
	value := ""
	if a.Secret.Operation == "replace" {
		if s.Cipher == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "凭据加密暂不可用")
		}
		var e error
		value, e = s.Cipher(fmt.Sprintf("webaccess/provider/%d/authentication", p.ID), *a.Secret.Value, true)
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
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if w.Config != nil {
			c := *w.Config
			w.Config = &c
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
		if e := validateAuth(w.Authentication, true); e != nil {
			return e
		}
		if w.Enabled.Null {
			return httpx.Invalid("enabled", "invalid_format")
		}
		code, e := codeValue(w.Code)
		if e != nil {
			return e
		}
		p := &Provider{Code: code, Name: w.Name, Description: w.Description, Type: w.Type, Enabled: true, Config: *w.Config, BaseURL: w.Config.BaseURL, AuthMethod: "api_key", IdentityConfig: json.RawMessage(`{}`), Supported: capabilities(w.Type), SchemaVersion: 1, RowVersion: 1, ConfigVersion: 1, SecretRevision: 1, SecretValid: true, Creator: a.User.ID}
		if w.Enabled.Set {
			p.Enabled = w.Enabled.Value
		}
		p.StoredConfig, e = json.Marshal(p.Config)
		if e != nil {
			return e
		}
		p.SupportedJSON, e = json.Marshal(p.Supported)
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
		out.Location = fmt.Sprintf("/api/v1/admin/web-access/providers/%d", p.ID)
		return audit(ctx, tx, a, "web_access_provider.create", "web_access_provider", p.ID)
	})
}
func (s *Service) PatchProvider(ctx context.Context, raw string, id uint64, tag string, w ProviderPatch) (*Result, error) {
	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if _, err := r.Settings(); err != nil {
			return err
		}
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(id) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		if !w.Name.Set && !w.Description.Set && !w.Enabled.Set && !w.Config.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		if w.Name.Null || w.Description.Null || w.Enabled.Null || w.Config.Null {
			return httpx.Invalid("body", "null_not_allowed")
		}
		old := *p
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
			if old.Config.BaseURL != p.Config.BaseURL {
				if s.active[id] > 0 {
					return inUse()
				}
				used, err := r.ProviderReferenced(id)
				if err != nil {
					return err
				}
				if used {
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
		if p.Name != old.Name || p.Description != old.Description || p.ConfigVersion != old.ConfigVersion {
			p.RowVersion++
			p.BaseURL = p.Config.BaseURL
			p.StoredConfig, e = json.Marshal(p.Config)
			if e != nil {
				return e
			}
			if e = r.SaveProvider(p); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "web_access_provider.update", "web_access_provider", id); e != nil {
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
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(id) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		if e = validateAuth(&w, false); e != nil {
			return e
		}
		changed := w.Secret.Operation == "replace" || w.Secret.Operation == "clear" && p.HasSecret
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
		if changed {
			return audit(ctx, tx, a, "web_access_provider.authentication", "web_access_provider", id)
		}
		return nil
	})
}
func (s *Service) DeleteProvider(ctx context.Context, raw string, id uint64, tag string) (*Result, error) {
	s.leaseMu.Lock()
	defer s.leaseMu.Unlock()
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if _, err := r.Settings(); err != nil {
			return err
		}
		p, e := r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		if s.isTesting(id) {
			return testingBusy()
		}
		if e = checkTag(tag, s.tag("provider", id, p.RowVersion)); e != nil {
			return e
		}
		if s.active[id] > 0 {
			return inUse()
		}
		used, e := r.ProviderReferenced(id)
		if e != nil {
			return e
		}
		if used {
			return inUse()
		}
		if e = r.DeleteProvider(id); e != nil {
			return e
		}
		out.Status = 204
		out.Data = nil
		return audit(ctx, tx, a, "web_access_provider.delete", "web_access_provider", id)
	})
}
