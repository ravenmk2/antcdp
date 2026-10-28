package integrations

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var credentialCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

type Service struct {
	Identity *identity.Service
	Store    func() (identity.Store, error)
	Cipher   func(purpose, value string, seal bool) (string, error)
}
type CommonWrite struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
}
type ConfigWrite struct {
	BaseURL        *string `json:"base_url"`
	CA             *string `json:"custom_ca_pem"`
	WebhookEnabled *bool   `json:"webhook_enabled"`
}
type Create struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	BaseURL     string  `json:"base_url"`
	CA          *string `json:"custom_ca_pem"`
}
type SecretWrite struct {
	Token  string `json:"token"`
	Method string `json:"verification_method"`
}
type CredentialCreate struct {
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	AuthMethod  string   `json:"auth_method"`
	Identity    struct{} `json:"identity_config"`
	Secret      struct {
		Token string `json:"token"`
	} `json:"secret"`
	ExpiresAt *time.Time `json:"expires_at"`
}
type CredentialWrite struct {
	CommonWrite
	ExpiresAt json.RawMessage `json:"expires_at"`
}
type Command struct {
	CredentialID      string `json:"credential_id"`
	ConfigVersion     string `json:"expected_config_version"`
	CollectionVersion string `json:"expected_collection_version"`
}
type Result struct {
	Data any
	Tag  string
}

func fail() error      { return httpx.E(404, "NOT_FOUND", "集成或凭证不存在") }
func forbidden() error { return httpx.E(403, "FORBIDDEN", "没有维护权限") }
func stale() error     { return httpx.E(412, "VERSION_CONFLICT", "资料已变化，请重新加载") }
func check(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前资料")
	}
	if got != want {
		return stale()
	}
	return nil
}
func names(name, desc string) error {
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if utf8.RuneCountInString(desc) > 1000 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}
func repo(tx identity.Tx) (Repository, error) {
	r, ok := tx.(Repository)
	if !ok {
		return nil, httpx.E(503, "FEATURE_UNAVAILABLE", "集成模块暂不可用")
	}
	return r, nil
}
func (s *Service) access(ctx context.Context, raw string, scope Scope, id uint64, write bool, fn func(identity.Tx, Repository, *identity.Auth, *Integration, Scope) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		r, e := repo(tx)
		if e != nil {
			return e
		}
		switch scope.Type {
		case "system":
			if a.User.Role != "admin" {
				return forbidden()
			}
			scope.Owner = 0
		case "personal":
			scope.Owner = a.User.ID
		case "project":
			cr, ok := tx.(c.Repository)
			if !ok {
				return forbidden()
			}
			if e = cr.LockCollaboration(c.Project, scope.Owner, 0); e != nil {
				return e
			}
			p, e := cr.Resource(c.Project, scope.Owner, a.User.ID)
			if e != nil {
				return e
			}
			if p == nil {
				return fail()
			}
			if a.User.Role != "admin" && p.Role != "admin" {
				return forbidden()
			}
			if write && p.EndedAt != nil {
				return httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
			}
		case "directory":
			if write {
				return forbidden()
			}
		default:
			return forbidden()
		}
		var v *Integration
		if id != 0 {
			v, e = r.Integration(id)
			if e != nil {
				return e
			}
			if v == nil || v.Type != "gitlab" {
				return fail()
			}
		}
		return fn(tx, r, a, v, scope)
	})
}
func audit(tx identity.Tx, a *identity.Auth, v *Integration, action string, meta identity.Metadata) error {
	id := fmt.Sprint(v.ID)
	uid := a.User.ID
	un := a.User.Username
	return tx.Audit(identity.Event{ActorID: &uid, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &un, Action: "integration." + action, TargetType: "integration", TargetID: &id, TargetLabel: v.Name, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: json.RawMessage(`{}`)})
}
func config(r Repository, id uint64) (*GitLab, error) {
	g, e := r.GitLab(id)
	if e == nil && g == nil {
		e = httpx.E(503, "DATA_INTEGRITY_ERROR", "服务配置缺失")
	}
	return g, e
}
func (s *Service) List(ctx context.Context, raw string, admin bool) (Result, *identity.Auth, error) {
	var out any
	scope := Scope{Type: "directory"}
	if admin {
		scope.Type = "system"
	}
	a, e := s.access(ctx, raw, scope, 0, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *Integration, _ Scope) error {
		rows, e := r.Integrations()
		if e != nil {
			return e
		}
		if admin {
			filtered := []Integration{}
			for _, row := range rows {
				if row.Type == "gitlab" {
					filtered = append(filtered, row)
				}
			}
			out = filtered
		} else {
			items := []map[string]any{}
			for _, v := range rows {
				items = append(items, map[string]any{"id": fmt.Sprint(v.ID), "service_type": v.Type, "name": v.Name, "description": v.Description, "enabled": v.Enabled})
			}
			out = items
		}
		return nil
	})
	return Result{Data: out}, a, e
}
func (s *Service) Create(ctx context.Context, raw string, w Create, meta identity.Metadata) (Result, *identity.Auth, error) {
	w.Name = strings.TrimSpace(w.Name)
	if e := names(w.Name, w.Description); e != nil {
		return Result{}, nil, e
	}
	if e := ValidateConfig(w.BaseURL, w.CA); e != nil {
		return Result{}, nil, e
	}
	var out Result
	a, e := s.access(ctx, raw, Scope{Type: "system"}, 0, true, func(tx identity.Tx, r Repository, a *identity.Auth, _ *Integration, _ Scope) error {
		v := &Integration{Type: "gitlab", Name: w.Name, Description: w.Description, Enabled: true, Version: 1, CredentialsVersion: 1, DefaultVersion: 1, Creator: a.User.ID}
		g := &GitLab{BaseURL: strings.TrimRight(w.BaseURL, "/"), CA: w.CA}
		if e := r.InsertIntegration(v, g); e != nil {
			return e
		}
		saved, e := r.Integration(v.ID)
		if e != nil {
			return e
		}
		out = Result{saved, saved.Tag()}
		return audit(tx, a, v, "created", meta)
	})
	return out, a, e
}

