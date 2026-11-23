package integrations

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/credentials"

	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var credentialCodePattern = resourcecode.Pattern
var strongTagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)

type Service struct {
	CredentialCipher credentials.Cipher
	Type             string
	Identity         *identity.Service
	Store            func() (identity.Store, error)
	Cipher           func(purpose, value string, seal bool) (string, error)
	ETag             func(string) string
	PublicURL        string
	// Probe is a controlled test seam. Production uses the restricted GitLab transport.
	Probe        func(context.Context, *HTTPConfig, string, time.Time) Diagnostic
	ReceiveEvent func(context.Context, identity.Tx, uint64, http.Header, []byte) (map[string]any, error)
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
type HTTPConfigCreate struct {
	Host                Field[string] `json:"host"`
	Port                Field[int]    `json:"port"`
	Database            Field[string] `json:"database"`
	TLSMode             Field[string] `json:"tls_mode"`
	DefaultOrganization Field[string] `json:"default_organization"`
	BaseURL             string        `json:"base_url"`
	CA                  *string       `json:"custom_ca_pem"`
}
type HTTPConfigPatch struct {
	Host                Field[string] `json:"host"`
	Port                Field[int]    `json:"port"`
	Database            Field[string] `json:"database"`
	TLSMode             Field[string] `json:"tls_mode"`
	DefaultOrganization Field[string] `json:"default_organization"`
	BaseURL             Field[string] `json:"base_url"`
	CA                  Field[string] `json:"custom_ca_pem"`
}
type ConnectionCreate struct {
	Code        Field[string]     `json:"code"`
	Name        string            `json:"name"`
	Description Field[string]     `json:"description"`
	Enabled     Field[bool]       `json:"enabled"`
	Config      *HTTPConfigCreate `json:"config"`
}
type ConnectionWrite struct {
	CommonWrite
	Config Field[HTTPConfigPatch] `json:"config"`
}
type TokenSecret struct {
	Token string `json:"token"`
}
type Authentication struct {
	Method   string          `json:"auth_method"`
	Identity json.RawMessage `json:"identity_config"`
	Secret   *TokenSecret    `json:"secret"`
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
func config(r Repository, v *ServiceConnection) (*HTTPConfig, error) {
	g, err := DecodeConnectionConfig(v.Type, v.ConfigSchemaVersion, v.ConfigJSON)
	if err != nil {
		return nil, err
	}
	if v.Type == "gitlab" {
		if _, err := webhookFor(r, v.ID); err != nil {
			return nil, err
		}
	}
	return g, nil
}
func (s *Service) access(ctx context.Context, raw string, owner CredentialOwnership, id uint64, write bool, fn func(identity.Tx, Repository, *identity.Auth, *ServiceConnection, CredentialOwnership) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, func(tx identity.Tx) ([]uint64, error) {
		if owner.Type != "robot" {
			return nil, nil
		}
		return []uint64{owner.Owner}, nil
	}, func(tx identity.Tx, a *identity.Auth) error {
		if _, ok := adapters[s.serviceType()]; !ok {
			return fail()
		}
		r, err := repo(tx)
		if err != nil {
			return err
		}
		if s.ETag == nil {
			return httpx.E(503, "SERVICE_UNAVAILABLE", "版本服务暂不可用")
		}
		switch owner.Type {
		case "platform":
			if a.User.Role != "admin" {
				return forbidden()
			}
			owner.Owner = 0
		case "user":
			owner.Owner = a.User.ID
		case "robot":
			robot, err := identity.AuthorizeRobotAccount(tx, a, owner.Owner)
			if err != nil {
				return err
			}
			owner.Type, owner.Owner = "user", robot.ID
		case "project":
			if err := authorizeSubject(tx, a, owner, true, write); err != nil {
				return err
			}
		case "directory":
			if write {
				return forbidden()
			}
			scope := routeScope(ctx)
			if scope.Type != "platform" {
				if err := authorizeSubject(tx, a, scope, false, false); err != nil {
					return err
				}
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
			if v == nil || v.Type != s.serviceType() {
				return fail()
			}
			if v.Version == 0 || v.ConfigVersion == 0 || v.CredentialsVersion == 0 || v.GrantsVersion == 0 || !v.ValidOwnership() {
				return integrity()
			}
			var allowed bool
			switch owner.Type {
			case "platform":
				allowed = v.Ownership == "platform"
			case "project":
				allowed, err = r.ConnectionGranted(v.ID, owner, write)
			case "user":
				allowed, err = userConnectionAllowed(r, v, owner.Owner)
			default:
				return forbidden()
			}
			if err != nil {
				return err
			}
			if !allowed {
				return fail()
			}
			if write && owner.Type == "user" && v.Ownership == "project" {
				active, err := ConnectionAllowed(r, v, CredentialOwnership{Type: "project", Owner: *v.ProjectID})
				if err != nil {
					return err
				}
				if !active {
					return httpx.E(409, "RESOURCE_READ_ONLY", "项目已结束，不能修改")
				}
			}
			g, err := config(r, v)
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
	tag := v.Tag()
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

func connectionSummary(v *ServiceConnection) map[string]any {
	var project any
	if v.ProjectID != nil {
		project = fmt.Sprint(*v.ProjectID)
	}
	return map[string]any{"id": fmt.Sprint(v.ID), "code": v.Code, "service_type": v.Type, "ownership_type": v.Ownership, "project_id": project, "name": v.Name, "description": v.Description, "enabled": v.Enabled}
}

func (s *Service) RobotConnections(ctx context.Context, raw string, agent uint64) (Result, *identity.Auth, error) {
	var out Result
	a, err := s.access(ctx, raw, CredentialOwnership{Type: "robot", Owner: agent}, 0, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *ServiceConnection, owner CredentialOwnership) error {
		rows, err := r.Connections()
		if err != nil {
			return err
		}
		items := []map[string]any{}
		for _, v := range rows {
			allowed, err := userConnectionAllowed(r, &v, owner.Owner)
			if err != nil {
				return err
			}
			if allowed {
				items = append(items, connectionSummary(&v))
			}
		}
		out.Data = map[string]any{"items": items}
		return nil
	})
	return out, a, err
}

func (s *Service) List(ctx context.Context, raw string, admin bool) (Result, *identity.Auth, error) {
	var out Result
	owner := CredentialOwnership{Type: "directory"}
	if admin {
		owner = routeScope(ctx)
	}
	a, err := s.access(ctx, raw, owner, 0, false, func(_ identity.Tx, r Repository, a *identity.Auth, _ *ServiceConnection, _ CredentialOwnership) error {
		rows, err := r.Connections()
		if err != nil {
			return err
		}
		items := []map[string]any{}
		for _, v := range rows {
			if s.Type != "" && v.Type != s.serviceType() {
				continue
			}
			var allowed bool
			scope := routeScope(ctx)
			if admin {
				allowed = managedConnection(&v, scope)
			} else if scope.Type != "platform" {
				allowed, err = r.ConnectionGranted(v.ID, scope, false)
			} else {
				allowed, err = userConnectionAllowed(r, &v, a.User.ID)
			}
			if err != nil {
				return err
			}
			if !allowed {
				continue
			}
			items = append(items, connectionSummary(&v))
		}
		out.Data = map[string]any{"items": items}
		return nil
	})
	return out, a, err
}
func (s *Service) Create(ctx context.Context, raw string, w ConnectionCreate, meta identity.Metadata) (Result, *identity.Auth, error) {
	out := Result{}
	a, err := s.access(ctx, raw, routeScope(ctx), 0, true, func(tx identity.Tx, r Repository, a *identity.Auth, _ *ServiceConnection, owner CredentialOwnership) error {
		if owner.Type != "platform" && owner.Type != "project" {
			return forbidden()
		}
		if w.Config == nil {
			return httpx.Invalid("config", "required")
		}
		code, err := codeValue(w.Code)
		if err != nil {
			return err
		}
		v := &ServiceConnection{Type: s.serviceType(), ConfigSchemaVersion: 1, Code: code, Enabled: true, Version: 1, ConfigVersion: 1, CredentialsVersion: 1, GrantsVersion: 1, Ownership: owner.Type, Creator: a.User.ID}
		if owner.Type == "project" {
			v.ProjectID = &owner.Owner
		}
		v.Name = strings.TrimSpace(w.Name)
		if err = applyCommon(CommonWrite{Description: w.Description, Enabled: w.Enabled}, &v.Name, &v.Description, &v.Enabled); err != nil {
			return err
		}
		v.Config = HTTPConfig{BaseURL: connectionURL(v.Type, w.Config.BaseURL), CA: w.Config.CA}
		if isDatabase(v.Type) {
			v.Config.TLSMode = "disable"
		}
		if err := applyDatabaseFields(v.Type, &v.Config, w.Config.Host, w.Config.Port, w.Config.Database); err != nil {
			return err
		}
		if w.Config.TLSMode.Set {
			if !isDatabase(v.Type) || w.Config.TLSMode.Null {
				return httpx.Invalid("tls_mode", "invalid_format")
			}
			v.Config.TLSMode = w.Config.TLSMode.Value
		}
		if v.Type == "openobserve" {
			v.Config.DefaultOrganization = "default"
		}
		if w.Config.DefaultOrganization.Set {
			if v.Type != "openobserve" || w.Config.DefaultOrganization.Null {
				return httpx.Invalid("default_organization", "invalid_format")
			}
			v.Config.DefaultOrganization = w.Config.DefaultOrganization.Value
		}
		if err = validateTypedConfig(v.Type, &v.Config); err != nil {
			return err
		}
		v.ConfigJSON, err = json.Marshal(v.Config)
		if err != nil {
			return err
		}
		if err = r.InsertConnection(v); err != nil {
			return err
		}
		out = s.connectionResult(v)
		out.Location = fmt.Sprintf("/api/v1%s/%d", connectionPath(owner, v.Type), v.ID)
		return audit(tx, a, "service_connection", v.ID, v.Name, "created", map[string]any{}, meta)
	})
	return out, a, err
}
func (s *Service) Admin(ctx context.Context, raw string, id uint64, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	out := Result{}
	a, err := s.access(ctx, raw, routeScope(ctx), id, op != "get" && op != "diagnostics", func(tx identity.Tx, r Repository, a *identity.Auth, v *ServiceConnection, _ CredentialOwnership) error {
		if !managedConnection(v, routeScope(ctx)) {
			return forbidden()
		}
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
			oldConfig, _ := json.Marshal(v.Config)
			oldEnabled := v.Enabled
			if err := applyCommon(w.CommonWrite, &v.Name, &v.Description, &v.Enabled); err != nil {
				return err
			}
			if w.Config.Set {
				if w.Config.Null || (!w.Config.Value.Host.Set && !w.Config.Value.Port.Set && !w.Config.Value.Database.Set && !w.Config.Value.TLSMode.Set && !w.Config.Value.BaseURL.Set && !w.Config.Value.CA.Set && !w.Config.Value.DefaultOrganization.Set) {
					return httpx.Invalid("config", "invalid_format")
				}
				cfg := w.Config.Value
				if err := applyDatabaseFields(v.Type, &v.Config, cfg.Host, cfg.Port, cfg.Database); err != nil {
					return err
				}
				if cfg.TLSMode.Set {
					if !isDatabase(v.Type) || cfg.TLSMode.Null {
						return httpx.Invalid("tls_mode", "invalid_format")
					}
					v.Config.TLSMode = cfg.TLSMode.Value
				}
				if cfg.BaseURL.Null {
					return httpx.Invalid("config.base_url", "required")
				}
				if cfg.BaseURL.Set {
					if connectionURL(v.Type, cfg.BaseURL.Value) != v.Config.BaseURL {
						if pr, ok := r.(ProjectRepoStore); ok {
							n, e := pr.ConnectionRepoCount(v.ID)
							if e != nil {
								return e
							}
							if n > 0 {
								return httpx.E(409, "CONNECTION_TARGET_LOCKED", "请先解除项目仓库关联，再修改连接地址")
							}
						}
					}
					v.Config.BaseURL = connectionURL(v.Type, cfg.BaseURL.Value)
					if isDatabase(v.Type) && !cfg.Host.Set && !cfg.Port.Set && !cfg.Database.Set {
						v.Config.Host = ""
						v.Config.Port = 0
						v.Config.Database = ""
					}
				}
				if cfg.CA.Set {
					v.Config.CA = nil
					if !cfg.CA.Null {
						v.Config.CA = &cfg.CA.Value
					}
				}
				if cfg.DefaultOrganization.Set {
					if v.Type != "openobserve" || cfg.DefaultOrganization.Null {
						return httpx.Invalid("default_organization", "invalid_format")
					}
					v.Config.DefaultOrganization = cfg.DefaultOrganization.Value
				}
				if err := validateTypedConfig(v.Type, &v.Config); err != nil {
					return err
				}
			}
			after, _ := json.Marshal(v)
			if bytes.Equal(before, after) {
				return nil
			}
			newConfig, _ := json.Marshal(v.Config)
			configChanged := !bytes.Equal(oldConfig, newConfig)
			v.Version++
			if configChanged {
				v.ConfigVersion++
				encoded, err := json.Marshal(v.Config)
				if err != nil {
					return err
				}
				v.ConfigJSON = encoded
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
			if pr, ok := r.(ProjectRepoStore); ok {
				n, e := pr.ConnectionRepoCount(id)
				if e != nil {
					return e
				}
				if n > 0 {
					return httpx.E(409, "CONNECTION_REFERENCED", "请先解除项目仓库关联")
				}
			}
			refs, err := r.ConnectionJobReferences(id, 0)
			if err != nil {
				return err
			}
			if refs > 0 {
				return httpx.E(409, "CONNECTION_REFERENCED", "请先撤销作业资源授权")
			}
			grants, err := r.ConnectionGrants(id)
			if err != nil {
				return err
			}
			for _, grant := range grants {
				if grant.Enabled {
					return httpx.E(409, "CONNECTION_REFERENCED", "请先撤销连接授权")
				}
			}
			if err = r.DeleteConnection(id); err != nil {
				return err
			}
			out = Result{}
			return audit(tx, a, "service_connection", v.ID, v.Name, "deleted", map[string]any{}, meta)

		}
		return fail()
	})
	return out, a, err
}
func sameID(a, b *uint64) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func purpose(kind string, connection, id uint64, method string) string {
	return fmt.Sprintf("service-integrations/gitlab/%s/%d/%d/%s/v1", kind, connection, id, method)
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

func connectionURL(kind, raw string) string {
	if isDatabase(kind) {
		return raw
	}
	return strings.TrimRight(raw, "/")
}
