package email

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/mail"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var codePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var tagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)

func repository(tx identity.Tx) (Repository, error) {
	v, ok := tx.(interface{ Email() Repository })
	if !ok {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "邮件服务暂不可用")
	}
	return v.Email(), nil
}
func (s *Service) access(ctx context.Context, raw string, fn func(identity.Tx, Repository, *identity.Auth) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		if a.User.Role != "admin" {
			return httpx.E(403, "FORBIDDEN", "需要管理员权限")
		}
		r, e := repository(tx)
		if e != nil {
			return e
		}
		return fn(tx, r, a)
	})
}
func (s *Service) tag(kind string, id, version uint64) string {
	return `"` + s.ETag(fmt.Sprintf("email/%s/%d/%d", kind, id, version)) + `"`
}
func checkTag(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前资料")
	}
	if !tagPattern.MatchString(got) {
		return httpx.Invalid("If-Match", "invalid_format")
	}
	if got != want {
		return httpx.E(412, "VERSION_CONFLICT", "资料已变化，请重新加载")
	}
	return nil
}
func missing() error { return httpx.E(404, "NOT_FOUND", "邮件资源不存在") }
func busy() error {
	return httpx.E(409, "TEST_IN_PROGRESS", "资源正在发送测试，请稍后操作")
}
func validateNames(code, name, description string) error {
	if !codePattern.MatchString(code) {
		return httpx.Invalid("code", "invalid_format")
	}
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if utf8.RuneCountInString(description) > 1000 {
		return httpx.Invalid("description", "too_long")
	}
	return nil
}
func validateConfig(c Config) error {
	if c.Host == "" || len(c.Host) > 253 || strings.ContainsAny(c.Host, " /\\\r\n\t?#@") || c.Port < 1 || c.Port > 65535 {
		return httpx.Invalid("config.host", "invalid_address")
	}
	if net.ParseIP(c.Host) == nil && strings.Contains(c.Host, ":") {
		return httpx.Invalid("config.host", "invalid_address")
	}
	if c.TLSMode != "implicit_tls" && c.TLSMode != "starttls" {
		return httpx.Invalid("config.tls_mode", "unsupported")
	}
	if !validAddress(c.FromAddress) {
		return httpx.Invalid("config.from_address", "invalid_email")
	}
	if c.CustomCA != "" {
		if len(c.CustomCA) > 64<<10 || !x509.NewCertPool().AppendCertsFromPEM([]byte(c.CustomCA)) {
			return httpx.Invalid("config.custom_ca_pem", "invalid_certificate")
		}
	}
	return nil
}
func validAddress(value string) bool {
	a, err := mail.ParseAddress(value)
	return err == nil && a.Address == value && a.Name == "" && len(value) <= 254 && !strings.ContainsAny(value, "\r\n")
}
func validateAuth(a Authentication) error {
	if a.Username == "" || len(a.Username) > 320 || strings.ContainsAny(a.Username, "\r\n\x00") || a.Password == "" || len(a.Password) > 8192 || strings.ContainsAny(a.Password, "\r\n\x00") {
		return httpx.Invalid("authentication", "invalid_credentials")
	}
	return nil
}
func senderNames(names []SenderName, existing []SenderName) error {
	if len(names) < 1 || len(names) > 20 {
		return httpx.Invalid("sender_names", "invalid_count")
	}
	known := map[string]bool{}
	for _, n := range existing {
		known[n.ID] = true
	}
	seen := map[string]bool{}
	ids := map[string]bool{}
	defaults := 0
	for i := range names {
		n := &names[i]
		n.Name = strings.TrimSpace(n.Name)
		if n.Name == "" || utf8.RuneCountInString(n.Name) > 100 || strings.ContainsAny(n.Name, "\r\n") || seen[n.Name] {
			return httpx.Invalid("sender_names", "invalid_or_duplicate_name")
		}
		seen[n.Name] = true
		if n.ID == "" {
			n.ID = cryptox.ID()
		} else if !known[n.ID] {
			return httpx.Invalid("sender_names", "invalid_id")
		}
		if ids[n.ID] {
			return httpx.Invalid("sender_names", "duplicate_id")
		}
		ids[n.ID] = true
		if n.Default {
			defaults++
		}
	}
	if defaults != 1 {
		return httpx.Invalid("sender_names", "one_default_required")
	}
	return nil
}
func audit(tx identity.Tx, a *identity.Auth, kind string, id uint64, name, action string, meta identity.Metadata) error {
	target := fmt.Sprint(id)
	return tx.Audit(identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: "email." + kind + "." + action, TargetType: "email_" + kind, TargetID: &target, TargetLabel: name, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: json.RawMessage(`{}`)})
}
func (s *Service) presentProfile(p *Profile) {
	p.Version = strings.Trim(s.tag("profile", p.ID, p.RowVersion), `"`)
}
func (s *Service) presentTemplate(t *Template) {
	t.Version = strings.Trim(s.tag("template", t.ID, t.RowVersion), `"`)
}
func (s *Service) List(ctx context.Context, raw, kind string, f Filter) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth) error {
		switch kind {
		case "profiles":
			rows, total, err := r.Profiles(f)
			if err != nil {
				return err
			}
			for i := range rows {
				s.presentProfile(&rows[i])
			}
			out.Data = Page{rows, total, f.Page, f.PageSize}
		case "templates":
			rows, total, err := r.Templates(f)
			if err != nil {
				return err
			}
			for i := range rows {
				s.presentTemplate(&rows[i])
			}
			out.Data = Page{rows, total, f.Page, f.PageSize}
		case "send-logs":
			rows, total, err := r.Logs(f)
			if err != nil {
				return err
			}
			out.Data = Page{rows, total, f.Page, f.PageSize}
		case "template-engines":
			out.Data = EngineCatalog()
		default:
			return missing()
		}
		return nil
	})
	return out, a, e
}
func (s *Service) Profile(ctx context.Context, raw string, id uint64, op, tag string, w ProfileWrite, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth) error {
		var p *Profile
		var err error
		if op == "create" {
			p = &Profile{Enabled: true, RowVersion: 1, SenderNames: []SenderName{}}
		} else {
			p, err = r.Profile(id)
			if err != nil {
				return err
			}
			if p == nil {
				return missing()
			}
		}
		if op == "get" || op == "diagnostics" {
			rows, _, err := r.Logs(Filter{Page: 1, PageSize: 1, ProfileID: id})
			if err != nil {
				return err
			}
			if len(rows) > 0 {
				p.Latest = &rows[0]
			}
			s.presentProfile(p)
			out = Result{p, s.tag("profile", p.ID, p.RowVersion)}
			if op == "diagnostics" {
				out.Data = p.Latest
			}
			return nil
		}
		if op != "create" {
			if err = checkTag(tag, s.tag("profile", p.ID, p.RowVersion)); err != nil {
				return err
			}
		}
		if op == "delete" {
			b, err := r.Busy(id, 0)
			if err != nil {
				return err
			}
			if b {
				return busy()
			}
			if err = r.DeleteProfile(id); err != nil {
				return err
			}
			return audit(tx, a, "profile", id, p.Name, "deleted", meta)
		}
		before := *p
		if op == "authentication" {
			if w.Authentication == nil {
				return httpx.Invalid("authentication", "required")
			}
		} else {
			if op == "create" {
				p.Code = w.Code
				if p.Code == "" {
					p.Code = cryptox.ID()
				}
			} else if w.Code != "" && w.Code != p.Code {
				return httpx.Invalid("code", "immutable")
			}
			if w.Name != nil {
				p.Name = strings.TrimSpace(*w.Name)
			}
			if w.Description != nil {
				p.Description = *w.Description
			}
			if w.Enabled != nil {
				p.Enabled = *w.Enabled
			}
			if w.Config != nil {
				p.Config = *w.Config
			}
			if w.SenderNames != nil {
				names := cloneJSON(*w.SenderNames)
				if err = senderNames(names, p.SenderNames); err != nil {
					return err
				}
				p.SenderNames = names
			}
			if err = validateNames(p.Code, p.Name, p.Description); err != nil {
				return err
			}
			if err = validateConfig(p.Config); err != nil {
				return err
			}
			if len(p.SenderNames) == 0 {
				return httpx.Invalid("sender_names", "required")
			}
			if op != "create" && w.Authentication != nil {
				return httpx.Invalid("authentication", "use_authentication_endpoint")
			}
		}
		if op == "create" && w.Authentication == nil {
			return httpx.Invalid("authentication", "required")
		}
		if w.Authentication != nil {
			if err = validateAuth(*w.Authentication); err != nil {
				return err
			}
			p.Username = w.Authentication.Username
			p.HasSecret = true
		}
		if op != "create" && w.Authentication == nil && reflect.DeepEqual(before, *p) {
			s.presentProfile(p)
			out = Result{p, s.tag("profile", p.ID, p.RowVersion)}
			return nil
		}
		if op != "create" {
			p.RowVersion++
		}
		if err = r.SaveProfile(p, op == "create"); err != nil {
			return err
		}
		if w.Authentication != nil {
			b, _ := json.Marshal(w.Authentication)
			sealed, err := s.Cipher(fmt.Sprintf("email/profile/%d/v1", p.ID), string(b), true)
			if err != nil {
				return err
			}
			if err = r.SetSecret(p.ID, sealed); err != nil {
				return err
			}
		}
		action := "updated"
		if op == "create" {
			action = "created"
		}
		if op == "authentication" {
			action = "authentication_replaced"
		}
		if err = audit(tx, a, "profile", p.ID, p.Name, action, meta); err != nil {
			return err
		}
		s.presentProfile(p)
		out = Result{p, s.tag("profile", p.ID, p.RowVersion)}
		return nil
	})
	return out, a, e
}