// Admin uses typed route DTOs; operation is supplied by a registered route, never the request.
func (s *Service) Admin(ctx context.Context, raw string, id uint64, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	write := op != "get" && op != "config" && op != "default" && op != "diagnostics"
	a, e := s.access(ctx, raw, Scope{Type: "system"}, id, write, func(tx identity.Tx, r Repository, a *identity.Auth, v *Integration, _ Scope) error {
		out = Result{v, v.Tag()}
		changed := false
		switch op {
		case "get":
			return nil
		case "update":
			if e := check(tag, v.Tag()); e != nil {
				return e
			}
			w := input.(CommonWrite)
			oldN, oldD, oldE := v.Name, v.Description, v.Enabled
			if w.Name != nil {
				v.Name = strings.TrimSpace(*w.Name)
			}
			if w.Description != nil {
				v.Description = *w.Description
			}
			if w.Enabled != nil {
				v.Enabled = *w.Enabled
			}
			if e := names(v.Name, v.Description); e != nil {
				return e
			}
			changed = oldN != v.Name || oldD != v.Description || oldE != v.Enabled
			if changed {
				v.Version++
			}
			out = Result{v, v.Tag()}
		case "delete":
			if e := check(tag, v.Tag()); e != nil {
				return e
			}
			g, e := config(r, id)
			if e != nil {
				return e
			}
			if e = check(input.(Command).ConfigVersion, g.Tag()); e != nil {
				return e
			}
			n, e := r.CredentialCount(id)
			if e != nil {
				return e
			}
			if n > 0 {
				return httpx.E(409, "INTEGRATION_HAS_CREDENTIALS", "请先删除该集成的全部凭证")
			}
			if e = r.DeleteIntegration(id); e != nil {
				return e
			}
			out = Result{Data: map[string]bool{"deleted": true}}
			return audit(tx, a, v, "deleted", meta)
		case "default", "set_default", "clear_default":
			if op != "default" {
				if e := check(tag, v.DefaultTag()); e != nil {
					return e
				}
				var target *uint64
				if op == "set_default" {
					cid, e := c.ID(input.(Command).CredentialID)
					if e != nil {
						return e
					}
					cr, e := r.Credential(cid)
					if e != nil {
						return e
					}
					if cr == nil || cr.IntegrationID != id || cr.Scope != "system" {
						return fail()
					}
					if !cr.Usable() {
						return httpx.Invalid("credential_id", "unavailable")
					}
					target = &cid
				}
				changed = !sameID(v.DefaultID, target)
				if changed {
					v.DefaultID = target
					v.DefaultVersion++
				}
			}
			var cid any
			if v.DefaultID != nil {
				cid = fmt.Sprint(*v.DefaultID)
			}
			out = Result{map[string]any{"credential_id": cid, "version": fmt.Sprint(v.DefaultVersion)}, v.DefaultTag()}
		case "diagnostics":
			d, e := r.Diagnostics("connection", id)
			if e != nil {
				return e
			}
			h, e := r.Diagnostics("webhook", id)
			if e != nil {
				return e
			}
			g, e := config(r, id)
			if e != nil {
				return e
			}
			out = Result{Data: map[string]any{"connection": diagnosticView(d, g.ConnectionVersion, 0, 0), "webhook": diagnosticView(h, 0, 0, g.WebhookVersion)}}
			return nil
		case "config", "update_config", "webhook_secret", "generate_webhook":
			g, e := config(r, id)
			if e != nil {
				return e
			}
			out = Result{g, g.Tag()}
			if op == "config" {
				return nil
			}
			if e = check(tag, g.Tag()); e != nil {
				return e
			}
			if op == "update_config" {
				w := input.(ConfigWrite)
				oldURL, oldCA, oldOn := g.BaseURL, ptrString(g.CA), g.WebhookEnabled
				if w.BaseURL != nil {
					g.BaseURL = strings.TrimRight(*w.BaseURL, "/")
				}
				if w.CA != nil {
					g.CA = w.CA
				}
				if w.WebhookEnabled != nil {
					g.WebhookEnabled = *w.WebhookEnabled
				}
				if e = ValidateConfig(g.BaseURL, g.CA); e != nil {
					return e
				}
				if g.WebhookEnabled && !g.HasSecret {
					return httpx.Invalid("webhook_enabled", "secret_required")
				}
				conn := oldURL != g.BaseURL || oldCA != ptrString(g.CA)
				hook := oldOn != g.WebhookEnabled
				changed = conn || hook
				if conn {
					g.ConnectionVersion++
				}
				if hook {
					g.WebhookVersion++
				}
			} else {
				w := SecretWrite{}
				if op == "generate_webhook" {
					w = SecretWrite{Token: cryptox.Token(), Method: "secret_token"}
				} else {
					w = input.(SecretWrite)
				}
				if e = ValidateWebhookSecret(w.Method, w.Token); e != nil {
					return e
				}
				sealed, e := s.Cipher(purpose("webhook", id), w.Token, true)
				if e != nil {
					return e
				}
				if e = r.SetSecret("webhook", id, sealed); e != nil {
					return e
				}
				g.Method = w.Method
				g.HasSecret = true
				g.WebhookVersion++
				changed = true
				if op == "generate_webhook" {
					out.Data = map[string]any{"token": w.Token}
				}
			}
			if changed {
				g.Version++
				if e = r.SaveGitLab(g); e != nil {
					return e
				}
				if e = audit(tx, a, v, op, meta); e != nil {
					return e
				}
			}
			out.Tag = g.Tag()
			return nil
		default:
			return fail()
		}
		if changed {
			if e := r.SaveIntegration(v); e != nil {
				return e
			}
			if op == "update" {
				fresh, err := r.Integration(id)
				if err != nil {
					return err
				}
				out = Result{fresh, fresh.Tag()}
			}
			return audit(tx, a, v, op, meta)
		}
		return nil
	})
	return out, a, e
}
func ptrString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func sameID(a, b *uint64) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func purpose(kind string, id uint64) string {
	return fmt.Sprintf("integration/gitlab/%s/%d/v1", kind, id)
}
func scoped(cr *Credential, v *Integration, scope Scope) bool {
	if cr == nil || cr.IntegrationID != v.ID || cr.Scope != scope.Type {
		return false
	}
	switch scope.Type {
	case "system":
		return cr.UserID == nil && cr.ProjectID == nil
	case "personal":
		return cr.UserID != nil && *cr.UserID == scope.Owner
	case "project":
		return cr.ProjectID != nil && *cr.ProjectID == scope.Owner
	}
	return false
}

