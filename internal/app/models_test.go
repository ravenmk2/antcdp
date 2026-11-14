package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modules/models"
)

func TestModelCatalogExposesRegisteredSchemaWithoutRemoteCapabilityClaims(t *testing.T) {
	catalog := modelProviderTypes(modeladapters.NewRegistry())
	if len(catalog) != 5 {
		t.Fatalf("provider count %d", len(catalog))
	}
	for _, provider := range catalog {
		if len(provider.Protocols) == 0 || len(provider.AuthMethods) == 0 {
			t.Fatal("incomplete provider catalog")
		}
		for _, route := range provider.Protocols {
			if !route.Available || !json.Valid(route.Parameters) {
				t.Fatalf("unregistered route %+v", route)
			}
			var schema map[string]any
			if err := json.Unmarshal(route.Parameters, &schema); err != nil {
				t.Fatal(err)
			}
			if schema["additionalProperties"] != false {
				t.Fatal("arbitrary parameters exposed")
			}
		}
	}
}

func TestModelProbeBridgeUsesBoundedOutputAndConfiguredThinking(t *testing.T) {
	called := false
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer private-fixture" {
			t.Error("provider route or authentication lost")
		}
		var body struct {
			MaxTokens int `json:"max_tokens"`
			Thinking  struct {
				Type string `json:"type"`
			} `json:"thinking"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.MaxTokens != 2048 || body.Thinking.Type != "enabled" || len(body.Messages) != 1 {
			t.Error("diagnostic input was not bounded or thinking choice was lost")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"model\":\"test-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"check\",\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer remote.Close()
	result, err := probeModelConnection(t.Context(), models.ProbeRequest{Kind: "model_probe", Levels: []string{"generation", "thinking", "stream"}, Secret: "private-fixture", Provider: models.Provider{Type: "deepseek", Config: models.Config{BaseURL: remote.URL, ConnectTimeout: 1, RequestTimeout: 10}}, Model: &models.Definition{RemoteModelID: "test-model", Protocol: "chat_completions", MaxOutput: 8192, Parameters: json.RawMessage(`{}`), Thinking: []models.ThinkingOption{{Key: "off", Parameters: json.RawMessage(`{"thinking":{"type":"disabled"}}`)}, {Key: "on", Parameters: json.RawMessage(`{"thinking":{"type":"enabled"}}`)}}}})
	if err != nil {
		t.Fatal(err)
	}
	var output struct {
		Diagnostic struct {
			Status string `json:"status"`
		} `json:"diagnostic"`
	}
	if !called || json.Unmarshal(result, &output) != nil || output.Diagnostic.Status != "succeeded" {
		t.Fatalf("probe result %s", result)
	}
}

func TestModelDiscoveryKeepsEmptyArrayAndExplicitTruncation(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":[]}`)
	}))
	defer remote.Close()
	result, err := probeModelConnection(t.Context(), models.ProbeRequest{Kind: "model_discovery", Secret: "private-fixture", Provider: models.Provider{Type: "deepseek", Config: models.Config{BaseURL: remote.URL, ConnectTimeout: 1, RequestTimeout: 10}}})
	if err != nil {
		t.Fatal(err)
	}
	if string(result) != `{"models":[],"truncated":false}` {
		t.Fatalf("discovery representation %s", result)
	}
}

func TestThinkingDiagnosticsRecognizeProtocolControls(t *testing.T) {
	for _, tc := range []struct {
		parameters string
		enabled    bool
	}{
		{`{"thinking":{"type":"adaptive"}}`, true},
		{`{"reasoning_effort":"high"}`, true},
		{`{"output_config":{"effort":"max"}}`, true},
		{`{"output_config":{"effort":"none"}}`, false},
		{`{"thinking":{"type":"disabled"},"reasoning_effort":"high"}`, false},
		{`{}`, false},
	} {
		if got := diagnosticThinkingEnabled(json.RawMessage(tc.parameters)); got != tc.enabled {
			t.Errorf("%s: enabled=%v", tc.parameters, got)
		}
	}
}
