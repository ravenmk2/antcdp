package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func ValidateConfig(raw string, ca *string) error {
	u, e := url.Parse(raw)
	if e != nil || len(raw) > 2048 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(raw, "\r\n\\") || strings.Contains(u.EscapedPath(), "%") {
		return httpx.Invalid("base_url", "https_url_required")
	}
	if ip, e := netip.ParseAddr(u.Hostname()); e == nil && !allowedIP(ip) {
		return httpx.Invalid("base_url", "address_not_allowed")
	}
	if ca != nil && *ca != "" {
		if len(*ca) > 32768 || strings.Contains(*ca, "PRIVATE KEY") || !x509.NewCertPool().AppendCertsFromPEM([]byte(*ca)) {
			return httpx.Invalid("custom_ca_pem", "invalid_certificate")
		}
	}
	return nil
}
func allowedIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	// Private business networks are supported; local/metadata and special ranges are not.
	if !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, raw := range []string{"::/96", "fd00:ec2::254/128", "100.64.0.0/10", "192.0.0.0/24", "198.18.0.0/15", "2001:db8::/32", "2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(raw).Contains(ip) {
			return false
		}
	}
	return true
}
func transport(g *GitLab) *http.Transport {
	roots, _ := x509.SystemCertPool()
	if roots == nil {
		roots = x509.NewCertPool()
	}
	if g.CA != nil {
		roots.AppendCertsFromPEM([]byte(*g.CA))
	}
	return &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 8 * time.Second, DisableKeepAlives: true, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if e != nil {
			return nil, e
		}
		if len(ips) == 0 {
			return nil, errors.New("no address")
		}
		for _, ip := range ips {
			if !allowedIP(ip) {
				return nil, errors.New("address not allowed")
			}
		}
		var last error
		for _, ip := range ips {
			conn, e := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), port))
			if e == nil {
				return conn, nil
			}
			last = e
		}
		return nil, last
	}}
}

var outboundSlots = make(chan struct{}, 8)

type Diagnostic struct {
	Outdated          bool      `json:"outdated,omitempty"`
	StartedAt         time.Time `json:"started_at"`
	Status            string    `json:"status"`
	HTTPStatus        int       `json:"http_status,omitempty"`
	ConnectionVersion uint64    `json:"connection_version,string,omitempty"`
	MaterialVersion   uint64    `json:"material_version,string,omitempty"`
	WebhookVersion    uint64    `json:"webhook_version,string,omitempty"`
	ExternalUserID    uint64    `json:"external_user_id,string,omitempty"`
	Username          string    `json:"username,omitempty"`
	Event             string    `json:"event,omitempty"`
	ProjectID         uint64    `json:"external_project_id,string,omitempty"`
	DeliveryID        string    `json:"delivery_id,omitempty"`
}