func (s *Service) Credentials(ctx context.Context, raw string, id, cid uint64, scope Scope, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	write := op != "list" && op != "get" && op != "diagnostics"
	a, e := s.access(ctx, raw, scope, id, write, func(tx identity.Tx, r Repository, a *identity.Auth, v *Integration, scope Scope) error {
		if op == "list" {
			rows, e := r.Credentials(id, scope)
			out = Result{map[string]any{"items": rows, "mutation_version": v.CollectionTag(scope)}, v.CollectionTag(scope)}
			return e
		}
		if op == "create" || op == "preferred" || op == "clear_preferred" {
			if e := check(tag, v.CollectionTag(scope)); e != nil {
				return e
			}
		}
		var cr *Credential
		if cid != 0 {
			var e error
			cr, e = r.Credential(cid)
			if e != nil {
				return e
			}
			if !scoped(cr, v, scope) {
				return fail()
			}
			out = Result{cr, cr.Tag()}
			if write {
				if e = check(tag, cr.Tag()); e != nil {
					return e
				}
			}
		}
		switch op {
		case "get":
			return nil
		case "diagnostics":
			d, e := r.Diagnostics("credential", cid)
			if e != nil {
				return e
			}
			g, e := config(r, id)
			if e != nil {
				return e
			}
			out = Result{Data: diagnosticView(d, g.ConnectionVersion, cr.MaterialVersion, 0)}
			return nil
		case "create":
			w := input.(CredentialCreate)
			w.Name = strings.TrimSpace(w.Name)
			if e := names(w.Name, w.Description); e != nil {
				return e
			}
			if w.AuthMethod != "gitlab_access_token" {
				return httpx.Invalid("auth_method", "unsupported")
			}
			w.Code = strings.TrimSpace(w.Code)
			if w.Code == "" {
				var err error
				w.Code, err = newCredentialCode()
				if err != nil {
					return err
				}
			}
			if !credentialCodePattern.MatchString(w.Code) {
				return httpx.Invalid("code", "invalid_format")
			}
			if e := validateToken(w.Secret.Token); e != nil {
				return e
			}
			identityJSON, _ := json.Marshal(w.Identity)
			cr = &Credential{Code: w.Code, Type: v.Type, IntegrationID: id, Scope: scope.Type, Name: w.Name, Description: w.Description, AuthMethod: w.AuthMethod, Identity: identityJSON, Enabled: true, HasSecret: true, ExpiresAt: w.ExpiresAt, Version: 1, MaterialVersion: 1, Creator: a.User.ID}
			if scope.Type == "project" {
				cr.ProjectID = &scope.Owner
			}
			if scope.Type == "personal" {
				cr.UserID = &scope.Owner
			}
			if e := r.InsertCredential(cr); e != nil {
				return e
			}
			secret, e := s.Cipher(purpose("credential", cr.ID), w.Secret.Token, true)
			if e != nil {
				return e
			}
			if e = r.SetSecret("credential", cr.ID, secret); e != nil {
				return e
			}
		case "update":
			w := input.(CredentialWrite)
			before, _ := json.Marshal(cr)
			if w.Name != nil {
				cr.Name = strings.TrimSpace(*w.Name)
			}
			if w.Description != nil {
				cr.Description = *w.Description
			}
			if w.Enabled != nil {
				cr.Enabled = *w.Enabled
			}
			if len(w.ExpiresAt) > 0 {
				if e := json.Unmarshal(w.ExpiresAt, &cr.ExpiresAt); e != nil {
					return httpx.Invalid("expires_at", "invalid_format")
				}
			}
			if e := names(cr.Name, cr.Description); e != nil {
				return e
			}
			after, _ := json.Marshal(cr)
			if string(before) == string(after) {
				return nil
			}
			cr.Version++
			if !cr.Enabled {
				cr.Preferred = false
				if sameID(v.DefaultID, &cid) {
					v.DefaultID = nil
					v.DefaultVersion++
				}
			}
			if e := r.SaveCredential(cr); e != nil {
				return e
			}
		case "secret":
			w := input.(SecretWrite)
			if w.Method != "" {
				return httpx.Invalid("verification_method", "unexpected_field")
			}
			if e := validateToken(w.Token); e != nil {
				return e
			}
			value, e := s.Cipher(purpose("credential", cid), w.Token, true)
			if e != nil {
				return e
			}
			if e = r.SetSecret("credential", cid, value); e != nil {
				return e
			}
			cr.Version++
			cr.MaterialVersion++
			cr.HasSecret = true
			if e = r.SaveCredential(cr); e != nil {
				return e
			}
		case "delete":
			if e := check(input.(Command).CollectionVersion, v.CollectionTag(scope)); e != nil {
				return e
			}
			if sameID(v.DefaultID, &cid) {
				v.DefaultID = nil
				v.DefaultVersion++
			}
			if e := r.DeleteCredential(cid); e != nil {
				return e
			}
		case "preferred", "clear_preferred":
			var target uint64
			if op == "preferred" {
				var e error
				target, e = c.ID(input.(Command).CredentialID)
				if e != nil {
					return e
				}
				cr, e = r.Credential(target)
				if e != nil {
					return e
				}
				if !scoped(cr, v, scope) {
					return fail()
				}
				if !cr.Usable() {
					return httpx.Invalid("credential_id", "unavailable")
				}
			}
			rows, e := r.Credentials(id, scope)
			if e != nil {
				return e
			}
			changed := false
			for j := range rows {
				if rows[j].Preferred && rows[j].ID != target {
					rows[j].Preferred = false
					rows[j].Version++
					changed = true
					if e = r.SaveCredential(&rows[j]); e != nil {
						return e
					}
				}
			}
			if target != 0 && !cr.Preferred {
				cr.Preferred = true
				cr.Version++
				changed = true
				if e = r.SaveCredential(cr); e != nil {
					return e
				}
			}
			if !changed {
				out = Result{Data: map[string]string{"mutation_version": v.CollectionTag(scope)}}
				return nil
			}
		default:
			return fail()
		}
		v.CredentialsVersion++
		if e := r.SaveIntegration(v); e != nil {
			return e
		}
		out = Result{Data: map[string]string{"mutation_version": v.CollectionTag(scope)}}
		if cr != nil && op != "delete" {
			out = Result{cr, cr.Tag()}
		}
		return audit(tx, a, v, "credential."+op, meta)
	})
	return out, a, e
}
func validateToken(token string) error {
	if len(token) < 8 || len(token) > 8192 || strings.ContainsAny(token, "\r\n\x00") || strings.TrimSpace(token) != token || strings.Trim(token, "*") == "" {
		return httpx.Invalid("token", "invalid_format")
	}
	return nil
}

func diagnosticView(raw json.RawMessage, connection, material, webhook uint64) *Diagnostic {
	if len(raw) == 0 {
		return nil
	}
	var d Diagnostic
	if json.Unmarshal(raw, &d) != nil {
		return nil
	}
	d.Outdated = connection != 0 && d.ConnectionVersion != connection || material != 0 && d.MaterialVersion != material || webhook != 0 && d.WebhookVersion != webhook
	return &d
}

// newCredentialCode returns a UUID v4 without separators.
func newCredentialCode() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[:]), nil
}
