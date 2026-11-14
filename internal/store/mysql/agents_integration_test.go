package mysql

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/password"
)

type agentIntegrationFixture struct {
	Store        *Store
	Context      context.Context
	Identity     *identity.Service
	AdminToken   string
	Models       *m.Service
	Agents       *a.Service
	Key          []byte
	Installation string
	Database     config.Database
}

// Extra independent module cases share this dedicated empty schema and fixture.
var agentIntegrationCases = []struct {
	Name string
	Run  func(*testing.T, *agentIntegrationFixture)
}{}

func newAgentIntegrationFixture(t *testing.T) *agentIntegrationFixture {
	t.Helper()
	return newAgentIntegrationFixtureFor(t, "ANTCDP_TEST_AGENTS_MYSQL_DSN")
}

func newAgentIntegrationFixtureFor(t *testing.T, variable string) *agentIntegrationFixture {
	t.Helper()
	dsn := os.Getenv(variable)
	if dsn == "" {
		t.Skip("set " + variable + " to an empty antcdp_test_ schema")
	}
	cfg, e := driver.ParseDSN(dsn)
	if e != nil || cfg == nil || cfg.Net != "tcp" || !strings.HasPrefix(cfg.DBName, "antcdp_test_") {
		t.Fatal("agents integration requires a dedicated TCP test schema")
	}
	host, port, e := splitTestAddress(cfg.Addr)
	if e != nil {
		t.Fatal(e)
	}
	database := config.Database{Host: host, Port: port, Name: cfg.DBName, Username: cfg.User, Password: cfg.Passwd, TLSMode: "disabled"}
	backend, e := Open(database, true)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = backend.Close() })
	store := backend.(*Store)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Minute)
	t.Cleanup(cancel)
	if e = store.Check(ctx, true); e != nil {
		t.Fatal("requires empty schema", e)
	}
	if e = store.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	key, installation := cryptox.Random(32), cryptox.ID()
	hash, e := password.Hash("agents-integration-password")
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Seed(ctx, install.Seed{InstallationID: installation, Fingerprint: cryptox.Fingerprint(key), Site: install.Site{Name: "智能体测试", Timezone: "Asia/Shanghai"}, Username: "founder", DisplayName: "管理员", PasswordHash: hash, Now: time.Now().UTC()}); e != nil {
		t.Fatal(e)
	}
	if e = store.Migrate(ctx); e != nil {
		t.Fatal("repeat migration", e)
	}
	ident := identity.New(func() (identity.Store, error) { return store, nil })
	login, e := ident.Login(ctx, "founder", "agents-integration-password", "", identity.Metadata{})
	if e != nil {
		t.Fatal(e)
	}
	tag := func(namespace string) func(string) string {
		return func(v string) string {
			mac := hmac.New(sha256.New, cryptox.Derive(key, namespace))
			_, _ = mac.Write([]byte(v))
			return hex.EncodeToString(mac.Sum(nil))
		}
	}
	models := &m.Service{Identity: ident, Store: func() (identity.Store, error) { return store, nil }, ETag: tag("models-etags"), Cipher: func(purpose, value string, seal bool) (string, error) {
		if seal {
			return cryptox.Encrypt(key, installation, purpose, value)
		}
		return cryptox.Decrypt(key, installation, purpose, value)
	}, ValidateParameters: func(string, string, json.RawMessage) error { return nil }}
	files, e := a.NewByteStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	agents := &a.Service{Identity: ident, Store: func() (identity.Store, error) { return store, nil }, ETag: tag("agents-etags"), Models: models, Files: files}
	models.ReferenceCheck = agents.ModelReferenceCheck
	return &agentIntegrationFixture{store, ctx, ident, login.Token, models, agents, key, installation, database}
}

func TestAgentsLifecycle(t *testing.T) {
	f := newAgentIntegrationFixture(t)
	t.Run("management", func(t *testing.T) { agentManagementLifecycle(t, f) })
	for _, test := range agentIntegrationCases {
		t.Run(test.Name, func(t *testing.T) { test.Run(t, f) })
	}
}

