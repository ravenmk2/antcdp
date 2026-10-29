package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// Adapters are registered in code; capability discovery never advertises future operations.
type adapter struct {
	decodeConfig   func(uint64, json.RawMessage) (*HTTPConfig, error)
	name           string
	method         string
	identity       func(json.RawMessage) error
	probe          func(context.Context, *HTTPConfig, string, string, time.Time) Diagnostic
	webhookMethods []string
}

var adapters = map[string]adapter{
	"gitlab": {decodeConfig: decodeHTTPConfig, name: "GitLab", method: "gitlab_access_token", identity: gitlabIdentity, probe: func(ctx context.Context, cfg *HTTPConfig, _, token string, started time.Time) Diagnostic {
		return probe(ctx, cfg, token, started)
	}, webhookMethods: []string{"secret_token", "signing_token"}},
	"jenkins": {decodeConfig: decodeHTTPConfig, name: "Jenkins", method: "jenkins_api_token", identity: jenkinsIdentity, probe: probeJenkins, webhookMethods: []string{}},
}

func Types() []map[string]any {
	items := []map[string]any{}
	for _, kind := range []string{"gitlab", "jenkins"} {
		a := adapters[kind]
		items = append(items, map[string]any{"service_type": kind, "name": a.name, "credentials": true, "connection_test": true, "credential_verification": true, "auth_methods": []string{a.method}, "operations": []string{}, "webhook": map[string]any{"supported": len(a.webhookMethods) > 0, "verification_methods": a.webhookMethods}})
	}
	return items
}

// ForType creates an immutable route-scoped service. Empty Type preserves the GitLab internal API.
func (s *Service) ForType(kind string) *Service { copy := *s; copy.Type = kind; return &copy }
func (s *Service) serviceType() string {
	if s.Type == "" {
		return "gitlab"
	}
	return s.Type
}

func gitlabIdentity(raw json.RawMessage) error {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil || obj == nil || len(obj) != 0 {
		return httpx.Invalid("authentication.identity_config", "invalid_format")
	}
	return nil
}

func jenkinsIdentity(raw json.RawMessage) error {
	var obj map[string]json.RawMessage
	var username string
	if json.Unmarshal(raw, &obj) != nil || len(obj) != 1 || json.Unmarshal(obj["username"], &username) != nil || username == "" || len(username) > 255 || !utf8.ValidString(username) || strings.TrimSpace(username) != username || strings.Contains(username, ":") || strings.ContainsFunc(username, unicode.IsControl) {
		return httpx.Invalid("username", "invalid_format")
	}
	return nil
}

func validateAuthenticationFor(kind string, a *Authentication) error {
	if a == nil {
		return httpx.Invalid("authentication", "required")
	}
	provider, ok := adapters[kind]
	if !ok || a.Method != provider.method {
		return httpx.Invalid("authentication.auth_method", "unsupported")
	}
	if err := provider.identity(a.Identity); err != nil {
		return err
	}
	if a.Secret == nil {
		return httpx.Invalid("authentication.secret", "required")
	}
	return validateToken(a.Secret.Token)
}

// DecodeConnectionConfig validates persisted configuration using its service contract.
func DecodeConnectionConfig(kind string, version uint64, raw json.RawMessage) (*HTTPConfig, error) {
	provider, ok := adapters[kind]
	if !ok {
		return nil, integrity()
	}
	return provider.decodeConfig(version, raw)
}
func decodeHTTPConfig(version uint64, raw json.RawMessage) (*HTTPConfig, error) {
	if version != 1 {
		return nil, integrity()
	}
	var cfg *HTTPConfig
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&cfg) != nil || cfg == nil || decoder.Decode(new(any)) != io.EOF || ValidateConfig(cfg.BaseURL, cfg.CA) != nil {
		return nil, integrity()
	}
	return cfg, nil
}
