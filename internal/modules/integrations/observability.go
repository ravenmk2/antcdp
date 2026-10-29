package integrations

import (
	"context"
	"crypto/x509"
	"encoding/base64"
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

func probeOpenObserve(ctx context.Context, cfg *HTTPConfig, username, secret string, started time.Time) Diagnostic {
	return probeObservability(ctx, cfg, "openobserve", username, secret, started)
}
func probeElasticsearch(ctx context.Context, cfg *HTTPConfig, username, secret string, started time.Time) Diagnostic {
	return probeObservability(ctx, cfg, "elasticsearch", username, secret, started)
}
func probeObservability(ctx context.Context, cfg *HTTPConfig, kind, username, secret string, started time.Time) Diagnostic {
	tr := transport(cfg)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return checkObservability(ctx, client, cfg, kind, username, secret, started)
}

// Only bounded, read-only API responses are used; remote payloads never enter diagnostics.
func checkObservability(ctx context.Context, client *http.Client, cfg *HTTPConfig, kind, username, secret string, started time.Time) (d Diagnostic) {
	verification := secret != ""
	diagnosticKind := "connection_check"
	if verification {
		diagnosticKind = "credential_verification"
	}
	d = newDiagnostic(diagnosticKind, started)
	d.Status = "failed"
	d.Summary = map[string]any{"reachability": "unreachable", "service": "unknown", "reason": "connection_failed"}
	if verification {
		d.Summary["authentication"] = "unknown"
		d.Summary["permissions"] = "unknown"
		d.Summary["remote_expires_at"] = nil
		if kind == "openobserve" {
			d.Summary["organization_access"] = "unknown"
		}
	}
	defer func() { d.FinishedAt = time.Now().UTC().Truncate(time.Millisecond) }()
	path := "/"
	if kind == "openobserve" {
		path = "/healthz"
		if verification {
			path = "/api/" + cfg.DefaultOrganization + "/streams?fetchSchema=false&type=logs"
		}
	} else if verification {
		path = "/_security/_authenticate"
	}
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(cfg.BaseURL, "/")+path, nil)
	if err != nil {
		return d
	}
	req.Header.Set("Accept", "application/json")
	if verification {
		if kind == "elasticsearch" && username == "" {
			req.Header.Set("Authorization", "ApiKey "+secret)
		} else {
			req.SetBasicAuth(username, secret)
		}
	}
	response, err := client.Do(req)
	if err != nil {
		d.Summary["reason"] = observabilityNetworkReason(err)
		return d
	}
	defer func() { _ = response.Body.Close() }()
	d.Summary["reachability"] = "reachable"
	d.Summary["http_status"] = response.StatusCode
	switch {
	case response.StatusCode == 401:
		d.Summary["reason"] = "authentication_failed"
		if verification {
			d.Summary["authentication"] = "invalid"
		}
		return d
	case response.StatusCode == 403:
		d.Summary["reason"] = "access_denied"
		return d
	case response.StatusCode == 404:
		d.Summary["reason"] = "endpoint_not_found"
		return d
	case response.StatusCode >= 300 && response.StatusCode < 400:
		d.Summary["reason"] = "redirected"
		return d
	case response.StatusCode != 200:
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
	var payload map[string]json.RawMessage
	if json.Unmarshal(body, &payload) != nil || payload == nil {
		return d
	}
	if kind == "openobserve" {
		if verification {
			var list []json.RawMessage
			if json.Unmarshal(payload["list"], &list) != nil || list == nil {
				return d
			}
			d.Summary["authentication"] = "valid"
			d.Summary["organization_access"] = "allowed"
		} else {
			var status string
			if json.Unmarshal(payload["status"], &status) != nil || status != "ok" {
				return d
			}
			// healthz is generic; it proves health endpoint reachability, not product identity.
		}
	} else if verification {
		var identity struct {
			Username           string `json:"username"`
			AuthenticationType string `json:"authentication_type"`
			APIKey             *struct {
				ID string `json:"id"`
			} `json:"api_key"`
		}
		if json.Unmarshal(body, &identity) != nil || identity.Username == "" || len(identity.Username) > 255 || strings.ContainsFunc(identity.Username, unicode.IsControl) {
			return d
		}
		if username != "" && identity.Username != username {
			d.Summary["reason"] = "identity_mismatch"
			return d
		}
		if identity.AuthenticationType == "anonymous" || username == "" && (identity.AuthenticationType != "api_key" || identity.APIKey == nil || identity.APIKey.ID == "") {
			return d
		}
		if username == "" {
			decoded, err := base64.StdEncoding.DecodeString(secret)
			keyID, _, found := strings.Cut(string(decoded), ":")
			if err != nil || !found || identity.APIKey.ID != keyID {
				d.Summary["reason"] = "identity_mismatch"
				return d
			}
		}
		d.Summary["authentication"] = "valid"
		d.Summary["external_identity"] = map[string]string{"username": identity.Username}
	} else {
		var version struct {
			Number string `json:"number"`
		}
		var tagline string
		if json.Unmarshal(payload["version"], &version) != nil || json.Unmarshal(payload["tagline"], &tagline) != nil || tagline != "You Know, for Search" || (!strings.HasPrefix(version.Number, "7.") && !strings.HasPrefix(version.Number, "8.") && !strings.HasPrefix(version.Number, "9.")) {
			return d
		}
	}
	if verification || kind == "elasticsearch" {
		d.Summary["service"] = kind
	}
	d.Status = "succeeded"
	delete(d.Summary, "reason")
	return d
}
func observabilityNetworkReason(err error) string {
	var dns *net.DNSError
	var network net.Error
	var authority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var certificate x509.CertificateInvalidError
	switch {
	case errors.As(err, &authority) || errors.As(err, &hostname) || errors.As(err, &certificate):
		return "tls_failed"
	case errors.As(err, &dns):
		return "dns_failed"
	case errors.As(err, &network) && network.Timeout():
		return "timeout"
	default:
		return "connection_failed"
	}
}
