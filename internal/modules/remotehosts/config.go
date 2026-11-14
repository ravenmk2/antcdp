package remotehosts

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type adapter struct {
	probe func(context.Context, *Config, string, string, time.Time) Diagnostic
}

var adapters = map[string]adapter{"ssh": {probe: probeSSH}}

func (s *Service) serviceType() string { return "ssh" }
func DecodeConnectionConfig(_ string, version uint64, raw json.RawMessage) (*Config, error) {
	return decodeSSHConfig(version, raw)
}
func validateTypedConfig(_ string, c *Config) error { return validateSSHConfig(c) }
func validateIdentityFor(_, method string, raw json.RawMessage) error {
	switch method {
	case "ssh_password", "ssh_private_key", "ssh_encrypted_key":
		return validateUsername(raw)
	}
	return httpx.Invalid("auth_method", "unsupported")
}
func validateAuthenticationFor(kind string, a *Authentication) error {
	if a == nil {
		return httpx.Invalid("authentication", "required")
	}
	if err := validateIdentityFor(kind, a.Method, a.Identity); err != nil {
		return err
	}
	return validateSSHAuthentication(a)
}
func applyHostFields(cfg *Config, host Field[string], port Field[int]) error {
	if host.Null || port.Null {
		return httpx.Invalid("config", "invalid_format")
	}
	if port.Set && (port.Value < 1 || port.Value > 65535) {
		return httpx.Invalid("port", "invalid_format")
	}
	if host.Set {
		cfg.Host = host.Value
	}
	if port.Set {
		cfg.Port = port.Value
	}
	return nil
}
func validateEndpoint(cfg *Config) error {
	if cfg.Host == "" || len(cfg.Host) > 253 || strings.TrimSpace(cfg.Host) != cfg.Host || strings.ContainsAny(cfg.Host, "/\\@?#, %[]") || strings.ContainsFunc(cfg.Host, unicode.IsControl) {
		return httpx.Invalid("host", "invalid_format")
	}
	if ip, err := netip.ParseAddr(cfg.Host); err == nil {
		if !allowedIP(ip) {
			return httpx.Invalid("host", "address_not_allowed")
		}
	} else if strings.Contains(cfg.Host, ":") {
		return httpx.Invalid("host", "invalid_format")
	}
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return httpx.Invalid("port", "invalid_format")
	}
	return nil
}

type sshDial func(context.Context, string, string) (net.Conn, error)

func restrictedDial(ctx context.Context, _, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
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
}
func networkReason(err error) string {
	var dns *net.DNSError
	var n net.Error
	if errors.As(err, &dns) {
		return "dns_failed"
	}
	if errors.As(err, &n) && n.Timeout() {
		return "timeout"
	}
	return "connection_failed"
}
func validateUsername(raw json.RawMessage) error {
	var obj map[string]json.RawMessage
	var username string
	if json.Unmarshal(raw, &obj) != nil || len(obj) != 1 || json.Unmarshal(obj["username"], &username) != nil || username == "" || len(username) > 255 || !utf8.ValidString(username) || strings.TrimSpace(username) != username || strings.Contains(username, ":") || strings.ContainsFunc(username, unicode.IsControl) {
		return httpx.Invalid("username", "invalid_format")
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
