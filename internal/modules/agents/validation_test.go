package agents

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

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

func TestConnectionConfirmationScopeAndExpiry(t *testing.T) {
	s := &CloudService{Host: &Service{ETag: func(value string) string { return "test-signature/" + value }}}
	expected := connectionConfirmation{Actor: 1, Config: 4, Backend: 2, Topology: 12, Count: 3, Target: "normalized-draft", Expires: time.Now().Add(time.Minute).Unix()}
	signed := func(c connectionConfirmation) ConnectionWrite {
		raw, err := json.Marshal(c)
		if err != nil {
			t.Fatal(err)
		}
		body := base64.RawURLEncoding.EncodeToString(raw)
		return ConnectionWrite{ConfirmationText: confirmConnectionText, ConfirmationToken: body + "." + base64.RawURLEncoding.EncodeToString([]byte(s.Host.ETag("sandbox-confirm/"+body)))}
	}
	if err := s.verifyConnectionConfirmation(signed(expected), expected); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*connectionConfirmation){
		"administrator": func(c *connectionConfirmation) { c.Actor++ },
		"expiry":        func(c *connectionConfirmation) { c.Expires = time.Now().Add(-time.Second).Unix() },
		"config":        func(c *connectionConfirmation) { c.Config++ },
		"topology":      func(c *connectionConfirmation) { c.Topology++ },
		"generation":    func(c *connectionConfirmation) { c.Backend++ },
		"count":         func(c *connectionConfirmation) { c.Count++ },
		"draft":         func(c *connectionConfirmation) { c.Target += "changed" },
	} {
		t.Run(name, func(t *testing.T) {
			other := expected
			change(&other)
			if err := s.verifyConnectionConfirmation(signed(other), expected); err == nil {
				t.Fatal("accepted mismatched confirmation")
			}
		})
	}
}

func TestConnectionAddressIdentity(t *testing.T) {
	row := &SandboxConnectionRow{Endpoint: new("https://Cloud.Example:443/Api/")}
	draft := ConnectionWrite{Endpoint: "https://cloud.example/Api"}
	if err := normalizeConnection(&draft); err != nil || endpointOf(row) != draft.Endpoint {
		t.Fatal("equivalent address would reset resources", err)
	}
	for input, want := range map[string]string{"http://Example:8080/Api/": "http://example:8080/Api", "http://[::1]:80/": "http://[::1]", "https://EXAMPLE:443/a%2Fb": "https://example/a%2Fb"} {
		got, err := normalizeSandboxEndpoint(input)
		if err != nil || got != want {
			t.Errorf("%q normalized to %q, want %q: %v", input, got, want, err)
		}
	}
}