func (s *Service) Template(ctx context.Context, raw string, id uint64, op, tag string, w Template, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth) error {
		var t *Template
		var err error
		if op == "create" {
			t = &Template{RowVersion: 1}
		} else {
			t, err = r.Template(id)
			if err != nil {
				return err
			}
			if t == nil {
				return missing()
			}
		}
		if op == "get" || op == "diagnostics" {
			rows, _, err := r.Logs(Filter{Page: 1, PageSize: 1, TemplateID: id})
			if err != nil {
				return err
			}
			if len(rows) > 0 {
				t.Latest = &rows[0]
			}
			s.presentTemplate(t)
			out = Result{t, s.tag("template", t.ID, t.RowVersion)}
			if op == "diagnostics" {
				out.Data = t.Latest
			}
			return nil
		}
		if op != "create" {
			if err = checkTag(tag, s.tag("template", t.ID, t.RowVersion)); err != nil {
				return err
			}
		}
		if op == "delete" {
			b, err := r.Busy(0, id)
			if err != nil {
				return err
			}
			if b {
				return busy()
			}
			if err = r.DeleteTemplate(id); err != nil {
				return err
			}
			return audit(tx, a, "template", id, t.Name, "deleted", meta)
		}
		if op == "create" && w.Code == "" {
			w.Code = cryptox.ID()
		}
		if op != "create" && w.Code != t.Code {
			return httpx.Invalid("code", "immutable")
		}
		w.Name = strings.TrimSpace(w.Name)
		if err = validateNames(w.Code, w.Name, w.Description); err != nil {
			return err
		}
		if _, err = Render(w, w.Sample); err != nil {
			return err
		}
		w.ID = t.ID
		w.RowVersion = t.RowVersion
		w.CreatedAt = t.CreatedAt
		w.UpdatedAt = t.UpdatedAt
		w.Version = ""
		w.Latest = nil
		if reflect.DeepEqual(*t, w) {
			s.presentTemplate(t)
			out = Result{t, s.tag("template", t.ID, t.RowVersion)}
			return nil
		}
		if op != "create" {
			w.RowVersion++
		}
		if err = r.SaveTemplate(&w, op == "create"); err != nil {
			return err
		}
		action := "updated"
		if op == "create" {
			action = "created"
		}
		if err = audit(tx, a, "template", w.ID, w.Name, action, meta); err != nil {
			return err
		}
		s.presentTemplate(&w)
		out = Result{w, s.tag("template", w.ID, w.RowVersion)}
		return nil
	})
	return out, a, e
}

