package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/sandboxadapters/opensandbox"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/store/mysql"
)

// This opt-in test crosses the production application wiring, model HTTP/SSE,
// Eino, MySQL and real OpenSandbox boundaries. Only model responses are scripted.
// Supply an empty dedicated schema and a secured OpenSandbox workspace image.
func TestAgentApplicationIntegration(t *testing.T) {
	dsn := os.Getenv("ANTCDP_TEST_APP_MYSQL_DSN")
	endpoint := os.Getenv("ANTCDP_TEST_OPENSANDBOX_ENDPOINT")
	if dsn == "" || endpoint == "" {
		t.Skip("requires ANTCDP_TEST_APP_MYSQL_DSN and OpenSandbox integration environment")
	}
	cfg, err := driver.ParseDSN(dsn)
	if err != nil || cfg.Net != "tcp" || !strings.HasPrefix(cfg.DBName, "antcdp_test_") {
		t.Fatal("requires a dedicated empty antcdp_test_ TCP schema")
	}
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		t.Fatal(err)
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Minute)
	defer cancel()
	runtimeConfig := config.Runtime{DataDir: t.TempDir(), Server: config.Server{Listen: "127.0.0.1:8080", PublicURL: "http://127.0.0.1:8080"}}
	installer, err := install.New(ctx, runtimeConfig, mysql.Open)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = installer.Close() })
	_, err = installer.Install(ctx, install.Request{Database: config.Database{Host: host, Port: portNumber, Name: cfg.DBName, Username: cfg.User, Password: cfg.Passwd, TLSMode: "disabled"}, Site: install.Site{Name: "Agent integration", Timezone: "Asia/Shanghai"}, Founder: install.Founder{Username: "founder", DisplayName: "Integration", Password: "application-integration-password"}})
	if err != nil {
		t.Fatal("install:", err)
	}
	accounts := identity.New(func() (identity.Store, error) { return installer.Backend().(identity.Store), nil })
	login, err := accounts.Login(ctx, "founder", "application-integration-password", "", identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	raw := login.Token
	models := newModelService(installer, accounts)
	app, err := newAgentApplication(runtimeConfig.DataDir, installer, accounts, models, newWebAccessService(installer, accounts))
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	t.Cleanup(func() { cleanupApplicationSandboxes(t, db, installer, endpoint) })
	var calls atomic.Int32
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct{ Role, Content string }
			Stream   bool
		}
		if r.URL.Path != "/v1/chat/completions" || json.NewDecoder(r.Body).Decode(&request) != nil || !request.Stream {
			t.Error("invalid model HTTP request")
			http.Error(w, "invalid request", 400)
			return
		}
		step := calls.Add(1)
		if step > 1 {
			last := request.Messages[len(request.Messages)-1]
			if last.Role != "tool" || strings.Contains(last.Content, "Tool did not produce a confirmed successful result") {
				t.Errorf("step %d did not receive successful tool result: %s", step, last.Content)
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		tools := []struct{ name, args string }{
			{"write_file", `{"path":"verification.txt","content":"application-chain-ok"}`},
			{"read_file", `{"path":"verification.txt"}`},
			{"exec_command", `{"command":"cat verification.txt"}`},
			{"present", `{"files":[{"path":"verification.txt","description":"Integration result"}]}`},
		}
		if step <= int32(len(tools)) {
			tool := tools[step-1]
			arguments, _ := json.Marshal(tool.args)
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call-%d\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":%s}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", step, tool.name, arguments)
		} else {
			_, _ = io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"application-chain-ok\"},\"finish_reason\":\"stop\"}]}\n\n")
		}
		_, _ = io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":20}}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(modelServer.Close)
	providerConfig := m.ProviderCreate{Name: "Application fixture", Type: "ollama", Config: &m.Config{BaseURL: modelServer.URL + "/v1"}, Authentication: &m.AuthenticationWrite{Method: "none", Secret: m.SecretWrite{Operation: "clear"}}}
	remoteModel := "application-fixture"
	thinking := json.RawMessage(`{}`)
	realModel := os.Getenv("ANTCDP_TEST_DEEPSEEK_API_KEY") != ""
	if realModel {
		providerConfig.Type = "deepseek"
		providerConfig.Config.BaseURL = "https://api.deepseek.com"
		providerConfig.Authentication = &m.AuthenticationWrite{Method: "api_key", Secret: m.SecretWrite{Operation: "replace", Value: new(os.Getenv("ANTCDP_TEST_DEEPSEEK_API_KEY"))}}
		remoteModel = "deepseek-flash"
		thinking = json.RawMessage(`{"thinking":{"type":"enabled"},"reasoning_effort":"high"}`)
	}
	provider, err := models.CreateProvider(ctx, raw, providerConfig)
	if err != nil {
		t.Fatal("model provider:", err)
	}
	definition, err := models.CreateDefinition(ctx, raw, m.DefinitionCreate{ProviderID: strconv.FormatUint(provider.Data.(*m.Provider).ID, 10), RemoteModelID: remoteModel, Name: "Application fixture", Protocol: "chat_completions", Capabilities: m.Capabilities{Text: "supported", Tools: "supported", Image: "unsupported", Thinking: "supported", Streaming: "supported"}, ContextWindow: 131072, MaxOutput: 4096, Parameters: json.RawMessage(`{}`), Thinking: []m.ThinkingOption{{Key: "standard", Label: "Standard", Parameters: thinking}}})
	if err != nil {
		t.Fatal("model:", err)
	}
	connection, err := app.Sandboxes.GetConnection(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.Sandboxes.SaveConnection(ctx, raw, connection.Tag, cryptox.ID(), a.ConnectionWrite{Endpoint: endpoint, AccessMode: "server_proxy", Authentication: &m.AuthenticationWrite{Method: "api_key", Secret: m.SecretWrite{Operation: "replace", Value: new(os.Getenv("ANTCDP_TEST_OPENSANDBOX_API_KEY"))}}})
	if err != nil {
		t.Fatal("connection:", err)
	}
	created, err := app.Service.CreateDefinition(ctx, raw, cryptox.ID(), a.DefinitionCreate{Name: "Application agent", Mode: "service", ScopeKind: "platform", CloudEnvironment: &a.CloudEnvironment{Image: os.Getenv("ANTCDP_TEST_OPENSANDBOX_IMAGE"), CPU: 1000, Memory: 1024, Network: a.NetworkPolicy{DefaultAction: "allow"}}})
	if err != nil {
		t.Fatal("agent:", err)
	}
	agentID := created.Data.(*a.Definition).ID
	bindings, err := app.Service.GetModelBindings(ctx, raw, agentID)
	if err != nil {
		t.Fatal(err)
	}
	modelID := strconv.FormatUint(definition.Data.(*m.Definition).ID, 10)
	_, err = app.Service.PutModelBindings(ctx, raw, agentID, bindings.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: modelID, ThinkingOptions: []string{"standard"}, DefaultThinking: "standard", GenerationOverrides: json.RawMessage(`{}`)}}, DefaultModelID: modelID, DefaultThinking: "standard"})
	if err != nil {
		t.Fatal("model bindings:", err)
	}
	bindings, err = app.Service.GetToolBindings(ctx, raw, agentID)
	if err != nil {
		t.Fatal(err)
	}
	items := []a.ToolBindingWrite{}
	for _, name := range []string{"write_file", "read_file", "exec_command", "present"} {
		items = append(items, a.ToolBindingWrite{ToolKey: name, Policy: "allow", Constraints: json.RawMessage(`{}`)})
	}
	_, err = app.Service.PutToolBindings(ctx, raw, agentID, bindings.Tag, a.ToolBindingsWrite{Items: items})
	if err != nil {
		t.Fatal("tools:", err)
	}
	current, err := app.Service.GetDefinition(ctx, raw, agentID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.Service.PatchDefinition(ctx, raw, agentID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}})
	if err != nil {
		t.Fatal("enable:", err)
	}
	conversation, err := app.Service.CreateSession(ctx, raw, cryptox.ID(), a.SessionCreate{AgentID: strconv.FormatUint(agentID, 10)})
	if err != nil {
		t.Fatal("session:", err)
	}
	session := conversation.Data.(a.SessionDetail)
	workerCtx, stop := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- app.Runtime.Run(workerCtx) }()
	maintenanceDone := make(chan struct{})
	go func() {
		defer close(maintenanceDone)
		maintainAgentResources(workerCtx, installer, app, slog.New(slog.NewTextHandler(io.Discard, nil)))
	}()
	t.Cleanup(func() { stop(); <-done; <-maintenanceDone })
	_, err = app.Service.SubmitInput(ctx, raw, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []agentcore.TextBlock{{Type: "text", Text: "Perform these steps using the provided tools, in order: 1. write_file verification.txt with exact content application-chain-ok. 2. read_file verification.txt and verify it. 3. exec_command cat verification.txt. 4. present verification.txt as a retained artifact. Finally reply application-chain-ok. Do not ask questions or skip tools."}}, ExpectedHash: session.Selection.Hash})
	if err != nil {
		t.Fatal("submit:", err)
	}
	for {
		result, e := app.Service.GetSession(ctx, raw, session.Configuration.ID)
		if e != nil {
			t.Fatal("observe:", e)
		}
		view := result.Data.(a.SessionDetail).ViewState
		if view != nil && view.LatestResult != nil {
			if view.LatestResult.Status != "succeeded" {
				reason := ""
				if view.LatestResult.Reason != nil {
					reason = *view.LatestResult.Reason
				}
				t.Fatalf("run %s: %s", view.LatestResult.Status, reason)
			}
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("run timeout:", ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	if !realModel && calls.Load() != 5 {
		t.Fatalf("expected five model steps, got %d", calls.Load())
	}
	var artifacts int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM agent_artifact WHERE content_session_id=?", session.Configuration.ID).Scan(&artifacts); err != nil || artifacts != 1 {
		t.Fatalf("artifact count=%d: %v", artifacts, err)
	}
	var succeeded int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(DISTINCT tool_key) FROM agent_tool_call WHERE session_id=? AND status='succeeded'", session.Configuration.ID).Scan(&succeeded); err != nil || succeeded != 4 {
		t.Fatalf("successful tools=%d: %v", succeeded, err)
	}
}

