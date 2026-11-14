package install

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"

	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func (s *Service) AgentResourceSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "agentresources/") {
		return "", errors.New("invalid agent resource secret purpose")
	}
	return s.resourceSecret("agentresources", purpose, value, seal)
}

func (s *Service) SandboxSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "sandboxes/") {
		return "", errors.New("invalid sandbox secret purpose")
	}
	return s.resourceSecret("sandboxes", purpose, value, seal)
}

// SandboxControlKey is installation-scoped infrastructure key material. It is
// passed only to the execution adapter, never to a DTO or stored configuration.
// It remains stable across provider API key rotation and requires the normal
// installation-key backup for recovery.
func (s *Service) SandboxControlKey() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != Ready || len(s.key) != 32 {
		return nil, errors.New("installation is not ready")
	}
	return cryptox.Derive(s.key, "sandbox-execution-control"), nil
}

// SandboxInstallationID projects the existing installation identity. A sandbox
// provider never creates a second identity or accepts one from its client.
func (s *Service) SandboxInstallationID() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != Ready || len(s.key) != 32 {
		return "", errors.New("installation is not ready")
	}
	f, err := config.Read(s.path("config.yaml"))
	if err != nil || len(f.InstallationID) != 32 {
		return "", errors.New("installation identity unavailable")
	}
	if _, err = hex.DecodeString(f.InstallationID); err != nil || strings.ToLower(f.InstallationID) != f.InstallationID {
		return "", errors.New("installation identity unavailable")
	}
	return f.InstallationID, nil
}

func (s *Service) AgentETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "agent-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

// OutboundProtectedHosts returns non-secret control-plane targets. Read after
// installation as well as startup; a failed config read must fail closed.
func (s *Service) OutboundProtectedHosts() ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	f, err := config.Read(s.path("config.yaml"))
	if err != nil {
		return nil, errors.New("outbound protection unavailable")
	}
	u, err := url.Parse(s.runtime.Server.PublicURL)
	if err != nil {
		return nil, errors.New("outbound protection unavailable")
	}
	return []string{f.Database.Host, u.Hostname()}, nil
}