func agentManagementLifecycle(t *testing.T, f *agentIntegrationFixture) {
	t.Helper()
	ctx, raw, svc := f.Context, f.AdminToken, f.Agents
	provider, e := f.Models.CreateProvider(ctx, raw, m.ProviderCreate{Name: "Local agent models", Type: "ollama", Config: &m.Config{BaseURL: "http://127.0.0.1:11434/v1"}, Authentication: &m.AuthenticationWrite{Method: "none", Secret: m.SecretWrite{Operation: "clear"}}})
	if e != nil {
		t.Fatal(e)
	}
	model, e := f.Models.CreateDefinition(ctx, raw, m.DefinitionCreate{ProviderID: strconv.FormatUint(provider.Data.(*m.Provider).ID, 10), RemoteModelID: "agent-test", Name: "Agent test model", Protocol: "chat_completions", Capabilities: m.Capabilities{Text: "supported", Tools: "supported", Image: "unsupported", Thinking: "unsupported", Streaming: "supported"}, ContextWindow: 32768, MaxOutput: 4096, Parameters: json.RawMessage(`{}`), Thinking: []m.ThinkingOption{{Key: "standard", Label: "标准", Parameters: json.RawMessage(`{}`)}}})
	if e != nil {
		t.Fatal(e)
	}
	key := cryptox.ID()
	created, e := svc.CreateDefinition(ctx, raw, key, a.DefinitionCreate{Name: "文档助手", Mode: "interactive", ScopeKind: "platform"})
	if e != nil {
		t.Fatal(e)
	}
	agent := created.Data.(*a.Definition)
	_, e = svc.CheckActivation(ctx, raw, agent.ID)
	modelsExpectCode(t, e, "VALIDATION_FAILED")
	replayed, e := svc.CreateDefinition(ctx, raw, key, a.DefinitionCreate{Name: "文档助手", Mode: "interactive", ScopeKind: "platform"})
	if e != nil || !replayed.Replayed {
		t.Fatal("create replay", e)
	}
	_, e = svc.CreateDefinition(ctx, raw, key, a.DefinitionCreate{Name: "changed", Mode: "interactive", ScopeKind: "platform"})
	modelsExpectCode(t, e, "IDEMPOTENCY_CONFLICT")
	bindings, e := svc.GetModelBindings(ctx, raw, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	modelID := strconv.FormatUint(model.Data.(*m.Definition).ID, 10)
	bound, e := svc.PutModelBindings(ctx, raw, agent.ID, bindings.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: modelID, ThinkingOptions: []string{"standard"}, DefaultThinking: "standard", GenerationOverrides: json.RawMessage(`{}`)}}, DefaultModelID: modelID, DefaultThinking: "standard"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.PatchDefinition(ctx, raw, agent.ID, created.Tag, a.DefinitionPatch{Name: a.Field[string]{Set: true, Value: "stale"}})
	modelsExpectCode(t, e, "VERSION_CONFLICT")
	current, e := svc.GetDefinition(ctx, raw, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	checked, e := svc.CheckActivation(ctx, raw, agent.ID)
	if e != nil {
		t.Fatal("activation check", e)
	}
	if checked.Tag != current.Tag || checked.Data.(*a.Definition).Enabled {
		t.Fatal("activation check must preserve disabled state and configuration version")
	}
	enabled, e := svc.PatchDefinition(ctx, raw, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}})
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.PutModelBindings(ctx, raw, agent.ID, bound.Tag, a.ModelBindingsWrite{})
	modelsExpectCode(t, e, "VERSION_CONFLICT")
	options, e := svc.StartOptions(ctx, raw, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	if len(options.Data.(a.StartOptions).Models) != 1 {
		t.Fatal("missing model choices")
	}
	conversation, e := svc.CreateSession(ctx, raw, cryptox.ID(), a.SessionCreate{AgentID: strconv.FormatUint(agent.ID, 10)})
	if e != nil {
		t.Fatal(e)
	}
	session := conversation.Data.(a.SessionDetail)
	if session.Selection.Locked || session.State.ActiveRunID != nil || session.Configuration.ModelLockedAt != nil {
		t.Fatal("empty session started execution")
	}
	pref, e := svc.GetPreference(ctx, raw, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.PatchPreference(ctx, raw, session.Configuration.ID, pref.Tag, a.PreferencePatch{Pinned: a.Field[bool]{Set: true, Value: true}})
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.AdvanceView(ctx, raw, session.Configuration.ID, a.ViewStateWrite{ThroughSeq: "1"})
	modelsExpectCode(t, e, "VIEW_POSITION_INVALID")
	inputKey := cryptox.ID()
	input := a.InputCreate{Content: []agentcore.TextBlock{{Type: "text", Text: "核对运行生命周期"}}, ExpectedHash: session.Selection.Hash}
	accepted, e := svc.SubmitInput(ctx, raw, session.Configuration.ID, inputKey, input)
	if e != nil {
		t.Fatal("first input", e)
	}
	inputID := accepted.Data.(a.InputAccepted).InputID
	again, e := svc.SubmitInput(ctx, raw, session.Configuration.ID, inputKey, input)
	if e != nil || !again.Replayed {
		t.Fatal("input replay", e)
	}
	detail, e := svc.GetSession(ctx, raw, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	locked := detail.Data.(a.SessionDetail)
	if !locked.Selection.Locked || locked.Configuration.ModelLockedAt == nil || locked.State.PendingInputCount != 1 {
		t.Fatal("first input not atomically locked", locked.State)
	}
	configuration, e := svc.GetSessionConfiguration(ctx, raw, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.ArchiveSession(ctx, raw, session.Configuration.ID, configuration.Tag, cryptox.ID())
	if e != nil {
		t.Fatal("archive pending input", e)
	}
	item, e := svc.GetInput(ctx, raw, session.Configuration.ID, inputID)
	if e != nil || item.Data.(a.InputView).State != "cancelled" || item.Data.(a.InputView).Content[0].Text != input.Content[0].Text {
		t.Fatal("archive lost cancellation history", e)
	}
	_, e = svc.SubmitInput(ctx, raw, session.Configuration.ID, cryptox.ID(), input)
	modelsExpectCode(t, e, "SESSION_ARCHIVED")
	configuration, e = svc.GetSessionConfiguration(ctx, raw, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.RestoreSession(ctx, raw, session.Configuration.ID, configuration.Tag, cryptox.ID())
	if e != nil {
		t.Fatal(e)
	}
	detail, e = svc.GetSession(ctx, raw, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	restored := detail.Data.(a.SessionDetail)
	if restored.State.QueuePaused || restored.State.ActiveRunID != nil || restored.State.PendingInputCount != 0 {
		t.Fatal("restore revived old work", restored.State)
	}
	agentSimpleExecution(t, f, session.Configuration.ID)
	_, e = f.Models.DeleteDefinition(ctx, raw, model.Data.(*m.Definition).ID, model.Tag)
	modelsExpectCode(t, e, "RESOURCE_IN_USE")
	if e = f.Store.SchemaReady(ctx); e != nil {
		t.Fatal(e)
	}
	t.Run("ownership_scope", func(t *testing.T) { agentScopeLifecycle(t, f, agent.ID) })
	if _, e = svc.DeleteDefinition(ctx, raw, agent.ID, enabled.Tag, cryptox.ID()); e != nil {
		t.Fatal(e)
	}
	if _, e = svc.GetSession(ctx, raw, session.Configuration.ID); e != nil {
		t.Fatalf("soft deletion hid existing conversation: %v", e)
	}
}

func agentScopeLifecycle(t *testing.T, f *agentIntegrationFixture, sourceAgent uint64) {
	t.Helper()
	ctx, admin, svc := f.Context, f.AdminToken, f.Agents
	meta := identity.Metadata{}
	collab := &collaboration.Service{Identity: f.Identity}
	auth, err := f.Identity.Current(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	scope, _, err := collab.Create(ctx, admin, collaboration.Project, collaboration.Write{Code: "agent-scope", Name: new("Agent scope"), Admins: []string{strconv.FormatUint(auth.User.ID, 10)}}, meta)
	if err != nil {
		t.Fatal(err)
	}
	created, err := svc.CreateDefinition(ctx, admin, cryptox.ID(), a.DefinitionCreate{Name: "Scoped agent", Mode: "interactive", ScopeKind: "project", ScopeID: new(strconv.FormatUint(scope.ID, 10))})
	if err != nil {
		t.Fatal(err)
	}
	agentID := created.Data.(*a.Definition).ID
	source, err := svc.GetModelBindings(ctx, admin, sourceAgent)
	if err != nil {
		t.Fatal(err)
	}
	items := source.Data.(map[string]any)["items"].([]a.ModelBinding)
	binding, err := svc.GetModelBindings(ctx, admin, agentID)
	if err != nil {
		t.Fatal(err)
	}
	modelID := strconv.FormatUint(items[0].ModelID, 10)
	_, err = svc.PutModelBindings(ctx, admin, agentID, binding.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: modelID, ThinkingOptions: items[0].ThinkingOptions, DefaultThinking: items[0].DefaultThinking, GenerationOverrides: items[0].GenerationOverrides}}, DefaultModelID: modelID, DefaultThinking: items[0].DefaultThinking})
	if err != nil {
		t.Fatal(err)
	}
	current, err := svc.GetDefinition(ctx, admin, agentID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.PatchDefinition(ctx, admin, agentID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}})
	if err != nil {
		t.Fatal(err)
	}
	const initial = "agent-scope-initial-password"
	const next = "agent-scope-member-password"
	member, _, err := f.Identity.CreateUser(ctx, admin, identity.CreateRequest{Username: "agent_scope_user", DisplayName: "Scope member", Role: "user", Password: initial}, meta)
	if err != nil {
		t.Fatal(err)
	}
	login, err := f.Identity.Login(ctx, member.Username, initial, "", meta)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Identity.ChangePassword(ctx, login.Token, initial, next, meta); err != nil {
		t.Fatal(err)
	}
	login, err = f.Identity.Login(ctx, member.Username, next, "", meta)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.GetCatalog(ctx, login.Token, agentID)
	modelsExpectCode(t, err, "NOT_FOUND")
	if _, err = collab.Member(ctx, admin, collaboration.Project, scope.ID, member.ID, "member", scope.MembershipETag, "add", meta); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.GetCatalog(ctx, login.Token, agentID); err != nil {
		t.Fatal(err)
	}
	conversation, err := svc.CreateSession(ctx, login.Token, cryptox.ID(), a.SessionCreate{AgentID: strconv.FormatUint(agentID, 10)})
	if err != nil {
		t.Fatal(err)
	}
	session := conversation.Data.(a.SessionDetail)
	if session.Configuration.ProjectID != nil {
		t.Fatal("ownership automatically selected project context")
	}
	_, err = svc.GetSession(ctx, admin, session.Configuration.ID)
	modelsExpectCode(t, err, "NOT_FOUND")
	_, err = svc.PatchDefinition(ctx, login.Token, agentID, created.Tag, a.DefinitionPatch{Name: a.Field[string]{Set: true, Value: "forbidden"}})
	modelsExpectCode(t, err, "FORBIDDEN")
}

func agentSimpleExecution(t *testing.T, f *agentIntegrationFixture, session uint64) {
	t.Helper()
	ctx, raw, svc := f.Context, f.AdminToken, f.Agents
	accepted, e := svc.SubmitInput(ctx, raw, session, cryptox.ID(), a.InputCreate{Content: []agentcore.TextBlock{{Type: "text", Text: "执行一个完整回合"}}})
	if e != nil {
		t.Fatal(e)
	}
	claim, e := svc.ClaimRoot(ctx, agentcore.ClaimRequest{Candidate: agentcore.Candidate{SessionID: agentcore.ID(session), InputID: agentcore.ID(accepted.Data.(a.InputAccepted).InputID)}, Epoch: "agent-test-epoch"})
	if e != nil || !claim.Claimed {
		t.Fatal("claim", e)
	}
	step, e := svc.PrepareStep(ctx, claim.Execution, 1)
	if e != nil {
		t.Fatal("prepare", e)
	}
	if len(step.Request.Messages) < 2 {
		t.Fatal("missing committed input")
	}
	hash, e := agentcore.ContentHash(step.Request)
	if e != nil {
		t.Fatal(e)
	}
	draft := agentcore.AttemptDraft{Step: step, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: time.Now().UTC().Add(time.Minute), Reservation: agentcore.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}}
	frozen, e := svc.FreezeAttempt(ctx, claim.Execution.Ref, draft)
	if e != nil {
		t.Fatal("freeze", e)
	}
	_, e = svc.FreezeAttempt(ctx, claim.Execution.Ref, draft)
	modelsExpectCode(t, e, "ATTEMPT_ALREADY_STARTED")
	inTokens, outTokens := int64(20), int64(8)
	outcome := agentcore.AttemptResult{Permit: frozen.Permit, Outcome: agentcore.AttemptOutcome{Response: modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "执行完成。"}, Usage: modelcore.Usage{InputTokens: &inTokens, OutputTokens: &outTokens, NormalizationVersion: "test-v1"}, FinishReason: "stop", ReturnedModel: "agent-test"}}}
	commit, e := svc.CompleteAttempt(ctx, claim.Execution.Ref, outcome)
	if e != nil || commit.AssistantSeq == 0 {
		t.Fatal("complete", e)
	}
	replayed, e := svc.CompleteAttempt(ctx, claim.Execution.Ref, outcome)
	if e != nil || replayed.AssistantSeq != commit.AssistantSeq {
		t.Fatal("attempt replay", e)
	}
	ended, e := svc.EndRoot(ctx, claim.Execution.Ref, agentcore.RunEnd{Status: agentcore.Succeeded})
	if e != nil || len(ended.Ranges) == 0 {
		t.Fatal("end", e)
	}
	detail, e := svc.GetSession(ctx, raw, session)
	if e != nil {
		t.Fatal(e)
	}
	if detail.Data.(a.SessionDetail).State.ActiveRunID != nil {
		t.Fatal("active slot leaked")
	}
	view := detail.Data.(a.SessionDetail).ViewState
	if view.UnviewedCount != 1 {
		t.Fatal("missing result attention", view)
	}
}
