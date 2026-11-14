package integrations

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode"
)

func probeJenkins(ctx context.Context, cfg *HTTPConfig, username, token string, started time.Time) Diagnostic {
	tr := transport(cfg)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return checkJenkins(ctx, client, cfg.BaseURL, username, token, started)
}

func checkJenkins(ctx context.Context, client *http.Client, baseURL, username, token string, started time.Time) (d Diagnostic) {
	kind := "connection_check"
	if token != "" {
		kind = "credential_verification"
	}
	d = newDiagnostic(kind, started)
	d.Status = "failed"
	d.Summary = map[string]any{"reachability": "unreachable", "service": "unknown", "reason": "connection_failed"}
	if token != "" {
		d.Summary["authentication"] = "unknown"
		d.Summary["permissions"] = "unknown"
		d.Summary["remote_expires_at"] = nil
	}
	defer func() { d.FinishedAt = time.Now().UTC().Truncate(time.Millisecond) }()
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(baseURL, "/")+"/whoAmI/api/json", nil)
	if err != nil {
		return d
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.SetBasicAuth(username, token)
	}
	response, err := client.Do(req)
	if err != nil {
		var dns *net.DNSError
		var network net.Error
		var authority x509.UnknownAuthorityError
		var hostname x509.HostnameError
		var certificate x509.CertificateInvalidError
		switch {
		case errors.As(err, &authority) || errors.As(err, &hostname) || errors.As(err, &certificate):
			d.Summary["reason"] = "tls_failed"
		case errors.As(err, &dns):
			d.Summary["reason"] = "dns_failed"
		case errors.As(err, &network) && network.Timeout():
			d.Summary["reason"] = "timeout"
		}
		return d
	}
	defer func() { _ = response.Body.Close() }()
	d.Summary["reachability"] = "reachable"
	d.Summary["http_status"] = response.StatusCode
	switch {
	case response.StatusCode == http.StatusUnauthorized:
		d.Summary["reason"] = "authentication_failed"
		if token != "" {
			d.Summary["authentication"] = "invalid"
		}
		return d
	case response.StatusCode == http.StatusForbidden:
		d.Summary["reason"] = "access_denied"
		return d
	case response.StatusCode >= 300 && response.StatusCode < 400:
		d.Summary["reason"] = "redirected"
		return d
	case response.StatusCode != http.StatusOK:
		d.Summary["reason"] = "unexpected_status"
		return d
	}
	d.Summary["reason"] = "invalid_response"
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return d
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return d
	}
	var identity struct {
		Name          string `json:"name"`
		Authenticated *bool  `json:"authenticated"`
		Anonymous     *bool  `json:"anonymous"`
	}
	if json.Unmarshal(body, &identity) != nil || identity.Authenticated == nil || identity.Anonymous == nil || identity.Name == "" || len(identity.Name) > 255 || strings.ContainsFunc(identity.Name, unicode.IsControl) {
		return d
	}
	d.Summary["service"] = "jenkins"
	if token != "" {
		if !*identity.Authenticated || *identity.Anonymous {
			d.Summary["reason"] = "authentication_failed"
			d.Summary["authentication"] = "invalid"
			return d
		}
		if identity.Name != username {
			d.Summary["reason"] = "identity_mismatch"
			return d
		}
		d.Summary["authentication"] = "valid"
		d.Summary["external_identity"] = map[string]string{"username": identity.Name}
	}
	d.Status = "succeeded"
	delete(d.Summary, "reason")
	return d
}