func cleanupApplicationSandboxes(t *testing.T, db *sql.DB, installer *install.Service, endpoint string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	key, err := installer.SandboxControlKey()
	if err != nil {
		t.Error(err)
		return
	}
	installation, err := installer.SandboxInstallationID()
	if err != nil {
		t.Error(err)
		return
	}
	provider, err := (opensandbox.Factory{}).Open(ctx, sandboxcore.Connection{Endpoint: endpoint, APIKey: os.Getenv("ANTCDP_TEST_OPENSANDBOX_API_KEY"), ControlKey: key, AccessMode: "server_proxy"})
	if err != nil {
		t.Error(err)
		return
	}
	rows, err := db.QueryContext(ctx, "SELECT backend_generation,id,runtime_creation_token,runtime_id FROM cloud_computer WHERE runtime_id IS NOT NULL")
	if err != nil {
		t.Error(err)
		return
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var ref sandboxcore.ResourceRef
		ref.Ownership.InstallationID = installation
		if err = rows.Scan(&ref.BackendGeneration, &ref.Ownership.ComputerID, &ref.Ownership.CreationToken, &ref.RemoteID); err != nil {
			t.Error(err)
			continue
		}
		if ref.RemoteID == "" {
			continue
		}
		if err = provider.Terminate(ctx, ref); err != nil {
			t.Error("sandbox cleanup:", err)
			continue
		}
		observation, e := provider.Inspect(ctx, ref)
		if e != nil || observation.State != "absent" && observation.State != "terminated" {
			t.Error("sandbox cleanup unconfirmed", ref.RemoteID, e)
		}
	}
	if err = rows.Err(); err != nil {
		t.Error(err)
	}
}
