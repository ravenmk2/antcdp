package remotehosts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"golang.org/x/crypto/ssh"
)

func decodeSSHConfig(version uint64, raw json.RawMessage) (*Config, error) {
	var cfg *Config
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if version != 1 || d.Decode(&cfg) != nil || cfg == nil || d.Decode(new(any)) != io.EOF || validateSSHConfig(cfg) != nil {
		return nil, integrity()
	}
	return cfg, nil
}

func validateSSHConfig(cfg *Config) error {
	if err := validateEndpoint(cfg); err != nil {
		return err
	}
	if len(cfg.HostKeys) > 8 {
		return httpx.Invalid("host_keys", "too_many")
	}
	seen := map[string]bool{}
	for j, raw := range cfg.HostKeys {
		key, _, options, rest, err := ssh.ParseAuthorizedKey([]byte(raw))
		if err != nil || len(options) != 0 || len(bytes.TrimSpace(rest)) != 0 || len(raw) > 8192 {
			return httpx.Invalid("host_keys", "invalid_format")
		}
		switch key.Type() {
		case ssh.KeyAlgoED25519, ssh.KeyAlgoRSA, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521:
		default:
			return httpx.Invalid("host_keys", "unsupported")
		}
		canonical := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
		if seen[canonical] {
			return httpx.Invalid("host_keys", "duplicate")
		}
		seen[canonical] = true
		cfg.HostKeys[j] = canonical
	}
	return nil
}

func validateSSHAuthentication(a *Authentication) error {
	s := a.Secret
	if s == nil {
		return httpx.Invalid("authentication.secret", "required")
	}
	if a.Method == "ssh_password" {
		if len(s.Token) == 0 || len(s.Token) > 8192 || s.PrivateKey != "" || s.Passphrase != "" {
			return httpx.Invalid("token", "invalid_format")
		}
		return nil
	}
	if s.Token != "" || len(s.PrivateKey) == 0 || len(s.PrivateKey) > 32768 || len(s.Passphrase) > 8192 {
		return httpx.Invalid("private_key", "invalid_format")
	}
	var signer ssh.Signer
	var err error
	if a.Method == "ssh_private_key" {
		if s.Passphrase != "" {
			return httpx.Invalid("passphrase", "unsupported")
		}
		signer, err = ssh.ParsePrivateKey([]byte(s.PrivateKey))
	} else {
		if s.Passphrase == "" {
			return httpx.Invalid("passphrase", "required")
		}
		signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(s.PrivateKey), []byte(s.Passphrase))
	}
	if err != nil {
		return httpx.Invalid("private_key", "invalid_key_or_passphrase")
	}
	switch signer.PublicKey().Type() {
	case ssh.KeyAlgoED25519, ssh.KeyAlgoRSA, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521:
		return nil
	}
	return httpx.Invalid("private_key", "unsupported")
}

func secretMaterial(kind string, a *Authentication) string {
	if kind != "ssh" {
		return a.Secret.Token
	}
	b, _ := json.Marshal(struct {
		Method string       `json:"method"`
		Secret *TokenSecret `json:"secret"`
	}{a.Method, a.Secret})
	return string(b)
}

var errSSHProbe = errors.New("SSH host key probe complete")
var errSSHTrust = errors.New("SSH host key is not trusted")

func probeSSH(ctx context.Context, cfg *Config, username, material string, started time.Time) Diagnostic {
	return runSSHProbe(ctx, cfg, username, material, started, nil)
}

