package agents

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/models"
)

func TestPolicyIdentityAndNetwork(t *testing.T) {
	for _, mode := range []string{"chat", "service"} {
		v := Definition{Name: "测试", Mode: mode, ScopeKind: "platform", RuntimePolicy: defaultRuntimePolicy()}
		if mode == "service" {
			v.PoolCapacity = new(1)
		}
		if e := validateDefinition(&v); e != nil {
			t.Fatal(e)
		}
		if e := validateQuery(&Query{Mode: mode}); e != nil {
			t.Fatal(e)
		}
	}
	query := Query{Mode: legacyChatType}
	if err := validateQuery(&query); err != nil || query.Mode != "chat" {
		t.Fatalf("legacy filter was not normalized: mode=%q, err=%v", query.Mode, err)
	}
	legacy := Definition{Name: "旧类型", Mode: "task", ScopeKind: "platform", PoolCapacity: new(1), RuntimePolicy: defaultRuntimePolicy()}
	if validateDefinition(&legacy) == nil || validateQuery(&Query{Mode: legacy.Mode}) == nil {
		t.Fatal("obsolete agent type accepted")
	}
	env := CloudEnvironment{Image: "runtime:fixed", CPU: 2000, Memory: 4096, Network: NetworkPolicy{DefaultAction: "allow"}}
	if normalizeCloudEnvironment(&env) != nil {
		t.Fatal("valid independent template rejected")
	}
	env.Image = "runtime:latest"
	if normalizeCloudEnvironment(&env) == nil {
		t.Fatal("mutable image tag accepted")
	}
	for _, value := range []string{"10.1.2.3", "10.1.2.0/24", "fc00::/7", "*.Docs.Example.COM.", "xn--bcher-kva.example"} {
		if _, e := normalizeTarget(value); e != nil {
			t.Fatal(value, e)
		}
	}
	for _, value := range []string{"https://example.com", "host:80", "localhost", "127.0.0.1", "127.0.0.0/8", "::1", "::1/128", "0.0.0.0/0", "::/0", "a.*.example", "中文.example", "999.2.3.4"} {
		if _, e := normalizeTarget(value); e == nil {
			t.Fatal("unsafe target accepted", value)
		}
	}
	if _, e := normalizeTarget("126.0.0.0/7"); e != nil {
		t.Fatal("larger external egress range rejected", e)
	}
}

func TestRuntimePolicyRetryDefaultAndExplicitValues(t *testing.T) {
	for _, tc := range []struct {
		json string
		want int64
	}{
		{`{"max_model_calls":23}`, 5},
		{`{"max_model_calls":23,"max_model_retries":0}`, 0},
		{`{"max_model_calls":23,"max_model_retries":-1}`, -1},
		{`{"max_model_calls":23,"max_model_retries":12}`, 12},
	} {
		var policy RuntimePolicy
		if err := json.Unmarshal([]byte(tc.json), &policy); err != nil || policy.MaxModelRetries != tc.want || policy.MaxModelCalls != 23 {
			t.Fatal("runtime policy decode", tc.json, policy, err)
		}
	}
	policy := defaultRuntimePolicy()
	policy.MaxModelRetries = -2
	if err := validatePolicy(policy); err == nil {
		t.Fatal("invalid retry value accepted")
	}
}
func TestModelSelectionHashUsesEffectiveRoute(t *testing.T) {
	s := &Service{Models: &models.Service{ValidateParameters: func(string, string, json.RawMessage) error { return nil }}}
	v := &models.RuntimeModel{ProviderID: 1, DefinitionID: 2, ProviderType: "deepseek", ProviderName: "提供商", Name: "模型", Protocol: "chat_completions", RemoteModelID: "model", Config: models.Config{BaseURL: "https://example.test/v1"}, IdentityConfig: json.RawMessage(`{}`), AuthMethod: "api_key", ContextWindow: 8192, MaxOutput: 1024, Available: true}
	b := ModelBinding{ID: 3, ModelID: 2, GenerationParameters: json.RawMessage(`{"temperature":0.1}`)}
	first, _, e := s.resolveModel(v, b, "")
	if e != nil {
		t.Fatal(e)
	}
	v.Name = "改名"
	v.ProviderName = "改标签"
	second, _, e := s.resolveModel(v, b, "")
	if e != nil || first.SelectionHash != second.SelectionHash {
		t.Fatal("display labels changed selection", e)
	}
	b.GenerationParameters = json.RawMessage(`{"temperature":0.2}`)
	third, _, e := s.resolveModel(v, b, "")
	if e != nil || first.SelectionHash == third.SelectionHash {
		t.Fatal("effective parameter change not detected", e)
	}
	other := ModelBinding{ID: 4, AgentID: 7, ModelID: b.ModelID, GenerationParameters: json.RawMessage(`{"max_output_tokens":128}`)}
	independent, _, err := s.resolveModel(v, other, "")
	if err != nil || string(independent.Parameters["max_output_tokens"]) != "128" || independent.Parameters["temperature"] != nil || string(third.Parameters["temperature"]) != "0.2" || third.Parameters["max_output_tokens"] != nil {
		t.Fatal("assistant bindings mixed generation parameters", err)
	}
	w := Definition{Name: strings.Repeat("名", 100), Mode: "chat", ScopeKind: "platform", RuntimePolicy: defaultRuntimePolicy(), SystemPrompt: strings.Repeat("a", 128*1024)}
	if e = validateDefinition(&w); e != nil {
		t.Fatal(e)
	}
	w.SystemPrompt += "b"
	if validateDefinition(&w) == nil {
		t.Fatal("prompt limit ignored")
	}
}
