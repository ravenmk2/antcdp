package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var outboundSlots = make(chan struct{}, 8)

type Diagnostic struct {
	ID         string         `json:"id"`
	Kind       string         `json:"kind"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt time.Time      `json:"finished_at"`
	Status     string         `json:"status"`
	Outdated   bool           `json:"outdated"`
	Summary    map[string]any `json:"summary"`
}
type storedDiagnostic struct {
	Diagnostic
	ConnectionVersion uint64 `json:"connection_version"`
	ConfigVersion     uint64 `json:"config_version"`
	CredentialVersion uint64 `json:"credential_version"`
	MaterialVersion   uint64 `json:"material_version"`
	WebhookVersion    uint64 `json:"webhook_version"`
}

func diagnosticView(raw json.RawMessage, connection, config, credential, material, webhook uint64) (*Diagnostic, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var d storedDiagnostic
	if json.Unmarshal(raw, &d) != nil || d.ID == "" {
		return nil, integrity()
	}
	d.Outdated = d.ConnectionVersion != connection || d.ConfigVersion != config || d.CredentialVersion != credential || d.MaterialVersion != material || d.WebhookVersion != webhook
	return &d.Diagnostic, nil
}
func newDiagnostic(kind string, started time.Time) Diagnostic {
	id, _ := newCredentialCode()
	return Diagnostic{ID: id, Kind: kind, StartedAt: started.UTC().Truncate(time.Millisecond), FinishedAt: time.Now().UTC().Truncate(time.Millisecond), Summary: map[string]any{}}
}
func saveDiagnostic(r Repository, kind string, id uint64, d storedDiagnostic) error {
	previous, err := r.Diagnostics(kind, id)
	if err != nil {
		return err
	}
	if len(previous) > 0 {
		var old storedDiagnostic
		if json.Unmarshal(previous, &old) != nil {
			return integrity()
		}
		same := old.ConnectionVersion == d.ConnectionVersion && old.ConfigVersion == d.ConfigVersion && old.CredentialVersion == d.CredentialVersion && old.MaterialVersion == d.MaterialVersion && old.WebhookVersion == d.WebhookVersion
		if same && (old.StartedAt.After(d.StartedAt) || old.StartedAt.Equal(d.StartedAt) && old.ID > d.ID) {
			return nil
		}
	}
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return r.SaveDiagnostics(kind, id, data)
}
func probe(ctx context.Context, g *GitLabConfig, token string, started time.Time) (d Diagnostic) {
	kind := "connection_check"
	if token != "" {
		kind = "credential_verification"
	}
	d = newDiagnostic(kind, started)
	d.Status = "failed"
	defer func() { d.FinishedAt = time.Now().UTC().Truncate(time.Millisecond) }()
	d.Summary["reason"] = "connection_failed"
	tr := transport(g)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	path := "/-/health"
	if token != "" {
		path = "/api/v4/user"
		d.Summary["authentication"] = "unknown"
		d.Summary["permissions"] = "unknown"
		d.Summary["remote_expires_at"] = nil
	} else {
		d.Summary["reachability"] = "unreachable"
	}
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(g.BaseURL, "/")+path, nil)
	if err != nil {
		return d
	}
	if token != "" {
		req.Header.Set("PRIVATE-TOKEN", token)
	}
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return d
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		d.Summary["reason"] = "invalid_response"
		return d
	}
	if token == "" {
		d.Status = "succeeded"
		d.Summary = map[string]any{"reachability": "reachable"}
		return d
	}
	d.Summary["reason"] = "authentication_failed"
	d.Summary["authentication"] = "invalid"
	if response.StatusCode != 200 {
		return d
	}
	var user struct {
		ID       uint64 `json:"id"`
		Username string `json:"username"`
	}
	if json.Unmarshal(body, &user) != nil || user.ID == 0 || len(user.Username) > 255 {
		d.Summary["reason"] = "invalid_response"
		d.Summary["authentication"] = "unknown"
		return d
	}
	d.Status = "succeeded"
	delete(d.Summary, "reason")
	d.Summary["authentication"] = "valid"
	d.Summary["external_identity"] = map[string]string{"id": fmt.Sprint(user.ID), "username": user.Username}
	return d
}
func (s *Service) Verify(ctx context.Context, raw string, id, cid uint64, owner CredentialOwnership, tag string) (Result, *identity.Auth, error) {
	select {
	case outboundSlots <- struct{}{}:
		defer func() { <-outboundSlots }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "外部验证繁忙，请稍后重试")
	}
	var g GitLabConfig
	var token string
	snapshot := storedDiagnostic{}
	a, err := s.access(ctx, raw, owner, id, true, func(_ identity.Tx, r Repository, _ *identity.Auth, v *ServiceConnection, owner CredentialOwnership) error {
		if !v.Enabled {
			return httpx.E(409, "RESOURCE_DISABLED", "服务连接已停用")
		}
		snapshot.ConnectionVersion = v.Version
		snapshot.ConfigVersion = v.ConfigVersion
		g = v.Config
		if cid == 0 {
			return check(tag, s.connectionTag(v))
		}
		cr, err := r.Credential(cid)
		if err != nil {
			return err
		}
		if !owned(cr, v, owner) {
			return fail()
		}
		if err = check(tag, s.credentialTag(cr)); err != nil {
			return err
		}
		if !cr.Usable() {
			return unavailable()
		}
		snapshot.CredentialVersion = cr.Version
		snapshot.MaterialVersion = cr.MaterialVersion
		sealed, err := r.Secret("credential", cid)
		if err != nil {
			return err
		}
		token, err = s.Cipher(purpose("credential", id, cid, cr.AuthMethod), sealed, false)
		return err
	})
	if err != nil {
		return Result{}, a, err
	}
	run := s.Probe
	if run == nil {
		run = probe
	}
	snapshot.Diagnostic = run(ctx, &g, token, time.Now().UTC())
	var out Result
	a, err = s.access(ctx, raw, owner, id, true, func(_ identity.Tx, r Repository, _ *identity.Auth, v *ServiceConnection, owner CredentialOwnership) error {
		if !v.Enabled || v.Version != snapshot.ConnectionVersion || v.ConfigVersion != snapshot.ConfigVersion {
			return changedState()
		}
		kind, target := "connection", id
		if cid != 0 {
			cr, err := r.Credential(cid)
			if err != nil {
				return err
			}
			if !owned(cr, v, owner) {
				return fail()
			}
			if !cr.Usable() || cr.Version != snapshot.CredentialVersion || cr.MaterialVersion != snapshot.MaterialVersion {
				return changedState()
			}
			kind, target = "credential", cid
		}
		if err := saveDiagnostic(r, kind, target, snapshot); err != nil {
			return err
		}
		out = Result{Data: snapshot.Diagnostic}
		return nil
	})
	return out, a, err
}
func (s *Service) Receive(ctx context.Context, connection uint64, h http.Header, body []byte) (Diagnostic, error) {
	started := time.Now().UTC()
	snapshot := storedDiagnostic{}
	var settings *WebhookSettings
	var secret string
	st, err := s.Store()
	if err != nil {
		return Diagnostic{}, err
	}
	err = st.Transact(ctx, func(tx identity.Tx) error {
		r, err := repo(tx)
		if err != nil {
			return err
		}
		v, err := r.Connection(connection)
		if err != nil {
			return err
		}
		if v == nil || v.Type != "gitlab" || !v.Enabled {
			return fail()
		}
		if _, err = config(r, connection); err != nil {
			return err
		}
		settings, err = webhookFor(r, connection)
		if err != nil {
			return err
		}
		if !settings.Enabled {
			return fail()
		}
		snapshot.ConnectionVersion = v.Version
		snapshot.WebhookVersion = settings.Version
		sealed, err := r.Secret("webhook", connection)
		if err != nil {
			return err
		}
		secret, err = s.Cipher(purpose("webhook_settings", connection, connection, settings.Method), sealed, false)
		return err
	})
	if err != nil {
		return Diagnostic{}, err
	}
	if !VerifyWebhook(settings.Method, secret, h, body, started) {
		return Diagnostic{}, httpx.E(401, "WEBHOOK_AUTHENTICATION_FAILED", "Webhook 验证失败")
	}
	// The receiver validates transport/authentication only. Event selection and
	// project bindings belong to consumers, including events without a project.
	var payload map[string]json.RawMessage
	if json.Unmarshal(body, &payload) != nil || payload == nil {
		return Diagnostic{}, httpx.E(400, "BAD_REQUEST", "事件必须是 JSON 对象")
	}
	kind := h.Get("X-Gitlab-Event")
	if len(h.Values("X-Gitlab-Event")) != 1 || strings.TrimSpace(kind) == "" || len(kind) > 128 {
		return Diagnostic{}, httpx.E(400, "BAD_REQUEST", "事件类型请求头不正确")
	}
	delivery := h.Get("webhook-id")
	if delivery == "" {
		delivery = h.Get("X-Gitlab-Event-UUID")
	}
	if len(delivery) > 255 {
		return Diagnostic{}, httpx.E(400, "BAD_REQUEST", "投递标识过长")
	}
	d := newDiagnostic("webhook_receipt", started)
	d.Status = "received_not_dispatched"
	d.Summary = map[string]any{"event_type": kind, "delivery_id": delivery}
	// Optional diagnostic metadata, never a prerequisite or routing condition.
	var project struct {
		ID uint64 `json:"id"`
	}
	if json.Unmarshal(payload["project"], &project) == nil && project.ID != 0 {
		d.Summary["source_project_id"] = fmt.Sprint(project.ID)
	}
	snapshot.Diagnostic = d
	err = st.Transact(ctx, func(tx identity.Tx) error {
		r, err := repo(tx)
		if err != nil {
			return err
		}
		v, err := r.Connection(connection)
		if err != nil {
			return err
		}
		if v == nil || !v.Enabled || v.Version != snapshot.ConnectionVersion {
			return changedState()
		}
		if _, err = config(r, connection); err != nil {
			return err
		}
		current, err := webhookFor(r, connection)
		if err != nil {
			return err
		}
		if current == nil || current.ConnectionID != connection || !current.Enabled || current.Version != snapshot.WebhookVersion {
			return changedState()
		}
		return saveDiagnostic(r, "webhook", connection, snapshot)
	})
	return d, err
}
