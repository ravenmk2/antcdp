package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
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
		if len(*ca) > 16384 || strings.Contains(*ca, "PRIVATE KEY") || !x509.NewCertPool().AppendCertsFromPEM([]byte(*ca)) {
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
func transport(g *GitLabConfig) *http.Transport {
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
