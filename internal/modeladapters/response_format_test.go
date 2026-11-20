package modeladapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

const objectMode = `{"type":"json_object"}`
const schemaMode = `{"type":"json_schema","schema":{"type":"object","properties":{"quantity":{"type":"integer"}},"required":["quantity"],"additionalProperties":false}}`

func TestStructuredOutputWire(t *testing.T) {
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		for _, mode := range []string{objectMode, schemaMode} {
			req := testRequest(protocol)
			req.Parameters["response_format"] = json.RawMessage(mode)
			if protocol == modelcore.AnthropicMessages {
				req.Parameters["output_config"] = json.RawMessage(`{"effort":"high"}`)
			}
			raw, err := encodeRequest(modelcore.DeepSeek, req)
			if err != nil {
				t.Fatal(err)
			}
			var wire struct {
				Response *struct {
					Type   string
					Schema *struct {
						Strict bool
						Name   string
						Schema json.RawMessage
					} `json:"json_schema"`
				} `json:"response_format"`
				Output *struct {
					Effort string
					Format responseFormat
				} `json:"output_config"`
			}
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatal(err)
			}
			if protocol == modelcore.AnthropicMessages {
				if wire.Response != nil || wire.Output == nil || wire.Output.Effort != "high" || wire.Output.Format.Type != "json_schema" || len(wire.Output.Format.Schema) == 0 {
					t.Fatalf("Messages format: %s", raw)
				}
			} else if wire.Output != nil || wire.Response == nil {
				t.Fatalf("Chat format: %s", raw)
			} else if mode == objectMode {
				if wire.Response.Type != "json_object" || wire.Response.Schema != nil || !strings.Contains(string(raw), "JSON object") {
					t.Fatalf("JSON object: %s", raw)
				}
			} else if wire.Response.Type != "json_schema" || wire.Response.Schema == nil || !wire.Response.Schema.Strict || wire.Response.Schema.Name == "" || len(wire.Response.Schema.Schema) == 0 {
				t.Fatalf("JSON Schema: %s", raw)
			}
		}
	}
}

func TestStructuredOutputGeneration(t *testing.T) {
	for _, tc := range []struct {
		name, mode, reply string
		status            int
		want              error
	}{
		{"object", objectMode, `{}`, 200, nil},
		{"array_in_object_mode", objectMode, `[]`, 200, modelcore.ErrInvalidResponse},
		{"provider_ignored_format", objectMode, "ok", 200, modelcore.ErrInvalidResponse},
		{"schema", schemaMode, `{"quantity":12}`, 200, nil},
		{"wrong_field_type", schemaMode, `{"quantity":"two"}`, 200, modelcore.ErrInvalidResponse},
		{"unsupported_remote_schema", schemaMode, "", 400, modelcore.ErrRequestRejected},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(tc.status)
				if tc.status == 200 {
					content, _ := json.Marshal(tc.reply)
					_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":%s},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", content)
				}
			}))
			defer server.Close()
			client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: server.URL, APIKey: "synthetic-key"}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			request := testRequest(modelcore.ChatCompletions)
			request.Parameters["response_format"] = json.RawMessage(tc.mode)
			_, err = client.Generate(t.Context(), request, nil)
			if !errors.Is(err, tc.want) || requests.Load() != 1 {
				t.Fatalf("got %v after %d requests", err, requests.Load())
			}
		})
	}
}