func probe(ctx context.Context, g *GitLab, token string, started time.Time) Diagnostic {
	d := Diagnostic{StartedAt: started, Status: "connection_failed", ConnectionVersion: g.ConnectionVersion}
	tr := transport(g)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	path := "/-/health"
	if token != "" {
		path = "/api/v4/user"
	}
	req, e := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(g.BaseURL, "/")+path, nil)
	if e != nil {
		return d
	}
	if token != "" {
		req.Header.Set("PRIVATE-TOKEN", token)
	}
	req.Header.Set("Accept", "application/json")
	resp, e := client.Do(req)
	if e != nil {
		return d
	}
	defer resp.Body.Close()
	d.HTTPStatus = resp.StatusCode
	body, e := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if e != nil || len(body) > 1<<20 {
		d.Status = "invalid_response"
		return d
	}
	if token == "" {
		d.Status = "http_reachable"
		return d
	}
	d.Status = "authentication_failed"
	if resp.StatusCode != 200 {
		return d
	}
	var user struct {
		ID       uint64 `json:"id"`
		Username string `json:"username"`
	}
	if json.Unmarshal(body, &user) != nil || user.ID == 0 || len(user.Username) > 255 {
		d.Status = "invalid_response"
		return d
	}
	d.Status = "authenticated"
	d.ExternalUserID = user.ID
	d.Username = user.Username
	return d
}
func (s *Service) Verify(ctx context.Context, raw string, id, cid uint64, scope Scope) (Result, *identity.Auth, error) {
	select {
	case outboundSlots <- struct{}{}:
		defer func() { <-outboundSlots }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "外部验证繁忙，请稍后重试")
	}
	var g *GitLab
	var token string
	var version, material, credentialVersion uint64
	a, e := s.access(ctx, raw, scope, id, true, func(_ identity.Tx, r Repository, _ *identity.Auth, v *Integration, scope Scope) error {
		if !v.Enabled {
			return httpx.E(409, "INTEGRATION_DISABLED", "集成已停用")
		}
		version = v.Version
		var e error
		g, e = config(r, id)
		if e != nil {
			return e
		}
		if cid != 0 {
			cr, e := r.Credential(cid)
			if e != nil {
				return e
			}
			if !scoped(cr, v, scope) {
				return fail()
			}
			if !cr.Usable() {
				return httpx.E(409, "CREDENTIAL_UNAVAILABLE", "凭证已停用或过期")
			}
			material = cr.MaterialVersion
			credentialVersion = cr.Version
			sealed, e := r.Secret("credential", cid)
			if e != nil {
				return e
			}
			token, e = s.Cipher(purpose("credential", cid), sealed, false)
			if e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return Result{}, a, e
	}
	d := probe(ctx, g, token, time.Now().UTC())
	d.MaterialVersion = material
	var out Result
	a, e = s.access(ctx, raw, scope, id, true, func(_ identity.Tx, r Repository, _ *identity.Auth, v *Integration, scope Scope) error {
		current, e := config(r, id)
		if e != nil {
			return e
		}
		if !v.Enabled || v.Version != version || current.ConnectionVersion != g.ConnectionVersion {
			return stale()
		}
		kind, target := "connection", id
		if cid != 0 {
			cr, e := r.Credential(cid)
			if e != nil {
				return e
			}
			if !scoped(cr, v, scope) {
				return fail()
			}
			if cr.MaterialVersion != material || cr.Version != credentialVersion || !cr.Usable() {
				return stale()
			}
			kind, target = "credential", cid
		}
		previous, e := r.Diagnostics(kind, target)
		if e != nil {
			return e
		}
		var old Diagnostic
		_ = json.Unmarshal(previous, &old)
		if old.StartedAt.After(d.StartedAt) {
			return stale()
		}
		data, _ := json.Marshal(d)
		if e = r.SaveDiagnostics(kind, target, data); e != nil {
			return e
		}
		if cid != 0 {
			v.CredentialsVersion++
			if e = r.SaveIntegration(v); e != nil {
				return e
			}
		}
		out = Result{Data: map[string]any{"diagnostic": d, "mutation_version": v.CollectionTag(scope)}}
		return nil
	})
	return out, a, e
}
func ValidateWebhookSecret(method, secret string) error {
	if method == "secret_token" {
		return validateToken(secret)
	}
	if method != "signing_token" || !strings.HasPrefix(secret, "whsec_") || len(secret) > 8192 {
		return httpx.Invalid("verification_method", "invalid_secret")
	}
	key, e := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if e != nil || len(key) < 32 {
		return httpx.Invalid("token", "invalid_signing_token")
	}
	return nil
}
func VerifyWebhook(method, secret string, h http.Header, body []byte, now time.Time) bool {
	if method == "secret_token" {
		return len(h.Values("X-Gitlab-Token")) == 1 && subtle.ConstantTimeCompare([]byte(h.Get("X-Gitlab-Token")), []byte(secret)) == 1
	}
	if method != "signing_token" {
		return false
	}
	id, ts := h.Get("webhook-id"), h.Get("webhook-timestamp")
	if id == "" || len(id) > 255 || len(h.Values("webhook-id")) != 1 || len(h.Values("webhook-timestamp")) != 1 {
		return false
	}
	stamp, e := strconv.ParseInt(ts, 10, 64)
	if e != nil || stamp < now.Unix()-300 || stamp > now.Unix()+300 {
		return false
	}
	key, e := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if e != nil || len(key) < 32 {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + ts + "."))
	mac.Write(body)
	want := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	valid := 0
	for _, signature := range strings.Fields(strings.Join(h.Values("webhook-signature"), " ")) {
		valid |= subtle.ConstantTimeCompare([]byte(want), []byte(signature))
	}
	return valid == 1
}
func (s *Service) Receive(ctx context.Context, id uint64, h http.Header, body []byte) (Diagnostic, error) {
	started := time.Now().UTC()
	var g *GitLab
	var version uint64
	var secret string
	st, e := s.Store()
	if e != nil {
		return Diagnostic{}, e
	}
	e = st.Transact(ctx, func(tx identity.Tx) error {
		r, e := repo(tx)
		if e != nil {
			return e
		}
		v, e := r.Integration(id)
		if e != nil {
			return e
		}
		if v == nil || v.Type != "gitlab" || !v.Enabled {
			return fail()
		}
		version = v.Version
		g, e = config(r, id)
		if e != nil {
			return e
		}
		if !g.WebhookEnabled || !g.HasSecret {
			return fail()
		}
		sealed, e := r.Secret("webhook", id)
		if e != nil {
			return e
		}
		secret, e = s.Cipher(purpose("webhook", id), sealed, false)
		return e
	})
	if e != nil {
		return Diagnostic{}, e
	}
	if !VerifyWebhook(g.Method, secret, h, body, started) {
		return Diagnostic{}, httpx.E(401, "WEBHOOK_UNAUTHORIZED", "Webhook 验证失败")
	}
	var event struct {
		Kind    string `json:"object_kind"`
		Ref     string `json:"ref"`
		Project struct {
			ID uint64 `json:"id"`
		} `json:"project"`
		Attributes struct {
			ID     uint64 `json:"id"`
			Action string `json:"action"`
		} `json:"object_attributes"`
	}
	if json.Unmarshal(body, &event) != nil || event.Project.ID == 0 {
		return Diagnostic{}, httpx.E(400, "INVALID_EVENT", "事件格式不正确")
	}
	header := h.Get("X-Gitlab-Event")
	expected := map[string]string{"Push Hook": "push", "Tag Push Hook": "tag_push", "Merge Request Hook": "merge_request"}
	kind, ok := expected[header]
	if !ok {
		return Diagnostic{}, httpx.E(422, "UNSUPPORTED_EVENT", "暂不支持此事件")
	}
	if event.Kind != kind || kind == "merge_request" && (event.Attributes.ID == 0 || event.Attributes.Action == "") || kind != "merge_request" && !strings.HasPrefix(event.Ref, "refs/") {
		return Diagnostic{}, httpx.E(400, "INVALID_EVENT", "事件内容与类型不匹配")
	}
	delivery := h.Get("webhook-id")
	if delivery == "" {
		delivery = h.Get("X-Gitlab-Event-UUID")
	}
	if len(delivery) > 255 {
		return Diagnostic{}, httpx.E(400, "INVALID_EVENT", "投递标识过长")
	}
	d := Diagnostic{StartedAt: started, Status: "received_not_dispatched", WebhookVersion: g.WebhookVersion, Event: header, ProjectID: event.Project.ID, DeliveryID: delivery}
	e = st.Transact(ctx, func(tx identity.Tx) error {
		r, e := repo(tx)
		if e != nil {
			return e
		}
		v, e := r.Integration(id)
		if e != nil {
			return e
		}
		if v == nil || !v.Enabled || v.Version != version {
			return stale()
		}
		current, e := config(r, id)
		if e != nil {
			return e
		}
		if !current.WebhookEnabled || current.WebhookVersion != g.WebhookVersion {
			return stale()
		}
		previous, e := r.Diagnostics("webhook", id)
		if e != nil {
			return e
		}
		var old Diagnostic
		_ = json.Unmarshal(previous, &old)
		if old.StartedAt.After(started) {
			return nil
		}
		data, _ := json.Marshal(d)
		return r.SaveDiagnostics("webhook", id, data)
	})
	return d, e
}
