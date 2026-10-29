package integrations

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"regexp"
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
	"openobserve":   {decodeConfig: decodeOpenObserveConfig, name: "OpenObserve", method: "openobserve_basic", identity: jenkinsIdentity, probe: probeOpenObserve, webhookMethods: []string{}},
	"elasticsearch": {decodeConfig: decodeHTTPConfig, name: "Elasticsearch", method: "elasticsearch_basic", identity: jenkinsIdentity, probe: probeElasticsearch, webhookMethods: []string{}},
	"jenkins":       {decodeConfig: decodeHTTPConfig, name: "Jenkins", method: "jenkins_api_token", identity: jenkinsIdentity, probe: probeJenkins, webhookMethods: []string{}},
}

func Types() []map[string]any {
	items := []map[string]any{}
	for _, kind := range []string{"gitlab", "jenkins", "openobserve", "elasticsearch"} {
		a := adapters[kind]
		methods := []string{a.method}
		if kind == "elasticsearch" {
			methods = append(methods, "elasticsearch_api_key")
		}
		items = append(items, map[string]any{"service_type": kind, "name": a.name, "credentials": true, "connection_test": true, "credential_verification": true, "auth_methods": methods, "operations": []string{}, "webhook": map[string]any{"supported": len(a.webhookMethods) > 0, "verification_methods": a.webhookMethods}})
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
	if err := validateIdentityFor(kind, a.Method, a.Identity); err != nil {
		return err
	}

	if a.Secret == nil {
		return httpx.Invalid("authentication.secret", "required")
	}
	if a.Method == "openobserve_basic" || a.Method == "elasticsearch_basic" {
		if len(a.Secret.Token) == 0 || len(a.Secret.Token) > 8192 || !utf8.ValidString(a.Secret.Token) || strings.ContainsAny(a.Secret.Token, "\r\n\x00") {
			return httpx.Invalid("token", "invalid_format")
		}
		return nil
	}
	if a.Method == "elasticsearch_api_key" {
		decoded, err := base64.StdEncoding.Strict().DecodeString(a.Secret.Token)
		id, key, found := strings.Cut(string(decoded), ":")
		if err != nil || !found || id == "" || key == "" || strings.ContainsFunc(string(decoded), unicode.IsControl) {
			return httpx.Invalid("token", "invalid_format")
		}
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
	return decodeTypedConfig("http", version, raw)
}
func decodeOpenObserveConfig(version uint64, raw json.RawMessage) (*HTTPConfig, error) {
	return decodeTypedConfig("openobserve", version, raw)
}
func decodeTypedConfig(kind string, version uint64, raw json.RawMessage) (*HTTPConfig, error) {
	if version != 1 {
		return nil, integrity()
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil, integrity()
	}
	if _, exists := fields["default_organization"]; exists && kind != "openobserve" {
		return nil, integrity()
	}
	var cfg *HTTPConfig
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&cfg) != nil || cfg == nil || decoder.Decode(new(any)) != io.EOF || validateTypedConfig(kind, cfg) != nil {
		return nil, integrity()
	}
	return cfg, nil
}

func validateIdentityFor(kind, method string, raw json.RawMessage) error {
	if kind == "elasticsearch" && method == "elasticsearch_api_key" {
		return gitlabIdentity(raw)
	}
	provider, ok := adapters[kind]
	if !ok || method != provider.method {
		return httpx.Invalid("authentication.auth_method", "unsupported")
	}
	return provider.identity(raw)
}

var organizationPattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,127}$`)

func validateTypedConfig(kind string, cfg *HTTPConfig) error {
	if kind == "openobserve" {
		if !organizationPattern.MatchString(cfg.DefaultOrganization) {
			return httpx.Invalid("default_organization", "invalid_format")
		}
	} else if cfg.DefaultOrganization != "" {
		return httpx.Invalid("default_organization", "unsupported")
	}
	return ValidateConfig(cfg.BaseURL, cfg.CA)
}
