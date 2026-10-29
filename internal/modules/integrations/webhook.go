package integrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type WebhookWrite struct {
	Enabled Field[bool] `json:"enabled"`
}
type VerificationWrite struct {
	Method string       `json:"verification_method"`
	Secret *TokenSecret `json:"secret"`
}

func webhookFor(r Repository, id uint64) (*WebhookSettings, error) {
	w, err := r.WebhookSettings(id)
	if err != nil {
		return nil, err
	}
	if w == nil || w.ConnectionID != id || !w.ValidRecord() {
		return nil, integrity()
	}
	return w, nil
}

func (s *Service) Webhook(ctx context.Context, raw string, id uint64, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	out := Result{}
	write := op != "get" && op != "receiver" && op != "diagnostics"
	a, err := s.access(ctx, raw, CredentialOwnership{Type: "system"}, id, write, func(tx identity.Tx, r Repository, a *identity.Auth, v *ServiceConnection, _ CredentialOwnership) error {
		w, err := webhookFor(r, id)
		if err != nil {
			return err
		}
		out = s.webhookResult(w)
		if write {
			if err := check(tag, s.webhookTag(w)); err != nil {
				return err
			}
		}
		action, token := "", ""
		switch op {
		case "get":
			return nil
		case "receiver":
			out = Result{Data: map[string]string{"receive_url": fmt.Sprintf("%s/api/v1/webhooks/gitlab/%d", strings.TrimRight(s.PublicURL, "/"), id)}}
			return nil
		case "diagnostics":
			raw, err := r.Diagnostics("webhook", id)
			if err != nil {
				return err
			}
			d, err := diagnosticView(raw, v.Version, 0, 0, 0, w.Version)
			out = Result{Data: map[string]any{"latest": d}}
			return err
		case "update":
			patch := input.(WebhookWrite)
			if !patch.Enabled.Set {
				return httpx.Invalid("body", "empty_patch")
			}
			if patch.Enabled.Null {
				return httpx.Invalid("enabled", "required")
			}
			if patch.Enabled.Value && !w.HasSecret {
				return httpx.E(422, "SECRET_REQUIRED", "启用前请先配置验证秘密")
			}
			if patch.Enabled.Value == w.Enabled {
				return nil
			}
			w.Enabled = patch.Enabled.Value
			action = "webhook_updated"
		case "verification", "generate":
			value := VerificationWrite{}
			if op == "generate" {
				token = cryptox.Token()
				value = VerificationWrite{Method: "secret_token", Secret: &TokenSecret{Token: token}}
			} else {
				value = input.(VerificationWrite)
			}
			if value.Secret == nil {
				return httpx.Invalid("secret", "required")
			}
			if err := ValidateWebhookSecret(value.Method, value.Secret.Token); err != nil {
				return err
			}
			sealed, err := s.Cipher(purpose("webhook_settings", id, id, value.Method), value.Secret.Token, true)
			if err != nil {
				return err
			}
			if err = r.SetSecret("webhook", id, sealed); err != nil {
				return err
			}
			w.Method, w.HasSecret = value.Method, true
			action = "webhook_verification_replaced"
		default:
			return fail()
		}
		w.Version++
		if err := r.SaveWebhookSettings(w); err != nil {
			return err
		}
		out = s.webhookResult(w)
		if op == "generate" {
			out.Data = map[string]any{"webhook": w, "secret": map[string]string{"token": token}}
		}
		return audit(tx, a, "service_connection", id, v.Name, action, map[string]any{"enabled": w.Enabled}, meta)
	})
	return out, a, err
}
