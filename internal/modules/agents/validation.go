package agents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{16,128}$`)
var tagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)
var domainLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func missing() error     { return httpx.E(404, "NOT_FOUND", "智能体资源不存在") }
func integrity() error   { return httpx.E(500, "DATA_INTEGRITY_ERROR", "智能体数据完整性异常") }
func unavailable() error { return httpx.E(503, "SERVICE_UNAVAILABLE", "智能体服务暂不可用") }
func inUse() error {
	return httpx.E(409, "RESOURCE_IN_USE", "资源仍被引用，请先停用或解除引用")
}
func same(a, b any) bool { x, _ := json.Marshal(a); y, _ := json.Marshal(b); return bytes.Equal(x, y) }
func semanticSame(a, b any) bool {
	x, e := agentcore.ContentHash(a)
	if e != nil {
		return false
	}
	y, e := agentcore.ContentHash(b)
	return e == nil && x == y
}
func idValue(value, field string) (uint64, error) {
	id, e := strconv.ParseUint(value, 10, 64)
	if e != nil || id == 0 || strconv.FormatUint(id, 10) != value {
		return 0, httpx.Invalid(field, "invalid_format")
	}
	return id, nil
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
func (s *Service) tag(kind string, id, revision uint64) string {
	return `"` + s.ETag(fmt.Sprintf("agents/%s/%d/%d", kind, id, revision)) + `"`
}
func validateQuery(q *Query) error {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.PageSize < 1 || q.PageSize > 100 || q.Page > 1000000 {
		return httpx.Invalid("page", "invalid_range")
	}
	q.Q = strings.TrimSpace(q.Q)
	if utf8.RuneCountInString(q.Q) > 64 {
		return httpx.Invalid("q", "invalid_length")
	}
	if q.Mode != "" && q.Mode != "interactive" && q.Mode != "service" {
		return httpx.Invalid("agent_type", "unsupported")
	}
	if q.ScopeKind != "" && q.ScopeKind != "team" && q.ScopeKind != "project" && q.ScopeKind != "platform" {
		return httpx.Invalid("scope_kind", "unsupported")
	}
	return nil
}
func defaultRuntimePolicy() RuntimePolicy {
	return RuntimePolicy{60, 120, 200, 4, 4, 2700, 1800, 120, 180, 1000000, 100000}
}
func validatePolicy(p RuntimePolicy) error {
	for _, v := range []struct {
		name            string
		value, min, max int
	}{
		{"max_steps", p.MaxSteps, 1, 200}, {"max_model_calls", p.MaxModelCalls, 1, 1000}, {"max_tool_calls", p.MaxToolCalls, 1, 1000},
		{"max_children", p.MaxChildren, 0, 8}, {"max_parallel_tools", p.MaxParallelTools, 1, 16}, {"run_timeout_seconds", p.RunTimeout, 60, 86400},
		{"queue_timeout_seconds", p.QueueTimeout, 60, 86400}, {"question_timeout_seconds", p.QuestionTimeout, 5, 600}, {"approval_timeout_seconds", p.ApprovalTimeout, 15, 900},
	} {
		if v.value < v.min || v.value > v.max {
			return httpx.Invalid("runtime_policy."+v.name, "invalid_range")
		}
	}
	if p.MaxInputTokens < 1 || p.MaxInputTokens > 10000000 {
		return httpx.Invalid("runtime_policy.max_input_tokens", "invalid_range")
	}
	if p.MaxOutputTokens < 1 || p.MaxOutputTokens > 10000000 {
		return httpx.Invalid("runtime_policy.max_output_tokens", "invalid_range")
	}
	return nil
}
func normalizeTarget(value string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(value))
	if len(v) == 0 || len(v) > 253 {
		return "", httpx.Invalid("sandbox_policy.network_override", "invalid_target")
	}
	if addr, e := netip.ParseAddr(v); e == nil {
		if addr.Zone() != "" || addr.Is4In6() {
			return "", httpx.Invalid("sandbox_policy.network_override", "invalid_target")
		}
		if addr.IsLoopback() {
			return "", httpx.E(422, "NETWORK_TARGET_UNSUPPORTED", "沙箱本地回环目标不支持网络名单控制")
		}
		return addr.String(), nil
	}
	if prefix, e := netip.ParsePrefix(v); e == nil {
		if prefix.Addr().Is4In6() || prefix.Bits() == 0 {
			return "", httpx.Invalid("sandbox_policy.network_override", "invalid_target")
		}
		prefix = prefix.Masked()
		if prefix.Addr().Is4() && prefix.Bits() >= 8 && netip.MustParsePrefix("127.0.0.0/8").Contains(prefix.Addr()) || prefix == netip.MustParsePrefix("::1/128") {
			return "", httpx.E(422, "NETWORK_TARGET_UNSUPPORTED", "沙箱本地回环目标不支持网络名单控制")
		}
		return prefix.String(), nil
	}
	v = strings.TrimSuffix(v, ".")
	suffix := strings.TrimPrefix(v, "*.")
	parts := strings.Split(suffix, ".")
	if len(parts) < 2 {
		return "", httpx.Invalid("sandbox_policy.network_override", "invalid_target")
	}
	for _, part := range parts {
		if !domainLabel.MatchString(part) {
			return "", httpx.Invalid("sandbox_policy.network_override", "invalid_target")
		}
	}
	// A malformed dotted IP is not a DNS authorization.
	allDigits := true
	for _, c := range suffix {
		if c != '.' && (c < '0' || c > '9') {
			allDigits = false
		}
	}
	if allDigits {
		return "", httpx.Invalid("sandbox_policy.network_override", "invalid_target")
	}
	return v, nil
}
func validateDefinition(v *Definition) error {
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" || utf8.RuneCountInString(v.Name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if utf8.RuneCountInString(v.Description) > 1000 {
		return httpx.Invalid("description", "invalid_length")
	}
	if len(v.SystemPrompt) > 128*1024 {
		return httpx.Invalid("system_prompt", "invalid_length")
	}
	if v.Mode != "interactive" && v.Mode != "service" {
		return httpx.Invalid("agent_type", "unsupported")
	}
	if v.ScopeKind != "platform" && v.ScopeKind != "team" && v.ScopeKind != "project" {
		return httpx.Invalid("scope_kind", "unsupported")
	}
	if (v.ScopeKind == "platform") != (v.ScopeID == nil) || v.ScopeID != nil && *v.ScopeID == 0 {
		return httpx.Invalid("scope_id", "invalid_scope")
	}
	if v.Mode == "interactive" && (v.RobotUserID != nil || v.PoolCapacity != nil) {
		return httpx.Invalid("pool_capacity", "service_agent_required")
	}
	if v.Mode == "service" && (v.PoolCapacity == nil || *v.PoolCapacity < 1 || *v.PoolCapacity > 100) {
		return httpx.Invalid("pool_capacity", "invalid_range")
	}
	if e := validatePolicy(v.RuntimePolicy); e != nil {
		return e
	}
	return nil
}
func objectJSON(raw json.RawMessage, field string) (map[string]json.RawMessage, error) {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	var v map[string]json.RawMessage
	if json.Unmarshal(raw, &v) != nil || v == nil {
		return nil, httpx.Invalid(field, "expected_object")
	}
	return v, nil
}
