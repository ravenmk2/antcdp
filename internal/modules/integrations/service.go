package integrations

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var credentialCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var strongTagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)

type Service struct {
	Identity  *identity.Service
	Store     func() (identity.Store, error)
	Cipher    func(purpose, value string, seal bool) (string, error)
	ETag      func(string) string
	PublicURL string
	// Probe is a controlled test seam. Production uses the restricted GitLab transport.
	Probe func(context.Context, *GitLabConfig, string, time.Time) Diagnostic
}

// Field distinguishes omission from explicit null. Nested object decoding is strict too.
type Field[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (f *Field[T]) UnmarshalJSON(b []byte) error {
	f.Set = true
	f.Null = bytes.Equal(bytes.TrimSpace(b), []byte("null"))
	if f.Null {
		return nil
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(&f.Value); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("invalid JSON value")
	}
	return nil
}

type CommonWrite struct {
	Name        Field[string] `json:"name"`
	Description Field[string] `json:"description"`
	Enabled     Field[bool]   `json:"enabled"`
}
type GitLabConfigCreate struct {
	BaseURL string  `json:"base_url"`
	CA      *string `json:"custom_ca_pem"`
}
type GitLabConfigPatch struct {
	BaseURL Field[string] `json:"base_url"`
	CA      Field[string] `json:"custom_ca_pem"`
}
type ConnectionCreate struct {
	Code        Field[string]       `json:"code"`
	Name        string              `json:"name"`
	Description Field[string]       `json:"description"`
	Enabled     Field[bool]         `json:"enabled"`
	Config      *GitLabConfigCreate `json:"config"`
}
type ConnectionWrite struct {
	CommonWrite
	Config Field[GitLabConfigPatch] `json:"config"`
}
type TokenSecret struct {
	Token string `json:"token"`
}
type Authentication struct {
	Method   string          `json:"auth_method"`
	Identity json.RawMessage `json:"identity_config"`
	Secret   *TokenSecret    `json:"secret"`
}
type CredentialCreate struct {
	Code           Field[string]    `json:"code"`
	Name           string           `json:"name"`
	Description    Field[string]    `json:"description"`
	Authentication *Authentication  `json:"authentication"`
	ExpiresAt      Field[time.Time] `json:"expires_at"`
}
type CredentialWrite struct {
	CommonWrite
	ExpiresAt Field[time.Time] `json:"expires_at"`
}
type SelectionWrite struct {
	CredentialID string `json:"credential_id"`
}
type Result struct {
	Data          any
	Tag           string
	CollectionTag string
	Location      string
}

func fail() error      { return httpx.E(404, "NOT_FOUND", "服务连接或凭证不存在") }
func forbidden() error { return httpx.E(403, "FORBIDDEN", "没有维护权限") }
func stale() error     { return httpx.E(412, "VERSION_CONFLICT", "资料已变化，请重新加载") }
func changedState() error {
	return httpx.E(409, "STATE_CHANGED", "配置或状态已变化，请重新验证")
}
func integrity() error { return httpx.E(500, "DATA_INTEGRITY_ERROR", "服务配置完整性异常") }
func unavailable() error {
	return httpx.E(409, "CREDENTIAL_UNAVAILABLE", "凭证已停用、过期或材料不完整")
}
func check(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前资料")
	}
	if !strongTagPattern.MatchString(got) {
		return httpx.Invalid("If-Match", "invalid_format")
	}
	if got != want {
		return stale()
	}
	return nil
}
func names(name, desc string) error {
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if utf8.RuneCountInString(desc) > 1000 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}
func codeValue(f Field[string]) (string, error) {
	if f.Null {
		return "", httpx.Invalid("code", "invalid_format")
	}
	code := strings.TrimSpace(f.Value)
	if code == "" {
		return newCredentialCode()
	}
	if !credentialCodePattern.MatchString(code) {
		return "", httpx.Invalid("code", "invalid_format")
	}
	return code, nil
}
func applyCommon(w CommonWrite, name, desc *string, enabled *bool) error {
	if w.Name.Null {
		return httpx.Invalid("name", "required")
	}
	if w.Description.Null {
		return httpx.Invalid("description", "invalid_format")
	}
	if w.Enabled.Null {
		return httpx.Invalid("enabled", "invalid_format")
	}
	if w.Name.Set {
		*name = strings.TrimSpace(w.Name.Value)
	}
	if w.Description.Set {
		*desc = w.Description.Value
	}
	if w.Enabled.Set {
		*enabled = w.Enabled.Value
	}
	return names(*name, *desc)
}
func emptyCommon(w CommonWrite) bool { return !w.Name.Set && !w.Description.Set && !w.Enabled.Set }
func repo(tx identity.Tx) (Repository, error) {
	r, ok := tx.(Repository)
	if !ok {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "服务集成暂不可用")
	}
	return r, nil
}
func config(r Repository, id uint64) (*GitLabConfig, error) {
	g, err := r.GitLabConfig(id)
	if err != nil {
		return nil, err
	}
	if g == nil || g.ID != id || ValidateConfig(g.BaseURL, g.CA) != nil {
		return nil, integrity()
	}
	return g, nil
}
func (s *Service) access(ctx context.Context, raw string, owner CredentialOwnership, id uint64, write bool, fn func(identity.Tx, Repository, *identity.Auth, *ServiceConnection, CredentialOwnership) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		r, err := repo(tx)
		if err != nil {
			return err
		}
		if s.ETag == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "版本服务暂不可用")
		}
		switch owner.Type {
		case "system":
			if a.User.Role != "admin" {
				return forbidden()
			}
			owner.Owner = 0
		case "personal":
			owner.Owner = a.User.ID
		case "project":
			cr, ok := tx.(c.Repository)
			if !ok {
				return forbidden()
			}
			if err = cr.LockCollaboration(c.Project, owner.Owner, 0); err != nil {
				return err
			}
			p, err := cr.Resource(c.Project, owner.Owner, a.User.ID)
			if err != nil {
				return err
			}
			if p == nil {
				return fail()
			}
			if a.User.Role != "admin" && p.Role != "admin" {
				return forbidden()
			}
			if write && p.EndedAt != nil {
				return httpx.E(409, "PROJECT_ARCHIVED", "项目已归档")
			}
		case "directory":
			if write {
				return forbidden()
			}
		default:
			return forbidden()
		}
		var v *ServiceConnection
		if id != 0 {
			v, err = r.Connection(id)
			if err != nil {
				return err
			}
			if v == nil || v.Type != "gitlab" {
				return fail()
			}
			if v.Version == 0 || v.ConfigVersion == 0 || v.CredentialsVersion == 0 || v.FallbackVersion == 0 {
				return integrity()
			}
			g, err := config(r, id)
			if err != nil {
				return err
			}
			v.Config = *g
		}
		return fn(tx, r, a, v, owner)
	})
}
func audit(tx identity.Tx, a *identity.Auth, kind string, id uint64, name, action string, detail any, meta identity.Metadata) error {
	target, uid, username := fmt.Sprint(id), a.User.ID, a.User.Username
	data, _ := json.Marshal(detail)
	return tx.Audit(identity.Event{ActorID: &uid, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &username, Action: kind + "." + action, TargetType: kind, TargetID: &target, TargetLabel: name, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: data})
}
func (s *Service) connectionResult(v *ServiceConnection) Result {
	tag := s.connectionTag(v)
	v.EditVersion = unquote(tag)
	return Result{Data: v, Tag: tag}
}
func (s *Service) credentialResult(v *ServiceCredential) Result {
	tag := s.credentialTag(v)
	v.EditVersion = unquote(tag)
	return Result{Data: v, Tag: tag}
}
func (s *Service) webhookResult(v *WebhookSettings) Result {
	tag := s.webhookTag(v)
	v.EditVersion = unquote(tag)
	return Result{Data: v, Tag: tag}
}
func selection(id *uint64, tag string) Result {
	var value any
	if id != nil {
		value = fmt.Sprint(*id)
	}
	return Result{Data: map[string]any{"credential_id": value, "version": unquote(tag)}, Tag: tag}
}
func (s *Service) List(ctx context.Context, raw string, admin bool) (Result, *identity.Auth, error) {
	out := Result{}
	owner := CredentialOwnership{Type: "directory"}
	if admin {
		owner.Type = "system"
	}
	a, err := s.access(ctx, raw, owner, 0, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *ServiceConnection, _ CredentialOwnership) error {
		rows, err := r.Connections()
		if err != nil {
			return err
		}
		items := []map[string]any{}
		for _, v := range rows {
			if admin && v.Type != "gitlab" {
				continue
			}
			items = append(items, map[string]any{"id": fmt.Sprint(v.ID), "code": v.Code, "service_type": v.Type, "name": v.Name, "description": v.Description, "enabled": v.Enabled})
		}
		out.Data = map[string]any{"items": items}
		return nil
	})
	return out, a, err
}
func (s *Service) Create(ctx context.Context, raw string, w ConnectionCreate, meta identity.Metadata) (Result, *identity.Auth, error) {
	out := Result{}
	a, err := s.access(ctx, raw, CredentialOwnership{Type: "system"}, 0, true, func(tx identity.Tx, r Repository, a *identity.Auth, _ *ServiceConnection, _ CredentialOwnership) error {
		if w.Config == nil {
			return httpx.Invalid("config", "required")
		}
		code, err := codeValue(w.Code)
		if err != nil {
			return err
		}
		v := &ServiceConnection{Type: "gitlab", Code: code, Enabled: true, Version: 1, ConfigVersion: 1, CredentialsVersion: 1, FallbackVersion: 1, Creator: a.User.ID}
		v.Name = strings.TrimSpace(w.Name)
		if err = applyCommon(CommonWrite{Description: w.Description, Enabled: w.Enabled}, &v.Name, &v.Description, &v.Enabled); err != nil {
			return err
		}
		v.Config = GitLabConfig{BaseURL: strings.TrimRight(w.Config.BaseURL, "/"), CA: w.Config.CA}
		if err = ValidateConfig(v.Config.BaseURL, v.Config.CA); err != nil {
			return err
		}
		if err = r.InsertConnection(v); err != nil {
			return err
		}
		out = s.connectionResult(v)
		out.Location = fmt.Sprintf("/api/v1/admin/service-connections/gitlab/%d", v.ID)
		return audit(tx, a, "service_connection", v.ID, v.Name, "created", map[string]any{}, meta)
	})
	return out, a, err
}
func (s *Service) Admin(ctx context.Context, raw string, id uint64, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	out := Result{}
	a, err := s.access(ctx, raw, CredentialOwnership{Type: "system"}, id, op != "get" && op != "fallback" && op != "diagnostics", func(tx identity.Tx, r Repository, a *identity.Auth, v *ServiceConnection, _ CredentialOwnership) error {
		out = s.connectionResult(v)
		switch op {
		case "get":
			return nil
		case "diagnostics":
			raw, err := r.Diagnostics("connection", id)
			if err != nil {
				return err
			}
			d, err := diagnosticView(raw, v.Version, v.ConfigVersion, 0, 0, 0)
			out = Result{Data: map[string]any{"latest": d}}
			return err
		case "update":
			if err := check(tag, s.connectionTag(v)); err != nil {
				return err
			}
			w := input.(ConnectionWrite)
			if emptyCommon(w.CommonWrite) && !w.Config.Set {
				return httpx.Invalid("body", "empty_patch")
			}
			before, _ := json.Marshal(v)
			oldURL, oldCA, oldEnabled := v.Config.BaseURL, v.Config.CA, v.Enabled
			if err := applyCommon(w.CommonWrite, &v.Name, &v.Description, &v.Enabled); err != nil {
				return err
			}
			if w.Config.Set {
				if w.Config.Null || (!w.Config.Value.BaseURL.Set && !w.Config.Value.CA.Set) {
					return httpx.Invalid("config", "invalid_format")
				}
				cfg := w.Config.Value
				if cfg.BaseURL.Null {
					return httpx.Invalid("config.base_url", "required")
				}
				if cfg.BaseURL.Set {
					v.Config.BaseURL = strings.TrimRight(cfg.BaseURL.Value, "/")
				}
				if cfg.CA.Set {
					v.Config.CA = nil
					if !cfg.CA.Null {
						v.Config.CA = &cfg.CA.Value
					}
				}
				if err := ValidateConfig(v.Config.BaseURL, v.Config.CA); err != nil {
					return err
				}
			}
			after, _ := json.Marshal(v)
			if bytes.Equal(before, after) {
				return nil
			}
			configChanged := oldURL != v.Config.BaseURL || !sameString(oldCA, v.Config.CA)
			v.Version++
			if configChanged {
				v.ConfigVersion++
				if err := r.SaveGitLabConfig(&v.Config); err != nil {
					return err
				}
			}
			if err := r.SaveConnection(v); err != nil {
				return err
			}
			out = s.connectionResult(v)
			return audit(tx, a, "service_connection", v.ID, v.Name, "updated", map[string]any{"enabled_before": oldEnabled, "enabled_after": v.Enabled, "config_changed": configChanged}, meta)
		case "delete":
			if err := check(tag, s.connectionTag(v)); err != nil {
				return err
			}
			n, err := r.CredentialCount(id)
			if err != nil {
				return err
			}
			if n != 0 {
				return httpx.E(409, "CONNECTION_NOT_EMPTY", "请先移除该连接的全部凭证")
			}
			if err = r.DeleteConnection(id); err != nil {
				return err
			}
			out = Result{}
			return audit(tx, a, "service_connection", v.ID, v.Name, "deleted", map[string]any{}, meta)
		case "fallback", "set_fallback", "clear_fallback":
			// A broken reference is an integrity error, never an implicit absence/fallback.
			if v.FallbackID != nil {
				cr, err := r.Credential(*v.FallbackID)
				if err != nil {
					return err
				}
				if !owned(cr, v, CredentialOwnership{Type: "system"}) {
					return integrity()
				}
			}
			if op != "fallback" {
				if err := check(tag, s.fallbackTag(v)); err != nil {
					return err
				}
				var target *uint64
				if op == "set_fallback" {
					cid, err := c.ID(input.(SelectionWrite).CredentialID)
					if err != nil {
						return err
					}
					cr, err := r.Credential(cid)
					if err != nil {
						return err
					}
					if !owned(cr, v, CredentialOwnership{Type: "system"}) {
						return fail()
					}
					if !cr.Usable() {
						return unavailable()
					}
					target = &cid
				}
				if !sameID(v.FallbackID, target) {
					v.FallbackID = target
					v.FallbackVersion++
					if err := r.SaveConnection(v); err != nil {
						return err
					}
					if err := audit(tx, a, "service_connection", id, v.Name, "fallback_changed", map[string]any{}, meta); err != nil {
						return err
					}
				}
			}
			out = selection(v.FallbackID, s.fallbackTag(v))
			return nil
		}
		return fail()
	})
	return out, a, err
}
func sameString(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func sameID(a, b *uint64) bool     { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func purpose(kind string, connection, id uint64, method string) string {
	return fmt.Sprintf("service-integrations/gitlab/%s/%d/%d/%s/v1", kind, connection, id, method)
}
func owned(cr *ServiceCredential, v *ServiceConnection, o CredentialOwnership) bool {
	if cr == nil || cr.ConnectionID != v.ID || cr.Type != v.Type || cr.Ownership != o.Type {
		return false
	}
	switch o.Type {
	case "system":
		return cr.UserID == nil && cr.ProjectID == nil
	case "personal":
		return cr.ProjectID == nil && cr.UserID != nil && *cr.UserID == o.Owner
	case "project":
		return cr.UserID == nil && cr.ProjectID != nil && *cr.ProjectID == o.Owner
	}
	return false
}
func validateAuthentication(a *Authentication) error {
	if a == nil {
		return httpx.Invalid("authentication", "required")
	}
	if a.Method != "gitlab_access_token" {
		return httpx.Invalid("authentication.auth_method", "unsupported")
	}
	var identity map[string]json.RawMessage
	if len(a.Identity) == 0 || json.Unmarshal(a.Identity, &identity) != nil || identity == nil || len(identity) != 0 {
		return httpx.Invalid("authentication.identity_config", "invalid_format")
	}
	if a.Secret == nil {
		return httpx.Invalid("authentication.secret", "required")
	}
	return validateToken(a.Secret.Token)
}
func validateToken(token string) error {
	if len(token) < 8 || len(token) > 8192 || strings.ContainsAny(token, "\r\n\x00") || strings.TrimSpace(token) != token || strings.Trim(token, "*") == "" {
		return httpx.Invalid("token", "invalid_format")
	}
	return nil
}
func newCredentialCode() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[:]), nil
}
