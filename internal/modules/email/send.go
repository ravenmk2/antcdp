package email

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var sendSlots = make(chan struct{}, 4)

func (s *Service) Test(ctx context.Context, raw string, id uint64, tag string, w TestInput, meta identity.Metadata) (Result, *identity.Auth, error) {
	select {
	case sendSlots <- struct{}{}:
		defer func() { <-sendSlots }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "邮件发送繁忙，请稍后重试")
	}
	if !validAddress(w.Recipient) {
		return Result{}, nil, httpx.Invalid("recipient", "invalid_email")
	}
	if (w.Content == nil) == (w.Template == nil) {
		return Result{}, nil, httpx.Invalid("content", "choose_content_or_template")
	}
	total := 0
	if len(w.Attachments) > 5 {
		return Result{}, nil, httpx.Invalid("attachments", "too_many")
	}
	for _, f := range w.Attachments {
		total += len(f.Data)
		if f.Name == "" || len(f.Name) > 255 || strings.ContainsAny(f.Name, "\r\n/\\\x00") || len(f.Data) > 5<<20 {
			return Result{}, nil, httpx.Invalid("attachments", "invalid_file")
		}
	}
	if total > 10<<20 {
		return Result{}, nil, httpx.Invalid("attachments", "too_large")
	}
	var profile Profile
	var credentials Authentication
	var content Content
	var sender string
	log := SendLog{TestID: cryptox.ID(), ProfileID: id, Status: "in_progress", Stage: "prepare", Reason: "pending", StartedAt: time.Now().UTC().Truncate(time.Millisecond), RecipientMask: mask(w.Recipient), AttachmentCount: len(w.Attachments), AttachmentBytes: total}
	a, err := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth) error {
		p, e := r.Profile(id)
		if e != nil {
			return e
		}
		if p == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag("profile", id, p.RowVersion)); e != nil {
			return e
		}
		if !p.Enabled {
			return httpx.E(409, "RESOURCE_DISABLED", "邮件配置已停用")
		}
		if e = validateConfig(p.Config); e != nil {
			return e
		}
		for _, n := range p.SenderNames {
			if n.ID == w.SenderNameID || (w.SenderNameID == "" && n.Default) {
				sender = n.Name
				log.SenderNameID = n.ID
			}
		}
		if sender == "" {
			return httpx.Invalid("sender_name_id", "invalid_reference")
		}
		if w.Template != nil {
			t, e := r.Template(w.Template.ID)
			if e != nil {
				return e
			}
			if t == nil {
				return missing()
			}
			if !t.Enabled {
				return httpx.E(409, "RESOURCE_DISABLED", "模板已停用")
			}
			if e = checkTag(`"`+w.Template.Version+`"`, s.tag("template", t.ID, t.RowVersion)); e != nil {
				return e
			}
			content, e = Render(*t, w.Template.Parameters)
			if e != nil {
				return e
			}
			log.TemplateID = t.ID
			log.TemplateName = t.Name
			log.TemplateVersion = t.RowVersion
		} else {
			content = *w.Content
		}
		if content.BodyFormat != "text" && content.BodyFormat != "html" {
			return httpx.Invalid("content.body_format", "unsupported")
		}
		if strings.TrimSpace(content.Subject) == "" || strings.ContainsAny(content.Subject, "\r\n") || utf8.RuneCountInString(content.Subject) > 200 || len(content.Body) > 512<<10 || len(content.TextBody) > 512<<10 {
			return httpx.Invalid("content", "invalid_length_or_header")
		}
		inProgress, e := r.Busy(id, log.TemplateID)
		if e != nil {
			return e
		}
		if inProgress {
			return busy()
		}
		since := time.Now().UTC().Add(-time.Minute)
		_, n, e := r.Logs(Filter{Page: 1, PageSize: 1, ProfileID: id, From: &since})
		if e != nil {
			return e
		}
		_, actorCount, e := r.Logs(Filter{Page: 1, PageSize: 1, ActorID: a.User.ID, From: &since})
		if e != nil {
			return e
		}
		if n >= 5 || actorCount >= 5 {
			return httpx.E(429, "RATE_LIMITED", "每分钟最多发送五次测试")
		}
		sealed, e := r.Secret(id)
		if e != nil {
			return e
		}
		plain, e := s.Cipher(fmt.Sprintf("email/profile/%d/v1", id), sealed, false)
		if e != nil {
			return e
		}
		if e = json.Unmarshal([]byte(plain), &credentials); e != nil {
			return e
		}
		if e = validateAuth(credentials); e != nil {
			return e
		}
		profile = *p
		log.ProfileName = p.Name
		log.ProfileVersion = p.RowVersion
		log.ActorID = a.User.ID
		log.ActorName = a.User.DisplayName
		if e = r.InsertLog(&log); e != nil {
			return e
		}
		return audit(tx, a, "profile", id, p.Name, "test_started", meta)
	})
	if err != nil {
		return Result{}, a, err
	}
	work, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	send := s.Send
	if send == nil {
		send = sendSMTP
	}
	result := send(work, profile, credentials, sender, w.Recipient, content, w.Attachments)
	log.Status = result.Status
	log.Stage = result.Stage
	log.Reason = result.Reason
	log.ResponseCode = result.ResponseCode
	log.MessageID = result.MessageID
	now := time.Now().UTC().Truncate(time.Millisecond)
	log.FinishedAt = &now
	finish, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	store, e := s.Store()
	if e == nil {
		e = store.Transact(finish, func(tx identity.Tx) error {
			r, x := repository(tx)
			if x != nil {
				return x
			}
			if x = r.FinishLog(&log); x != nil {
				return x
			}
			return audit(tx, a, "profile", id, profile.Name, "test_completed", meta)
		})
	}
	if e != nil {
		return Result{}, a, httpx.E(503, "SEND_RESULT_UNAVAILABLE", "发送已执行但结果暂无法保存，请查询记录后再决定是否发送")
	}
	return s.Log(finish, raw, log.ID)
}
func mask(value string) string {
	parts := strings.Split(value, "@")
	if len(parts) != 2 {
		return "***"
	}
	r := []rune(parts[0])
	if len(r) > 2 {
		r = r[:2]
	}
	return string(r) + "***@" + parts[1]
}
