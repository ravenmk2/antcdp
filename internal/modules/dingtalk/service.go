package dingtalk

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func repository(tx identity.Tx) (Repository, error) {
	v, ok := tx.(interface{ DingTalk() Repository })
	if !ok {
		return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "钉钉服务暂不可用")
	}
	return v.DingTalk(), nil
}
func (s *Service) access(ctx context.Context, raw string, fn func(identity.Tx, Repository, *identity.Auth) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		if a.User.Role != "admin" {
			return httpx.E(403, "FORBIDDEN", "需要管理员权限")
		}
		r, err := repository(tx)
		if err != nil {
			return err
		}
		return fn(tx, r, a)
	})
}
func (s *Service) tag(p *Robot) string {
	return `"` + s.ETag(fmt.Sprintf("dingtalk/robot/%d/%d", p.ID, p.RowVersion)) + `"`
}
func checkTag(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前资料")
	}
	if !regexp.MustCompile(`^"[a-f0-9]{64}"$`).MatchString(got) {
		return httpx.Invalid("If-Match", "invalid_format")
	}
	if got != want {
		return httpx.E(412, "VERSION_CONFLICT", "资料已变化，请重新加载")
	}
	return nil
}
func missing() error { return httpx.E(404, "NOT_FOUND", "机器人不存在") }
func busy() error    { return httpx.E(409, "TEST_IN_PROGRESS", "机器人正在发送测试") }
func validateAuth(a Authentication) error {
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{16,256}$`).MatchString(a.Token) || !regexp.MustCompile(`^SEC[A-Za-z0-9]{16,256}$`).MatchString(a.Secret) {
		return httpx.Invalid("authentication", "invalid_token_or_secret")
	}
	return nil
}
func audit(tx identity.Tx, a *identity.Auth, p Robot, action string, meta identity.Metadata) error {
	target := fmt.Sprint(p.ID)
	return tx.Audit(identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: "dingtalk.robot." + action, TargetType: "dingtalk_robot", TargetID: &target, TargetLabel: p.Name, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: json.RawMessage(`{}`)})
}
func (s *Service) present(p *Robot) {
	p.Version = strings.Trim(s.tag(p), `"`)
	if p.Latest != nil {
		p.Latest.Outdated = p.Latest.Version != p.RowVersion
	}
}
func (s *Service) List(ctx context.Context, raw string, f Filter) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth) error {
		rows, count, err := r.List(f)
		if err != nil {
			return err
		}
		for i := range rows {
			s.present(&rows[i])
		}
		out.Data = Page{rows, count, f.Page, f.PageSize}
		return nil
	})
	return out, a, e
}
func (s *Service) Admin(ctx context.Context, raw string, id uint64, op, tag string, w Write, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth) error {
		var p *Robot
		var err error
		if op == "create" {
			p = &Robot{Enabled: true, RowVersion: 1}
		} else {
			p, err = r.Robot(id)
			if err != nil {
				return err
			}
			if p == nil {
				return missing()
			}
		}
		if op == "get" || op == "diagnostics" {
			s.present(p)
			out = Result{p, s.tag(p)}
			if op == "diagnostics" {
				out.Data = p.Latest
			}
			return nil
		}
		if op != "create" {
			if err = checkTag(tag, s.tag(p)); err != nil {
				return err
			}
		}
		if op == "delete" {
			if p.Latest != nil && p.Latest.Status == "in_progress" {
				return busy()
			}
			if err = r.Delete(id); err != nil {
				return err
			}
			return audit(tx, a, *p, "deleted", meta)
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
			if !regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`).MatchString(p.Code) {
				return httpx.Invalid("code", "invalid_format")
			}
			if p.Name == "" || utf8.RuneCountInString(p.Name) > 100 || utf8.RuneCountInString(p.Description) > 1000 {
				return httpx.Invalid("name", "invalid_length")
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
			p.HasSecret = true
		}
		if op != "create" && w.Authentication == nil && reflect.DeepEqual(before, *p) {
			s.present(p)
			out = Result{p, s.tag(p)}
			return nil
		}
		if op != "create" {
			p.RowVersion++
		}
		if err = r.Save(p, op == "create"); err != nil {
			return err
		}
		if w.Authentication != nil {
			b, _ := json.Marshal(w.Authentication)
			sealed, err := s.Cipher(fmt.Sprintf("dingtalk/robot/%d/v1", p.ID), string(b), true)
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
		if err = audit(tx, a, *p, action, meta); err != nil {
			return err
		}
		s.present(p)
		out = Result{p, s.tag(p)}
		return nil
	})
	return out, a, e
}
func (s *Service) allow(actor, id uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recent == nil {
		s.recent = map[string][]time.Time{}
	}
	now := time.Now()
	for key, list := range s.recent {
		next := list[:0]
		for _, v := range list {
			if now.Sub(v) < time.Minute {
				next = append(next, v)
			}
		}
		if len(next) == 0 {
			delete(s.recent, key)
		} else {
			s.recent[key] = next
		}
	}
	keys := []string{fmt.Sprint("actor/", actor), fmt.Sprint("robot/", id)}
	for _, key := range keys {
		if len(s.recent[key]) >= 5 {
			return false
		}
	}
	for _, key := range keys {
		s.recent[key] = append(s.recent[key], now)
	}
	return true
}

var outbound = make(chan struct{}, 4)

func (s *Service) Test(ctx context.Context, raw string, id uint64, tag string, w TestInput, meta identity.Metadata) (Result, *identity.Auth, error) {
	if w.Format != "text" && w.Format != "markdown" || strings.TrimSpace(w.Body) == "" || len(w.Body) > 16<<10 || utf8.RuneCountInString(w.Title) > 100 || w.Format == "markdown" && strings.TrimSpace(w.Title) == "" {
		return Result{}, nil, httpx.Invalid("body", "invalid_message")
	}
	select {
	case outbound <- struct{}{}:
		defer func() { <-outbound }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "机器人发送繁忙")
	}
	var p Robot
	var credentials Authentication
	d := Diagnostic{TestID: cryptox.ID(), Status: "in_progress", Stage: "prepare", Reason: "pending", StartedAt: time.Now().UTC().Truncate(time.Millisecond)}
	a, err := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth) error {
		v, e := r.Robot(id)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag(v)); e != nil {
			return e
		}
		if !v.Enabled {
			return httpx.E(409, "RESOURCE_DISABLED", "机器人已停用")
		}
		if v.Latest != nil && v.Latest.Status == "in_progress" {
			return busy()
		}
		if !s.allow(a.User.ID, id) {
			return httpx.E(429, "RATE_LIMITED", "每分钟最多发送五次测试")
		}
		sealed, e := r.Secret(id)
		if e != nil {
			return e
		}
		plain, e := s.Cipher(fmt.Sprintf("dingtalk/robot/%d/v1", id), sealed, false)
		if e != nil {
			return e
		}
		if e = json.Unmarshal([]byte(plain), &credentials); e != nil {
			return e
		}
		if e = validateAuth(credentials); e != nil {
			return e
		}
		p = *v
		d.Version = v.RowVersion
		d.ActorID = a.User.ID
		if e = r.SaveDiagnostic(id, &d, true); e != nil {
			return e
		}
		return audit(tx, a, p, "test_started", meta)
	})
	if err != nil {
		return Result{}, a, err
	}
	work, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	send := s.Send
	if send == nil {
		send = sendRobot
	}
	result := send(work, credentials, w)
	d.Status = result.Status
	d.Stage = result.Stage
	d.Reason = result.Reason
	now := time.Now().UTC().Truncate(time.Millisecond)
	d.FinishedAt = &now
	finish, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	store, e := s.Store()
	if e == nil {
		e = store.Transact(finish, func(tx identity.Tx) error {
			r, e := repository(tx)
			if e != nil {
				return e
			}
			if e = r.SaveDiagnostic(id, &d, false); e != nil {
				return e
			}
			return audit(tx, a, p, "test_completed", meta)
		})
	}
	if e != nil {
		return Result{}, a, httpx.E(503, "SEND_RESULT_UNAVAILABLE", "发送已执行但结果暂无法保存，请查询诊断")
	}
	return s.Admin(finish, raw, id, "diagnostics", "", Write{}, meta)
}
func Clean(ctx context.Context, store identity.Store, now time.Time) error {
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, err := repository(tx)
		if err != nil {
			return err
		}
		return r.Recover(now)
	})
}
