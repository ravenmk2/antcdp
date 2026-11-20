package mysql

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/eino"
	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func runtimeImageFiles(t *testing.T, f *agentIntegrationFixture) {
	var uploads, calls, inline atomic.Int32
	var reject atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/files" {
			uploads.Add(1)
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer func() { _ = r.MultipartForm.RemoveAll() }()
			file, _, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				return
			}
			data, _ := io.ReadAll(file)
			_ = file.Close()
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "file-image-fixture", "bytes": len(data), "expires_at": time.Now().Add(24 * time.Hour).Unix()})
			return
		}
		data, _ := io.ReadAll(r.Body)
		calls.Add(1)
		if bytes.Contains(data, []byte("base64,")) {
			inline.Add(1)
		}
		if bytes.Count(data, []byte(`"file_id"`)) > 24 {
			t.Error("request image budget exceeded")
		}
		if reject.Swap(false) {
			w.WriteHeader(400)
			_, _ = io.WriteString(w, `{"error":{"message":"file_id file-image-fixture not found"}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"observed image\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":10}}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	provider, err := f.Models.CreateProvider(f.Context, f.AdminToken, m.ProviderCreate{Name: "Image files test", Type: "deepseek", Config: &m.Config{BaseURL: server.URL}, Authentication: &m.AuthenticationWrite{Method: "api_key", Secret: m.SecretWrite{Operation: "replace", Value: new("image-test-key")}}})
	if err != nil {
		t.Fatal(err)
	}
	definition, err := f.Models.CreateDefinition(f.Context, f.AdminToken, m.DefinitionCreate{ProviderID: strconv.FormatUint(provider.Data.(*m.Provider).ID, 10), RemoteModelID: "vision", Name: "Image model", Protocol: "chat_completions", Capabilities: m.Capabilities{Text: "supported", Tools: "supported", Image: "supported", Thinking: "unsupported", Streaming: "supported"}, ContextWindow: 65536, MaxOutput: 4096})
	if err != nil {
		t.Fatal(err)
	}
	agent := runtimeTestAgentModel(t, f, definition.Data.(*m.Definition).ID)
	session := runtimeSession(t, f, agent.ID)
	client, err := modeladapters.NewClient(modeladapters.Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: server.URL, APIKey: "image-test-key"}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	old := f.Agents.RuntimeModels
	f.Agents.RuntimeModels = retryClientFactory{client}
	defer func() { f.Agents.RuntimeModels = old }()
	var picture bytes.Buffer
	if err = png.Encode(&picture, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	_, err = f.Agents.UploadImageAttachment(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID(), "fixture.png", strings.NewReader("ordinary file"))
	modelsExpectCode(t, err, "VALIDATION_FAILED")
	var firstPayload string
	run := func(images int) {
		t.Helper()
		var refs []core.FileRef
		for range images {
			uploaded, e := f.Agents.UploadImageAttachment(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID(), "fixture.png", bytes.NewReader(picture.Bytes()))
			if e != nil {
				t.Fatal(e)
			}
			refs = append(refs, core.FileRef{Kind: "attachment", ID: core.ID(uploaded.Data.(a.AttachmentView).ID)})
		}
		detail, e := f.Agents.GetSession(f.Context, f.AdminToken, session.Configuration.ID)
		if e != nil {
			t.Fatal(e)
		}
		input, e := f.Agents.SubmitInput(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "inspect"}}, Files: refs, ExpectedHash: detail.Data.(a.SessionDetail).Selection.Hash})
		if e != nil {
			t.Fatal(e)
		}
		claimed, e := claimCloudRoot(t, f, nil, core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session.Configuration.ID), InputID: core.ID(input.Data.(a.InputAccepted).InputID)}, Epoch: f.Agents.Epoch})
		if e != nil || !claimed.Claimed {
			t.Fatal("claim", e)
		}
		x := claimed.Execution
		hooks := &core.PersistentHooks{Execution: x, Prepare: f.Agents.PrepareStep, RepairImages: f.Agents.RepairImageFiles, Models: retryClientFactory{client}, Store: f.Agents, Estimate: func(modelcore.Request) (core.Budget, error) {
			return core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}, nil
		}}
		if e = (eino.Engine{}).Execute(f.Context, x.Ref, hooks); e != nil {
			t.Fatal("execute", e)
		}
		runtimeEnd(t, f, x)
	}
	run(10)
	if err = f.Store.db.GetContext(f.Context, &firstPayload, "SELECT payload FROM agent_event WHERE session_id=? AND event_type='input/message' ORDER BY seq LIMIT 1", session.Configuration.ID); err != nil {
		t.Fatal(err)
	}
	run(10)
	run(10)
	if uploads.Load() != 1 || calls.Load() != 3 || inline.Load() != 0 {
		t.Fatal("mapping was not reused", uploads.Load(), calls.Load(), inline.Load())
	}
	var offloads int
	if err = f.Store.db.GetContext(f.Context, &offloads, "SELECT COUNT(*) FROM agent_event WHERE session_id=? AND event_type='image/offload'", session.Configuration.ID); err != nil || offloads != 1 {
		t.Fatal("missing durable offload", offloads, err)
	}
	var after string
	if err = f.Store.db.GetContext(f.Context, &after, "SELECT payload FROM agent_event WHERE session_id=? AND event_type='input/message' ORDER BY seq LIMIT 1", session.Configuration.ID); err != nil || firstPayload != after {
		t.Fatal("original event changed", err)
	}
	// Exercise the actual engine/store repair contract: a failed call is settled,
	// a new step pins inline transport, and no normal retry rewrites its request.
	reject.Store(true)
	run(0)
	if calls.Load() != 5 || inline.Load() != 1 || uploads.Load() != 1 {
		t.Fatal("wrong repair", calls.Load(), inline.Load(), uploads.Load())
	}
	var failures int
	if err = f.Store.db.GetContext(f.Context, &failures, "SELECT COUNT(*) FROM agent_model_call WHERE session_id=? AND error_code='MODEL_IMAGE_FILE_REJECTED' AND status='failed'", session.Configuration.ID); err != nil || failures != 1 {
		t.Fatal("repair not auditable", err)
	}
	rows, err := f.Store.db.QueryxContext(f.Context, "SELECT request_config FROM agent_model_call WHERE session_id=? ORDER BY id", session.Configuration.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(raw, "image-test-key") || !strings.Contains(raw, `"images"`) {
			t.Fatal("bad frozen image projection", fmt.Sprint(len(raw)))
		}
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err = rows.Close(); err != nil {
		t.Fatal(err)
	}
	// A summary uses the same prepared images and must repair a stale ID without
	// overwriting the first model-call snapshot or discarding original history.
	if _, err = f.Store.db.ExecContext(f.Context, "UPDATE agent_model_file SET payload=JSON_REMOVE(payload,'$.inline_until') WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.scope'))=?", client.ImageFileScope()); err != nil {
		t.Fatal(err)
	}
	oldTokens, oldCompactor := f.Agents.Tokens, f.Agents.Compactor
	defer func() { f.Agents.Tokens = oldTokens; f.Agents.Compactor = oldCompactor }()
	f.Agents.Tokens = runtimeTokenCounter{}
	f.Agents.Compactor = &core.Compactor{Store: f.Agents, Models: f.Agents, Tokens: runtimeTokenCounter{}}
	reject.Store(true)
	accepted, err := f.Agents.CompactSession(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID())
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Agents.ProcessPendingCompactions(f.Context, 100); err != nil {
		t.Fatal(err)
	}
	op, err := f.Agents.GetOperation(f.Context, f.AdminToken, uint64(accepted.Data.(map[string]any)["id"].(core.ID)))
	if err != nil || op.Data.(map[string]any)["status"] != "succeeded" {
		t.Fatal("image summary repair failed", err)
	}
	if calls.Load() != 7 || inline.Load() != 2 {
		t.Fatal("summary repair did not execute once", calls.Load(), inline.Load())
	}
	var summaries int
	if err = f.Store.db.GetContext(f.Context, &summaries, "SELECT COUNT(*) FROM agent_model_call WHERE session_id=? AND purpose='compaction' AND attempt_no IN (1,2)", session.Configuration.ID); err != nil || summaries != 2 {
		t.Fatal("summary repair lost model-call evidence", summaries, err)
	}
}