// The dial seam is only used by local protocol tests. Production always uses the restricted dialer.
func runSSHProbe(ctx context.Context, cfg *Config, username, material string, started time.Time, dial sshDial) (d Diagnostic) {
	kind := "connection_check"
	if username != "" {
		kind = "credential_verification"
	}
	d = newDiagnostic(kind, started)
	d.Status = "failed"
	d.Summary = map[string]any{"service": "ssh", "reachability": "unreachable", "authentication": "unknown", "permissions": "unknown", "reason": "connection_failed"}
	defer func() { d.FinishedAt = time.Now().UTC().Truncate(time.Millisecond) }()
	if validateSSHConfig(cfg) != nil {
		return d
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if dial == nil {
		dial = restrictedDial
	}
	address := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	conn, err := dial(ctx, "tcp", address)
	if err != nil {
		d.Summary["reason"] = networkReason(err)
		return d
	}
	defer func() { _ = conn.Close() }()
	deadline, _ := ctx.Deadline()
	if err = conn.SetDeadline(deadline); err != nil {
		return d
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	d.Summary["reachability"] = "reachable"
	trusted := false
	attempted := false
	c := &ssh.ClientConfig{User: username, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		d.Summary["host_key"] = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
		d.Summary["fingerprint"] = ssh.FingerprintSHA256(key)
		d.Summary["host_key_algorithm"] = key.Type()
		d.Summary["host_identity"] = "untrusted"
		for _, raw := range cfg.HostKeys {
			expected, _, _, _, e := ssh.ParseAuthorizedKey([]byte(raw))
			if e == nil && bytes.Equal(expected.Marshal(), key.Marshal()) {
				trusted = true
			}
		}
		if trusted {
			d.Summary["host_identity"] = "trusted"
		} else if len(cfg.HostKeys) > 0 {
			d.Summary["host_identity"] = "mismatch"
		}
		if username == "" {
			return errSSHProbe
		}
		if !trusted {
			return errSSHTrust
		}
		return nil
	}}
	// Prefer algorithms for explicitly trusted keys when validating a known host.
	if len(cfg.HostKeys) > 0 {
		seen := map[string]bool{}
		for _, raw := range cfg.HostKeys {
			key, _, _, _, e := ssh.ParseAuthorizedKey([]byte(raw))
			if e != nil {
				continue
			}
			algorithms := []string{key.Type()}
			if key.Type() == ssh.KeyAlgoRSA {
				algorithms = []string{ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256}
			}
			for _, algorithm := range algorithms {
				if !seen[algorithm] {
					c.HostKeyAlgorithms = append(c.HostKeyAlgorithms, algorithm)
					seen[algorithm] = true
				}
			}
		}
	}
	if username != "" {
		var m struct {
			Method string       `json:"method"`
			Secret *TokenSecret `json:"secret"`
		}
		if json.Unmarshal([]byte(material), &m) != nil || m.Secret == nil {
			return d
		}
		a := &Authentication{Method: m.Method, Secret: m.Secret}
		if validateSSHAuthentication(a) != nil {
			return d
		}
		if m.Method == "ssh_password" {
			c.Auth = []ssh.AuthMethod{ssh.PasswordCallback(func() (string, error) { attempted = true; return m.Secret.Token, nil })}
		} else {
			var signer ssh.Signer
			if m.Method == "ssh_private_key" {
				signer, err = ssh.ParsePrivateKey([]byte(m.Secret.PrivateKey))
			} else {
				signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(m.Secret.PrivateKey), []byte(m.Secret.Passphrase))
			}
			if err != nil {
				return d
			}
			c.Auth = []ssh.AuthMethod{ssh.PublicKeysCallback(func() ([]ssh.Signer, error) { attempted = true; return []ssh.Signer{signer}, nil })}
		}
	}
	client, channels, requests, err := ssh.NewClientConn(conn, address, c)
	if err == nil {
		cl := ssh.NewClient(client, channels, requests)
		_ = cl.Close()
		if !attempted {
			d.Summary["reason"] = "authentication_not_required"
			return d
		}
		d.Status = "succeeded"
		d.Summary["authentication"] = "valid"
		delete(d.Summary, "reason")
		return d
	}
	if errors.Is(err, errSSHProbe) || errors.Is(err, errSSHTrust) {
		if trusted {
			d.Status = "succeeded"
			delete(d.Summary, "reason")
		} else if len(cfg.HostKeys) == 0 {
			d.Summary["reason"] = "host_key_untrusted"
		} else {
			d.Summary["reason"] = "host_key_mismatch"
		}
		return d
	}
	if ctx.Err() != nil {
		d.Summary["reason"] = "timeout"
	} else if trusted && username != "" {
		d.Summary["reason"] = "authentication_failed"
	} else {
		d.Summary["reason"] = "ssh_handshake_failed"
	}
	return d
}
