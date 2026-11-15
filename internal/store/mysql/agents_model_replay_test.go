package mysql

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentadapters/eino"
	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

// Ordered, keyless wire scenarios run the real adapter/engine/store. Each step
// may interrupt, reject, or complete a stream; unused/extra requests fail loudly.
type modelReplayStep func(http.ResponseWriter, []byte)

func modelReplayServer(t *testing.T, steps ...modelReplayStep) *httptest.Server {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int(calls.Add(1)) - 1
		body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil || n >= len(steps) {
			t.Error("unexpected replay request", n, err)
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		steps[n](w, body)
	}))
	t.Cleanup(func() {
		server.Close()
		if int(calls.Load()) != len(steps) {
			t.Errorf("replay consumed %d of %d requests", calls.Load(), len(steps))
		}
	})
	return server
}

func replayReply(w http.ResponseWriter, name, arguments, text string) {
	delta := map[string]any{"role": "assistant", "content": text}
	finish := "stop"
	if name != "" {
		finish = "tool_calls"
		delta["tool_calls"] = []any{map[string]any{"index": 0, "id": "call-" + name, "type": "function", "function": map[string]string{"name": name, "arguments": arguments}}}
	}
	raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
	_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", raw)
}

type outputReplayHooks struct {
	*core.PersistentHooks
	service        *a.Service
	effects, reads int
}

func (h *outputReplayHooks) InvokeTool(ctx context.Context, call core.PreparedToolCall) (core.ToolCompletion, error) {
	admission, err := h.service.PrepareDispatch(ctx, call.Ref, call.ID)
	if err != nil {
		return core.ToolCompletion{}, err
	}
	if admission.Kind != "execute" {
		return core.ToolCompletion{}, fmt.Errorf("unexpected admission %s", admission.Kind)
	}
	text := "BEGIN\n" + strings.Repeat("controlled log\n", 15000) + "\nRECOVERABLE-ERROR"
	if call.Spec.Key == "read_tool_output" {
		h.reads++
		text, err = h.service.ReadToolOutput(ctx, call.Ref, json.RawMessage(call.Call.Arguments))
	} else {
		h.effects++
	}
	if err != nil {
		return core.ToolCompletion{}, err
	}
	yes := true
	result, err := h.service.CompleteTool(ctx, call.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: text}})
	return result.Result, err
}

func runtimeOutputReplay(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	for _, interrupted := range []bool{false, true} {
		t.Run(fmt.Sprintf("interrupted_%t", interrupted), func(t *testing.T) {
			session := runtimeSession(t, f, agent)
			x := runtimeClaim(t, f, session.Configuration.ID, "read retained output after a tool")
			steps := []modelReplayStep{func(w http.ResponseWriter, _ []byte) { replayReply(w, "echo", `{}`, "") }}
			var retryBody []byte
			if interrupted {
				steps = append(steps, func(w http.ResponseWriter, body []byte) {
					retryBody = bytes.Clone(body)
					_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"discard me\"}}]}\n\n")
				})
			}
			steps = append(steps, func(w http.ResponseWriter, body []byte) {
				if interrupted && !bytes.Equal(retryBody, body) {
					t.Error("retry changed the frozen wire request")
				}
				var request struct {
					Messages []modelcore.Message `json:"messages"`
				}
				if json.Unmarshal(body, &request) != nil {
					t.Error("bad request")
					w.WriteHeader(400)
					return
				}
				joined := ""
				for _, m := range request.Messages {
					if m.Role == "tool" {
						joined += m.Content
					}
				}
				match := regexp.MustCompile(`file_id="([0-9]+)"`).FindStringSubmatch(joined)
				if len(match) != 2 || len(joined) > core.ToolOutputInlineBytes+1024 || !strings.Contains(joined, "RECOVERABLE-ERROR") {
					t.Error("missing bounded recoverable preview")
					w.WriteHeader(400)
					return
				}
				args, _ := json.Marshal(map[string]string{"file_id": match[1], "query": "RECOVERABLE-ERROR"})
				replayReply(w, "read_tool_output", string(args), "")
			}, func(w http.ResponseWriter, body []byte) {
				if !bytes.Contains(body, []byte("next_offset=")) || bytes.Contains(body, []byte("discard me")) {
					t.Error("read result absent or retry polluted context")
				}
				replayReply(w, "", "", "Verified the retained error.")
			})
			server := modelReplayServer(t, steps...)
			client, err := modeladapters.NewClient(modeladapters.Config{Provider: modelcore.DeepSeek, Protocol: x.Model.Protocol, BaseURL: server.URL, APIKey: "synthetic-replay"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			hooks := &outputReplayHooks{PersistentHooks: &core.PersistentHooks{Execution: x, Prepare: f.Agents.PrepareStep, Models: retryClientFactory{client}, Store: f.Agents, Estimate: func(modelcore.Request) (core.Budget, error) {
				return core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}, nil
			}}, service: f.Agents}
			if err = (eino.Engine{}).Execute(f.Context, x.Ref, hooks); err != nil {
				t.Fatal(err)
			}
			if hooks.effects != 1 || hooks.reads != 1 {
				t.Fatal("tool replay or omitted read", hooks.effects, hooks.reads)
			}
			runtimeEnd(t, f, x)
		})
	}
}