var previewSlots = make(chan struct{}, 4)

func (s *Service) Preview(ctx context.Context, raw string, w PreviewInput) (Result, *identity.Auth, error) {
	select {
	case previewSlots <- struct{}{}:
		defer func() { <-previewSlots }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "预览繁忙，请稍后重试")
	}

	var t Template
	var params map[string]any
	a, e := s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth) error {
		if (w.Draft == nil) == (w.Template == nil) {
			return httpx.Invalid("body", "choose_draft_or_template")
		}
		if w.Draft != nil {
			t = *w.Draft
			params = t.Sample
			return nil
		}
		v, err := r.Template(w.Template.ID)
		if err != nil {
			return err
		}
		if v == nil {
			return missing()
		}
		if err = checkTag(`"`+w.Template.Version+`"`, s.tag("template", v.ID, v.RowVersion)); err != nil {
			return err
		}
		t = *v
		params = w.Template.Parameters
		return nil
	})
	if e != nil {
		return Result{}, a, e
	}
	content, e := Render(t, params)
	return Result{Data: content}, a, e
}
func (s *Service) Log(ctx context.Context, raw string, id uint64) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth) error {
		l, err := r.Log(id)
		if err != nil {
			return err
		}
		if l == nil {
			return missing()
		}
		out.Data = l
		return nil
	})
	return out, a, e
}

func Clean(ctx context.Context, store identity.Store, now time.Time) error {
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, e := repository(tx)
		if e != nil {
			return e
		}
		return r.Prune(now)
	})
}
