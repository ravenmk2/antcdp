package models

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func testTag(v string) string {
	h := sha256.Sum256([]byte("test-installation:" + v))
	return hex.EncodeToString(h[:])
}

func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *httpx.Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}

func TestProviderConfigAndAuthentication(t *testing.T) {
	for _, base := range []string{"file:///etc/passwd", "https://u:secret@models.test", "https://models.test?", "https://models.test?a=b", "https://models.test:65536", "https://models.test:0", "https://models.test/#fragment", "https://models.test\r\n"} {
		c := Config{BaseURL: base}
		if validateConfig(&c) == nil {
			t.Errorf("accepted invalid endpoint %q", base)
		}
	}
	c := Config{BaseURL: "https://models.test/v1"}
	if err := validateConfig(&c); err != nil || c.ConnectTimeout != 10 || c.RequestTimeout != 120 {
		t.Fatal("defaults", c, err)
	}
	secret := "a-secret"
	for _, tc := range []struct {
		kind, method, operation string
		value                   *string
		create, valid           bool
	}{
		{"deepseek", "api_key", "replace", &secret, true, true},
		{"deepseek", "api_key", "clear", nil, true, true},
		{"deepseek", "none", "clear", nil, true, false},
		{"custom", "none", "clear", nil, true, false},
		{"ollama", "none", "clear", nil, true, true},
		{"ollama", "none", "replace", &secret, true, false},
		{"custom", "api_key", "keep", nil, true, false},
		{"custom", "api_key", "keep", &secret, false, false},
		{"custom", "api_key", "keep", nil, false, true},
	} {
		a := AuthenticationWrite{Method: tc.method, Secret: SecretWrite{Operation: tc.operation, Value: tc.value}}
		if got := validateAuth(tc.kind, &a, tc.create); (got == nil) != tc.valid {
			t.Errorf("%+v: %v", tc, got)
		}
	}
}

func TestPatchPresenceAndNestedStrictness(t *testing.T) {
	var p ProviderPatch
	if err := json.Unmarshal([]byte(`{"enabled":false,"description":null}`), &p); err != nil || !p.Enabled.Set || p.Enabled.Value || !p.Description.Null || p.Name.Set {
		t.Fatal(p, err)
	}
	if json.Unmarshal([]byte(`{"config":{"base_url":"https://models.test","unknown":true}}`), &p) == nil {
		t.Fatal("nested unknown config accepted")
	}
}

func TestETag(t *testing.T) {
	s := &Service{ETag: testTag}
	tag := s.tag("provider", 1, 1)
	if err := checkTag(tag, tag); err != nil {
		t.Fatal(err)
	}
	requireCode(t, checkTag("", tag), "PRECONDITION_REQUIRED")
	requireCode(t, checkTag(s.tag("provider", 1, 2), tag), "VERSION_CONFLICT")
	if s.tag("provider", 1, 1) == s.tag("definition", 1, 1) {
		t.Fatal("ETag resource types collide")
	}
}

func TestDefinitionParameterAndThinkingValidation(t *testing.T) {
	s := &Service{ValidateParameters: func(_, _ string, p json.RawMessage) error {
		var params map[string]json.RawMessage
		if err := json.Unmarshal(p, &params); err != nil {
			return err
		}
		for k := range params {
			if k != "max_output_tokens" {
				return httpx.E(422, "MODEL_PARAMETER_UNSUPPORTED", "unsupported")
			}
		}
		return nil
	}}
	d := Definition{Name: "模型", RemoteModelID: "Model/CaseSensitive", Protocol: "chat_completions", ContextWindow: 8192, MaxOutput: 1024, Parameters: json.RawMessage(`{}`), Thinking: []ThinkingOption{{Key: "default", Label: "默认", Parameters: json.RawMessage(`{}`)}}, Capabilities: Capabilities{"supported", "unsupported", "unsupported", "unsupported", "unsupported"}}
	if err := s.validateDefinition(&Provider{Type: "custom"}, &d); err != nil {
		t.Fatal(err)
	}
	d.Capabilities.Image = "unknown"
	if s.validateDefinition(&Provider{Type: "custom"}, &d) == nil {
		t.Fatal("management configuration accepted an unknown declaration")
	}
	d.Capabilities.Image = "unsupported"
	for _, p := range []string{`null`, `[]`, `{"max_output_tokens":1025}`, `{"max_output_tokens":0}`, `{"max_output_tokens":1.5}`} {
		if s.parameters("custom", d.Protocol, json.RawMessage(p), 1024) == nil {
			t.Errorf("accepted %s", p)
		}
	}
	requireCode(t, s.parameters("custom", d.Protocol, json.RawMessage(`{"temperature":1}`), 1024), "MODEL_PARAMETER_UNSUPPORTED")
	d.Thinking = append(d.Thinking, d.Thinking[0])
	if s.validateDefinition(&Provider{Type: "custom"}, &d) == nil {
		t.Fatal("duplicate thinking key")
	}
}

func TestDiagnosticWhitelistAndStatus(t *testing.T) {
	now := time.Now()
	for _, status := range []string{"succeeded", "failed", "unsupported"} {
		input := json.RawMessage(`{"diagnostic":{"id":"untrusted","kind":"wrong","outdated":true,"status":"` + status + `","checks":[],"credential":"secret","provider_body":"secret"},"raw":"secret"}`)
		b, err := sanitizeTestResult("model_probe", input, now, now)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "secret") || strings.Contains(string(b), "untrusted") || strings.Contains(string(b), "outdated") || !strings.Contains(string(b), `"kind":"model_probe"`) {
			t.Fatal("unsafe result", string(b))
		}
	}
	b, err := sanitizeTestResult("model_discovery", json.RawMessage(`{"models":[],"raw":"secret"}`), now, now)
	if err != nil || string(b) != `{"models":[],"truncated":false}` {
		t.Fatal(string(b), err)
	}
	if _, err = sanitizeTestResult("model_discovery", json.RawMessage(`{"models":null}`), now, now); err == nil {
		t.Fatal("null models accepted")
	}
}
func TestIconValidation(t *testing.T) {
	if err := validateIcon(nil); err != nil {
		t.Fatal(err)
	}
	for _, v := range Icons() {
		key := v.Key
		if err := validateIcon(&key); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range []string{"", "../secret", "https://remote.test/icon.svg"} {
		if validateIcon(&key) == nil {
			t.Fatal("invalid icon accepted", key)
		}
	}
}
