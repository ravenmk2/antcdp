package models

import (
	"encoding/json"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func thinkingTestService() *Service {
	r := modeladapters.NewRegistry()
	return &Service{
		ThinkingCatalog: func(kind, protocol string) []ThinkingOption {
			return r.ThinkingOptions(modelcore.ProviderType(kind), modelcore.Protocol(protocol))
		},
		ValidateParameters: func(kind, protocol string, raw json.RawMessage) error {
			var values map[string]json.RawMessage
			if err := json.Unmarshal(raw, &values); err != nil {
				return err
			}
			return r.ValidateParameters(modelcore.ProviderType(kind), modelcore.Protocol(protocol), values)
		},
	}
}

func TestThinkingMappingsAndDefault(t *testing.T) {
	s := thinkingTestService()
	for _, kind := range []string{"deepseek", "minimax", "glm", "ollama"} {
		for _, protocol := range []string{"chat_completions", "anthropic_messages"} {
			for _, option := range s.ThinkingCatalog(kind, protocol) {
				resolved, err := s.resolveThinking(kind, protocol, []string{option.Key}, nil)
				if err != nil || len(resolved) != 1 || !same(resolved[0], option) {
					t.Fatalf("%s/%s/%s: %v", kind, protocol, option.Key, err)
				}
			}
		}
	}
	defaults, err := s.resolveThinking("deepseek", "chat_completions", nil, nil)
	if err != nil || len(defaults) != 1 || defaults[0].Key != "standard" || string(defaults[0].Parameters) != `{}` {
		t.Fatal(defaults, err)
	}
	none, err := s.resolveThinking("deepseek", "chat_completions", []string{"none"}, nil)
	if err != nil || none[0].Label != "关闭" || string(none[0].Parameters) != `{"thinking":{"type":"disabled"}}` {
		t.Fatal(none, err)
	}
	xhigh, err := s.resolveThinking("minimax", "chat_completions", []string{"xhigh"}, nil)
	if err != nil || xhigh[0].Label != "极高" {
		t.Fatal(xhigh, err)
	}
	for _, levels := range [][]string{{"high", "high"}, {"xhigh"}, {"invented"}} {
		if _, err := s.resolveThinking("deepseek", "chat_completions", levels, nil); err == nil {
			t.Fatal("accepted invalid levels", levels)
		}
	}
}

func TestCustomThinkingMappingValidation(t *testing.T) {
	s := thinkingTestService()
	for _, tc := range []struct {
		level, value string
		valid        bool
	}{
		{"none", `{"reasoning_effort":"none"}`, true},
		{"high", `{"reasoning_effort":"high"}`, true},
		{"none", `{}`, false},
		{"high", `{"reasoning_effort":"none"}`, false},
		{"none", `{"reasoning_effort":"high"}`, false},
		{"none", `{"thinking":{"type":"disabled"},"reasoning_effort":"high"}`, false},
		{"high", `{"temperature":1}`, false},
		{"high", `{"messages":[]}`, false},
	} {
		_, err := s.resolveThinking("custom", "chat_completions", []string{tc.level}, map[string]json.RawMessage{tc.level: json.RawMessage(tc.value)})
		if (err == nil) != tc.valid {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
	if _, err := s.resolveThinking("custom", "chat_completions", []string{"high"}, nil); err == nil {
		t.Fatal("missing custom mapping accepted")
	}
	if _, err := s.resolveThinking("deepseek", "chat_completions", []string{"high"}, map[string]json.RawMessage{"high": json.RawMessage(`{}`)}); err == nil {
		t.Fatal("builtin override accepted")
	}
	d := Definition{Name: "test", RemoteModelID: "test", Protocol: "chat_completions", ContextWindow: 8192, MaxOutput: 1024, Capabilities: Capabilities{"supported", "unsupported", "unsupported", "unsupported", "supported"}, Parameters: json.RawMessage(`{"reasoning_effort":"high"}`), Thinking: []ThinkingOption{{Key: "standard", Label: "默认", Parameters: json.RawMessage(`{}`)}}}
	if err := s.validateDefinition(&Provider{Type: "custom"}, &d); err == nil {
		t.Fatal("thinking in generation defaults accepted")
	}
}
