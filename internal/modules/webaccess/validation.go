package webaccess

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/netguard"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

var codePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var tagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)

func missing() error { return httpx.E(404, "NOT_FOUND", "网络检索资源不存在") }
func integrity() error {
	return httpx.E(500, "DATA_INTEGRITY_ERROR", "网络检索配置完整性异常")
}
func inUse() error { return httpx.E(409, "RESOURCE_IN_USE", "资源仍被使用，请先解除引用") }
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
func validID(v string) (uint64, error) {
	id, e := strconv.ParseUint(v, 10, 64)
	if e != nil || id == 0 || strconv.FormatUint(id, 10) != v {
		return 0, httpx.Invalid("id", "invalid_format")
	}
	return id, nil
}
func names(name, description string) error {
	if strings.TrimSpace(name) == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 1000 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}
func validType(v string) bool { return v == "deepseek" || v == "glm" }
func capabilities(kind string) []string {
	if kind == "deepseek" {
		return []string{"search", "fetch"}
	}
	if kind == "glm" {
		return []string{"search"}
	}
	return []string{}
}
func supports(kind, operation string) bool {
	return (operation == "search" && validType(kind)) || (operation == "fetch" && kind == "deepseek")
}
func validateConfig(c *Config) error {
	if c == nil {
		return httpx.Invalid("config", "required")
	}
	c.BaseURL = strings.TrimSpace(c.BaseURL)
	u, e := netguard.ParseURL(c.BaseURL)
	if e != nil || len(c.BaseURL) > 2048 || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return httpx.Invalid("config.base_url", "invalid_url")
	}
	if c.Timeout < 1 || c.Timeout > 60 {
		return httpx.Invalid("config.timeout_seconds", "invalid_range")
	}
	return nil
}
func validateAuth(a *AuthenticationWrite, create bool) error {
	if a == nil {
		return httpx.Invalid("authentication", "required")
	}
	if a.Method != "api_key" {
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
		if a.Secret.Value == nil || len(*a.Secret.Value) < 1 || len(*a.Secret.Value) > 8192 || !utf8.ValidString(*a.Secret.Value) || strings.ContainsAny(*a.Secret.Value, "\r\n\x00") {
			return httpx.Invalid("authentication.secret", "invalid_value")
		}
	default:
		return httpx.Invalid("authentication.secret.operation", "unsupported")
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
	if q.Operation != "" && q.Operation != "search" && q.Operation != "fetch" {
		return httpx.Invalid("operation", "unsupported")
	}
	return nil
}
func (s *Service) tag(kind string, id, version uint64) string {
	return `"` + s.ETag(fmt.Sprintf("webaccess/%s/%d/%d", kind, id, version)) + `"`
}
func same(a, b any) bool {
	x, e := json.Marshal(a)
	if e != nil {
		return false
	}
	y, e := json.Marshal(b)
	return e == nil && string(x) == string(y)
}

// NormalizeSettings validates exact host exceptions without performing network IO.
func NormalizeSettings(v *runtime.Settings) error {
	if v.Search.Routes == nil || v.Fetch.Routes == nil || v.Fetch.AllowedInternalHosts == nil {
		return httpx.Invalid("settings", "arrays_required")
	}
	if v.Search.MaxResults < 1 || v.Search.MaxResults > 20 {
		return httpx.Invalid("search.max_results", "invalid_range")
	}
	if v.Fetch.MaxBytes < 64<<10 || v.Fetch.MaxBytes > 10<<20 || v.Fetch.TimeoutSeconds < 1 || v.Fetch.TimeoutSeconds > 60 || v.Fetch.MaxRedirects < 0 || v.Fetch.MaxRedirects > 5 {
		return httpx.Invalid("fetch", "invalid_limits")
	}
	for _, group := range []struct {
		name   string
		routes []runtime.RouteRef
	}{{"search", v.Search.Routes}, {"fetch", v.Fetch.Routes}} {
		if len(group.routes) > 3 {
			return httpx.Invalid(group.name+".routes", "too_many")
		}
		seen := map[runtime.RouteRef]bool{}
		for _, r := range group.routes {
			if seen[r] {
				return httpx.Invalid(group.name+".routes", "duplicate")
			}
			seen[r] = true
			switch r.Kind {
			case "provider":
				if _, e := validID(r.ID); e != nil {
					return httpx.Invalid(group.name+".routes", "invalid_id")
				}
			case "builtin":
				if group.name != "fetch" || r.ID != "http" {
					return httpx.Invalid(group.name+".routes", "unsupported")
				}
			default:
				return httpx.Invalid(group.name+".routes", "unsupported")
			}
		}
	}
	if len(v.Fetch.AllowedInternalHosts) > 100 {
		return httpx.Invalid("fetch.allowed_internal_hosts", "too_many")
	}
	seen := map[string]bool{}
	for i, vv := range v.Fetch.AllowedInternalHosts {
		h, e := netguard.NormalizeHost(vv)
		if e != nil || seen[h] {
			return httpx.Invalid("fetch.allowed_internal_hosts", "invalid_or_duplicate")
		}
		seen[h] = true
		v.Fetch.AllowedInternalHosts[i] = h
	}
	return nil
}
