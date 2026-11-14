package agents

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/models"
)

func TestPolicyIdentityAndNetwork(t *testing.T) {
	for _, mode := range []string{"interactive", "service"} {
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
	legacy := Definition{Name: "旧类型", Mode: "task", ScopeKind: "platform", PoolCapacity: new(1), RuntimePolicy: defaultRuntimePolicy()}
	if validateDefinition(&legacy) == nil || validateQuery(&Query{Mode: legacy.Mode}) == nil {
		t.Fatal("obsolete agent type accepted")
	}
	env := CloudEnvironment{Image: "runtime:fixed", CPU: 2000, Memory: 4096, Network: NetworkPolicy{DefaultAction: "allow"}}
	if normalizeCloudEnvironment(&env, false) != nil {
		t.Fatal("valid independent template rejected")
	}
	env.Image = "runtime:latest"
	if normalizeCloudEnvironment(&env, false) == nil {
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
func TestModelSelectionHashUsesEffectiveRoute(t *testing.T) {
	s := &Service{Models: &models.Service{ValidateParameters: func(string, string, json.RawMessage) error { return nil }}}
	v := &models.RuntimeModel{ProviderID: 1, DefinitionID: 2, ProviderType: "deepseek", ProviderName: "提供商", Name: "模型", Protocol: "chat_completions", RemoteModelID: "model", Config: models.Config{BaseURL: "https://example.test/v1"}, IdentityConfig: json.RawMessage(`{}`), AuthMethod: "api_key", Parameters: json.RawMessage(`{"temperature":0.1}`), ContextWindow: 8192, MaxOutput: 1024, Available: true, Thinking: []models.ThinkingOption{{Key: "standard", Label: "标准", Parameters: json.RawMessage(`{}`)}}}
	b := ModelBinding{ID: 3, ModelID: 2, ThinkingOptions: []string{"standard"}, DefaultThinking: "standard", GenerationOverrides: json.RawMessage(`{}`)}
	first, _, e := s.resolveModel(v, b, "standard")
	if e != nil {
		t.Fatal(e)
	}
	v.Name = "改名"
	v.ProviderName = "改标签"
	second, _, e := s.resolveModel(v, b, "standard")
	if e != nil || first.SelectionHash != second.SelectionHash {
		t.Fatal("display labels changed selection", e)
	}
	v.Parameters = json.RawMessage(`{"temperature":0.2}`)
	third, _, e := s.resolveModel(v, b, "standard")
	if e != nil || first.SelectionHash == third.SelectionHash {
		t.Fatal("effective parameter change not detected", e)
	}
	w := Definition{Name: strings.Repeat("名", 100), Mode: "interactive", ScopeKind: "platform", RuntimePolicy: defaultRuntimePolicy(), SystemPrompt: strings.Repeat("a", 128*1024)}
	if e = validateDefinition(&w); e != nil {
		t.Fatal(e)
	}
	w.SystemPrompt += "b"
	if validateDefinition(&w) == nil {
		t.Fatal("prompt limit ignored")
	}
}
