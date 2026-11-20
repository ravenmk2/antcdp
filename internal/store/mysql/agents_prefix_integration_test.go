package mysql

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentadapters/eino"
	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func runtimeThinkingPrefix(t *testing.T, f *agentIntegrationFixture) {
	var mu sync.Mutex
	var requests [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		mu.Lock()
		requests = append(requests, raw)
		n := len(requests)
		mu.Unlock()
		if bytes.Contains(raw, []byte("prefix_digest")) {
			t.Error("local metadata leaked to provider")
		}
		if n == 2 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		frame := func(value any) {
			encoded, marshalErr := json.Marshal(value)
			if marshalErr != nil {
				t.Error(marshalErr)
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", encoded)
		}
		frame(map[string]any{"type": "message_start", "message": map[string]any{"id": fmt.Sprint("msg", n), "type": "message", "role": "assistant", "model": "prefix-model", "content": []any{}, "usage": map[string]int{"input_tokens": 10, "output_tokens": 1}}})
		if n == 3 {
			frame(map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]string{"type": "text", "text": "discarded interrupted fragment"}})
			return
		}
		blocks := []any{map[string]string{"type": "thinking", "thinking": "persisted reasoning", "signature": fmt.Sprint("signature-", n)}, map[string]string{"type": "redacted_thinking", "data": fmt.Sprint("redacted-", n)}}
		stop := "end_turn"
		if n == 1 {
			stop = "tool_use"
			blocks = append(blocks, map[string]any{"type": "tool_use", "id": "once", "name": "echo", "input": map[string]any{}})
		} else {
			blocks = append(blocks, map[string]string{"type": "text", "text": strings.Repeat("completed content ", 100)})
		}
		for index, block := range blocks {
			frame(map[string]any{"type": "content_block_start", "index": index, "content_block": block})
			frame(map[string]any{"type": "content_block_stop", "index": index})
		}
		frame(map[string]any{"type": "message_delta", "delta": map[string]string{"stop_reason": stop}, "usage": map[string]int{"output_tokens": 10}})
		frame(map[string]string{"type": "message_stop"})
	}))
	defer server.Close()
	provider, err := f.Models.CreateProvider(f.Context, f.AdminToken, m.ProviderCreate{Name: "Prefix test provider", Type: "deepseek", Config: &m.Config{BaseURL: server.URL}, Authentication: &m.AuthenticationWrite{Method: "api_key", Secret: m.SecretWrite{Operation: "replace", Value: new("synthetic-key")}}})
	if err != nil {
		t.Fatal(err)
	}
	definition, err := f.Models.CreateDefinition(f.Context, f.AdminToken, m.DefinitionCreate{ProviderID: strconv.FormatUint(provider.Data.(*m.Provider).ID, 10), RemoteModelID: "prefix-model", Name: "Prefix model", Protocol: "anthropic_messages", Capabilities: m.Capabilities{Text: "supported", Tools: "supported", Image: "unsupported", Thinking: "unsupported", Streaming: "supported"}, ContextWindow: 32768, MaxOutput: 4096})
	if err != nil {
		t.Fatal(err)
	}
	agent := runtimeTestAgentModel(t, f, definition.Data.(*m.Definition).ID)
	session := runtimeSession(t, f, agent.ID)
	client, err := modeladapters.NewClient(modeladapters.Config{Provider: modelcore.DeepSeek, Protocol: modelcore.AnthropicMessages, BaseURL: server.URL, APIKey: "synthetic-key"}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	run := func() {
		t.Helper()
		x := runtimeClaim(t, f, session.Configuration.ID, "continue with durable context")
		hooks := &retryStoreHooks{PersistentHooks: &core.PersistentHooks{Execution: x, Prepare: f.Agents.PrepareStep, Models: retryClientFactory{client}, Store: f.Agents, Estimate: func(modelcore.Request) (core.Budget, error) {
			return core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}, nil
		}}, service: f.Agents}
		if runErr := (eino.Engine{}).Execute(f.Context, x.Ref, hooks); runErr != nil {
			t.Fatal(runErr)
		}
		runtimeEnd(t, f, x)
	}
	run()
	var originalHash, originalPayload string
	if err = f.Store.db.QueryRowxContext(f.Context, "SELECT HEX(payload_sha256), payload FROM agent_event WHERE session_id=? AND event_type='assistant/message' ORDER BY seq LIMIT 1", session.Configuration.ID).Scan(&originalHash, &originalPayload); err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Model  modelcore.Message `json:"model"`
		Public json.RawMessage   `json:"public"`
	}
	if json.Unmarshal([]byte(originalPayload), &envelope) != nil || envelope.Model.PrefixDigest == "" || !bytes.Contains(envelope.Model.Native, []byte("signature-1")) || bytes.Contains(envelope.Public, []byte("prefix_digest")) {
		t.Fatal("prefix metadata or raw native event not persisted correctly")
	}
	run() // A new turn reconstructs native messages and metadata from MySQL.
	current, err := f.Agents.GetDefinition(f.Context, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Agents.PatchDefinition(f.Context, f.AdminToken, agent.ID, current.Tag, a.DefinitionPatch{SystemPrompt: a.Field[string]{Set: true, Value: "Changed system instructions"}}); err != nil {
		t.Fatal(err)
	}
	run()
	oldModels, oldCounter, oldCompactor := f.Agents.RuntimeModels, f.Agents.Tokens, f.Agents.Compactor
	t.Cleanup(func() {
		f.Agents.RuntimeModels, f.Agents.Tokens, f.Agents.Compactor = oldModels, oldCounter, oldCompactor
	})
	f.Agents.RuntimeModels = &runtimeSummaryModel{text: "Earlier verified work summarized."}
	f.Agents.Tokens = runtimeTokenCounter{}
	f.Agents.Compactor = &core.Compactor{Store: f.Agents, Models: f.Agents, Tokens: runtimeTokenCounter{}}
	accepted, err := f.Agents.CompactSession(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID())
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Agents.ProcessPendingCompactions(f.Context, 100); err != nil {
		t.Fatal(err)
	}
	op, err := f.Agents.GetOperation(f.Context, f.AdminToken, uint64(accepted.Data.(map[string]any)["id"].(core.ID)))
	if err != nil || op.Data.(map[string]any)["status"] != "succeeded" {
		t.Fatal("compaction failed", err)
	}
	run()
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 7 || !bytes.Equal(requests[1], requests[2]) || !bytes.Equal(requests[2], requests[3]) {
		t.Fatal("retry wire changed or extra model attempt", len(requests))
	}
	for _, n := range []int{1, 4} {
		if !bytes.Contains(requests[4], []byte(fmt.Sprint("signature-", n))) {
			t.Fatal("unchanged prefix lost signed thinking across runs", n)
		}
	}
	for _, n := range []int{1, 4, 5} {
		if bytes.Contains(requests[5], []byte(fmt.Sprint("signature-", n))) {
			t.Fatal("changed system retained stale thinking", n)
		}
	}
	for _, n := range []int{1, 4, 5, 6} {
		if bytes.Contains(requests[6], []byte(fmt.Sprint("signature-", n))) || bytes.Contains(requests[6], []byte(fmt.Sprint("redacted-", n))) {
			t.Fatal("compacted prefix retained stale thinking", n)
		}
	}
	var finalHash string
	if err = f.Store.db.GetContext(f.Context, &finalHash, "SELECT HEX(payload_sha256) FROM agent_event WHERE session_id=? AND event_type='assistant/message' ORDER BY seq LIMIT 1", session.Configuration.ID); err != nil || finalHash != originalHash {
		t.Fatal("original history was rewritten", err)
	}
}
