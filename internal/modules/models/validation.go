package models

import (
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var codePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var tagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)
var thinkingPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)

func missing() error { return httpx.E(404, "NOT_FOUND", "模型资源不存在") }
func inUse() error {
	return httpx.E(409, "RESOURCE_IN_USE", "资源仍被使用，请先停用或解除引用")
}
func integrity() error { return httpx.E(500, "DATA_INTEGRITY_ERROR", "模型配置完整性异常") }
func unavailable() error {
	return httpx.E(409, "MODEL_UNAVAILABLE", "模型或提供商当前不可用")
}
func checkTag(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前配置")
	}
	if !tagPattern.MatchString(got) {
		return httpx.Invalid("If-Match", "invalid_format")
	}
	if got != want {
		return httpx.E(412, "VERSION_CONFLICT", "配置已变化，请重新加载")
	}
	return nil
}
func names(name, description string) error {
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if utf8.RuneCountInString(description) > 1000 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}
func validType(kind string) bool {
	switch kind {
	case "deepseek", "minimax", "glm", "ollama", "custom":
		return true
	}
	return false
}
func validateConfig(c *Config) error {
	if c == nil {
		return httpx.Invalid("config", "required")
	}
	if strings.ContainsAny(c.BaseURL, "\r\n\x00") {
		return httpx.Invalid("config.base_url", "invalid_url")
	}
	c.BaseURL = strings.TrimSpace(c.BaseURL)
	u, err := url.Parse(c.BaseURL)
	if err != nil || len(c.BaseURL) > 2048 || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") || strings.ContainsAny(c.BaseURL, "\r\n\x00") {
		return httpx.Invalid("config.base_url", "invalid_url")
	}
	if port := u.Port(); port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return httpx.Invalid("config.base_url", "invalid_url")
		}
	}
	if c.Region != nil && utf8.RuneCountInString(*c.Region) > 64 {
		return httpx.Invalid("config.region", "invalid_length")
	}
	if c.CustomCA != nil && *c.CustomCA != "" {
		if len(*c.CustomCA) > 16<<10 || !x509.NewCertPool().AppendCertsFromPEM([]byte(*c.CustomCA)) {
			return httpx.Invalid("config.custom_ca_pem", "invalid_certificate")
		}
	}
	if c.ConnectTimeout == 0 {
		c.ConnectTimeout = 10
	}
	if c.RequestTimeout == 0 {
		c.RequestTimeout = 120
	}
	if c.ConnectTimeout < 1 || c.ConnectTimeout > 30 || c.RequestTimeout < 10 || c.RequestTimeout > 600 {
		return httpx.Invalid("config", "invalid_timeout")
	}
	return nil
}
func validateAuth(kind string, a *AuthenticationWrite, create bool) error {
	if a == nil {
		return httpx.Invalid("authentication", "required")
	}
	if a.Method != "api_key" && (a.Method != "none" || kind != "ollama") {
		return httpx.Invalid("authentication.auth_method", "unsupported")
	}
	switch a.Secret.Operation {
	case "keep":
		if create || a.Secret.Value != nil {
			return httpx.Invalid("authentication.secret", "invalid_operation")
		}
	case "clear":
		if a.Secret.Value != nil {
			return httpx.Invalid("authentication.secret", "unexpected_value")
		}
	case "replace":
		if a.Secret.Value == nil || len(*a.Secret.Value) < 1 || len(*a.Secret.Value) > 8192 || strings.ContainsAny(*a.Secret.Value, "\r\n\x00") {
			return httpx.Invalid("authentication.secret", "invalid_value")
		}
	default:
		return httpx.Invalid("authentication.secret.operation", "unsupported")
	}
	if a.Method == "none" && a.Secret.Operation != "clear" {
		return httpx.Invalid("authentication.secret", "must_clear")
	}
	return nil
}
func validID(value string) (uint64, error) {
	id, e := strconv.ParseUint(value, 10, 64)
	if e != nil || id == 0 || strconv.FormatUint(id, 10) != value {
		return 0, httpx.Invalid("id", "invalid_format")
	}
	return id, nil
}
func validateQuery(q *Query) error {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 {
		return httpx.Invalid("page", "invalid_range")
	}
	q.Q = strings.TrimSpace(q.Q)
	if utf8.RuneCountInString(q.Q) > 64 {
		return httpx.Invalid("q", "invalid_length")
	}
	if q.ProviderType != "" && !validType(q.ProviderType) {
		return httpx.Invalid("provider_type", "unsupported")
	}
	if q.Protocol != "" && q.Protocol != "chat_completions" && q.Protocol != "anthropic_messages" {
		return httpx.Invalid("protocol", "unsupported")
	}
	return nil
}
func codeValue(f Field[string]) (string, error) {
	if f.Null {
		return "", httpx.Invalid("code", "invalid_format")
	}
	v := strings.TrimSpace(f.Value)
	if v == "" {
		return cryptox.ID(), nil
	}
	if !codePattern.MatchString(v) {
		return "", httpx.Invalid("code", "invalid_format")
	}
	return v, nil
}
func (s *Service) validateDefinition(p *Provider, d *Definition) error {
	if e := validateIcon(d.IconKey); e != nil {
		return e
	}
	if err := names(d.Name, d.Description); err != nil {
		return err
	}
	if len(d.RemoteModelID) == 0 || len(d.RemoteModelID) > 255 || !utf8.ValidString(d.RemoteModelID) || strings.ContainsAny(d.RemoteModelID, "\x00\r\n") {
		return httpx.Invalid("model_id", "invalid_format")
	}
	if d.Protocol != "chat_completions" && d.Protocol != "anthropic_messages" || d.Protocol == "anthropic_messages" && (p.Type == "glm" || p.Type == "ollama") {
		return httpx.Invalid("protocol", "unsupported")
	}
	if d.ContextWindow < 1 || d.ContextWindow > 2000000 || d.MaxOutput < 1 || d.MaxOutput > d.ContextWindow {
		return httpx.Invalid("context_window", "invalid_range")
	}
	for _, v := range []string{d.Capabilities.Text, d.Capabilities.Image, d.Capabilities.Tools, d.Capabilities.Streaming, d.Capabilities.Thinking} {
		if v != "supported" && v != "unsupported" {
			return httpx.Invalid("declared_capabilities", "invalid_status")
		}
	}
	if len(d.Thinking) < 1 || len(d.Thinking) > 16 {
		return httpx.Invalid("thinking_options", "invalid_count")
	}
	var defaults map[string]json.RawMessage
	if json.Unmarshal(d.Parameters, &defaults) != nil {
		return httpx.Invalid("default_parameters", "invalid_object")
	}
	for key := range defaults {
		if modelcore.IsThinkingParameter(key) {
			return httpx.Invalid("default_parameters", "use_thinking_levels")
		}
	}
	seen := map[string]bool{}
	if err := s.parameters(p.Type, d.Protocol, d.Parameters, d.MaxOutput); err != nil {
		return err
	}
	for _, v := range d.Thinking {
		if !thinkingPattern.MatchString(v.Key) || seen[v.Key] || utf8.RuneCountInString(v.Label) < 1 || utf8.RuneCountInString(v.Label) > 40 {
			return httpx.Invalid("thinking_options", "invalid_option")
		}
		seen[v.Key] = true
		if err := s.parameters(p.Type, d.Protocol, v.Parameters, d.MaxOutput); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) parameters(kind, protocol string, raw json.RawMessage, maxOutput uint64) error {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return httpx.Invalid("default_parameters", "invalid_object")
	}
	if v, ok := object["max_output_tokens"]; ok {
		var n uint64
		if json.Unmarshal(v, &n) != nil || n < 1 || n > maxOutput {
			return httpx.Invalid("max_output_tokens", "invalid_range")
		}
	}
	if s.ValidateParameters == nil {
		return httpx.E(503, "SERVICE_UNAVAILABLE", "模型适配器未配置")
	}
	return s.ValidateParameters(kind, protocol, raw)
}
func canonical(v any) ([]byte, error) {
	b, e := json.Marshal(v)
	if e != nil {
		return nil, e
	}
	var value any
	if e = json.Unmarshal(b, &value); e != nil {
		return nil, e
	}
	return json.Marshal(value)
}

func (s *Service) tag(kind string, id, version uint64) string {
	return `"` + s.ETag(fmt.Sprintf("models/v1/%s/%d/%d", kind, id, version)) + `"`
}
func same(a, b any) bool {
	x, e := canonical(a)
	y, f := canonical(b)
	return e == nil && f == nil && string(x) == string(y)
}
