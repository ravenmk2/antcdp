package install

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/sandboxes"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func (s *Service) AgentResourceSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "agentresources/") {
		return "", errors.New("invalid agent resource secret purpose")
	}
	return s.resourceSecret("agentresources", purpose, value, seal)
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
	return s.installationID, nil
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
	u, err := url.Parse(s.runtime.Server.PublicURL)
	if err != nil {
		return nil, errors.New("outbound protection unavailable")
	}
	return []string{s.runtime.Database.Host, u.Hostname()}, nil
}

func (s *Service) bindSandbox(ctx context.Context, b Backend, m *marker) error {
	cfg := s.runtime.Sandbox
	s.sandboxBlocked = false
	s.sandboxGeneration = 1
	if m.SandboxBackend != nil {
		if m.SandboxBackend.Generation == 0 || len(m.SandboxBackend.TargetFingerprint) != 64 {
			return errors.New("invalid sandbox backend marker")
		}
		s.sandboxGeneration = m.SandboxBackend.Generation
	}
	if cfg == nil {
		return nil
	}
	target := cfg.TargetFingerprint()
	if m.SandboxBackend != nil && m.SandboxBackend.TargetFingerprint == target {
		return nil
	}
	used, err := b.SandboxInUse(ctx)
	if err != nil {
		return err
	}
	if used {
		s.sandboxBlocked = true
		return nil
	}
	if m.SandboxBackend != nil {
		s.sandboxGeneration++
	}
	m.SandboxBackend = &backendMarker{Generation: s.sandboxGeneration, TargetFingerprint: target}
	return writeJSON(s.path("installation.json"), m)
}

func (s *Service) SandboxConnection() (*sandboxes.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != Ready {
		return nil, errors.New("installation is not ready")
	}
	c := &sandboxes.Connection{BackendGeneration: s.sandboxGeneration, MaintenanceState: "unconfigured"}
	if cfg := s.runtime.Sandbox; cfg != nil {
		c.BackendType = cfg.Type
		c.Endpoint = &cfg.Endpoint
		c.APIKey = cfg.APIKey
		c.AccessMode = cfg.AccessMode
		c.ConnectTimeout = cfg.ConnectTimeout
		c.OperationTimeout = cfg.OperationTimeout
		c.MaintenanceState = "normal"
		if s.sandboxBlocked {
			c.MaintenanceState = "blocked"
		}
	}
	return c, nil
}
