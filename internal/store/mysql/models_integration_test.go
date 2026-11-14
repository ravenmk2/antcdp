package mysql

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/config"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/filestore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/password"
	"github.com/ravenmk2/antcdp/internal/server"
	"github.com/ravenmk2/antcdp/web"
)

// This test uses a separate empty database and never deletes an existing schema.
// Network probes are deterministic fakes; persistence, locking and encryption are real.
func TestModelsLifecycle(t *testing.T) {
	dsn := os.Getenv("ANTCDP_TEST_MODELS_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set ANTCDP_TEST_MODELS_MYSQL_DSN to a dedicated empty antcdp_test_ schema")
	}
	cfg, err := driver.ParseDSN(dsn)
	if err != nil || cfg == nil || cfg.Net != "tcp" || !strings.HasPrefix(cfg.DBName, "antcdp_test_") {
		t.Fatal("models integration requires a dedicated TCP test schema")
	}
	host, port, err := splitTestAddress(cfg.Addr)
	if err != nil {
		t.Fatal(err)
	}
	backend, err := Open(config.Database{Host: host, Port: port, Name: cfg.DBName, Username: cfg.User, Password: cfg.Passwd, TLSMode: "disabled"}, true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	s := backend.(*Store)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err = s.Check(ctx, true); err != nil {
		t.Fatal("requires empty schema", err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	key, installation := cryptox.Random(32), cryptox.ID()
	hash, err := password.Hash("models-integration-password")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Seed(ctx, install.Seed{InstallationID: installation, Fingerprint: cryptox.Fingerprint(key), Site: install.Site{Name: "模型测试", Timezone: "Asia/Shanghai"}, Username: "founder", DisplayName: "管理员", PasswordHash: hash, Now: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal("repeated migration", err)
	}
	var count int
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM `user` WHERE username='founder'"); err != nil || count != 1 {
		t.Fatal("repeated migration changed founder", count, err)
	}
	ident := identity.New(func() (identity.Store, error) { return s, nil })
	login, err := ident.Login(ctx, "founder", "models-integration-password", "", identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	raw := login.Token
	svc := &m.Service{Identity: ident, Store: func() (identity.Store, error) { return s, nil }, ETag: func(v string) string {
		mac := hmac.New(sha256.New, cryptox.Derive(key, "models-etags"))
		mac.Write([]byte(v))
		return hex.EncodeToString(mac.Sum(nil))
	}, Cipher: func(purpose, value string, seal bool) (string, error) {
		if seal {
			return cryptox.Encrypt(key, installation, purpose, value)
		}
		return cryptox.Decrypt(key, installation, purpose, value)
	}, ValidateParameters: func(_, _ string, _ json.RawMessage) error { return nil }}
	svc.ThinkingCatalog = func(kind, protocol string) []m.ThinkingOption {
		return modeladapters.NewRegistry().ThinkingOptions(modelcore.ProviderType(kind), modelcore.Protocol(protocol))
	}
	ctx = m.WithMetadata(ctx, identity.Metadata{RequestID: "models-integration", IP: "192.0.2.12"})
	secret := "only-in-encrypted-storage"
	input := m.ProviderCreate{Name: "DeepSeek primary", Type: "deepseek", Config: &m.Config{BaseURL: "https://models.example.test/v1"}, Authentication: &m.AuthenticationWrite{Method: "api_key", Secret: m.SecretWrite{Operation: "replace", Value: &secret}}}
	created, err := svc.CreateProvider(ctx, raw, input)
	if err != nil {
		t.Fatal(err)
	}
	provider := created.Data.(*m.Provider)
	if created.Status != 201 || created.Auth == nil {
		t.Fatal("create response")
	}
	_, err = svc.CreateProvider(ctx, raw, input)
	modelsExpectCode(t, err, "NAME_CONFLICT")
	var ciphertext string
	if err = s.db.GetContext(ctx, &ciphertext, "SELECT secret_ciphertext FROM model_provider WHERE id=?", provider.ID); err != nil || ciphertext == secret {
		t.Fatal("credential storage", err)
	}
	if _, err = cryptox.Decrypt(key, installation, fmt.Sprintf("models/provider/%d/authentication", provider.ID+1), ciphertext); err == nil {
		t.Fatal("credential binding")
	}
	icon := "qwen"
	patched, err := svc.PatchProvider(ctx, raw, provider.ID, created.Tag, m.ProviderPatch{IconKey: m.Field[string]{Set: true, Value: icon}})
	if err != nil || patched.Data.(*m.Provider).IconKey == nil || *patched.Data.(*m.Provider).IconKey != icon {
		t.Fatal("icon update", err)
	}
	_, err = svc.PatchProvider(ctx, raw, provider.ID, created.Tag, m.ProviderPatch{Name: m.Field[string]{Set: true, Value: "stale"}})
	modelsExpectCode(t, err, "VERSION_CONFLICT")
	_, err = svc.PatchProvider(ctx, raw, provider.ID, patched.Tag, m.ProviderPatch{IconKey: m.Field[string]{Set: true, Value: "invalid"}})
	modelsExpectCode(t, err, "VALIDATION_FAILED")
	definition, err := svc.CreateDefinition(ctx, raw, m.DefinitionCreate{ProviderID: strconv.FormatUint(provider.ID, 10), RemoteModelID: "remote-model", Name: "Model", Protocol: "chat_completions", IconKey: &icon, Capabilities: m.Capabilities{Text: "supported", Image: "unsupported", Tools: "supported", Streaming: "unsupported", Thinking: "unsupported"}, ContextWindow: 8192, MaxOutput: 1024, Parameters: json.RawMessage(`{}`), Thinking: []m.ThinkingOption{{Key: "standard", Label: "标准", Parameters: json.RawMessage(`{}`)}}})
	if err != nil {
		t.Fatal(err)
	}
	model := definition.Data.(*m.Definition)
	if model.IconKey == nil || *model.IconKey != icon {
		t.Fatal("model icon")
	}
	var calls atomic.Int32
	success := json.RawMessage(`{"diagnostic":{"status":"succeeded","checks":[{"name":"generation","status":"succeeded"}],"capabilities":{"text_input":"supported","image_input":"unknown","tool_calling":"unknown","streaming":"unknown","thinking":"unknown"}}}`)
	svc.Probe = func(c context.Context, request m.ProbeRequest) (json.RawMessage, error) {
		calls.Add(1)
		if request.Secret != secret {
			t.Error("secret not decrypted")
		}
		if deadline, ok := c.Deadline(); !ok || time.Until(deadline) > 120*time.Second {
			t.Error("unbounded request")
		}
		if request.Kind != "model_probe" {
			if deadline, ok := c.Deadline(); !ok || time.Until(deadline) > 30*time.Second {
				t.Error("connection request exceeds 30 seconds")
			}
		}
		if request.Kind == "model_discovery" {
			return json.RawMessage(`{"models":[],"truncated":false}`), nil
		}
		return success, nil
	}
	result, err := svc.TestModel(ctx, raw, model.ID, definition.Tag, []string{"generation"})
	if err != nil || result.Status != 200 || !strings.Contains(string(result.Data.(json.RawMessage)), `"succeeded"`) {
		t.Fatal("sync result", err)
	}
	if calls.Load() != 1 {
		t.Fatal("unexpected retries")
	}
	// Tests neither alter editing versions nor persist diagnostics.
	latest, err := svc.GetDefinition(ctx, raw, model.ID)
	if err != nil || latest.Tag != definition.Tag {
		t.Fatal("test changed model", err)
	}
	if _, err = svc.DiscoverModels(ctx, raw, provider.ID, patched.Tag); err != nil {
		t.Fatal("discovery", err)
	}
	entered := make(chan struct{})
	done := make(chan error, 1)
	requestCtx, stop := context.WithCancel(ctx)
	svc.Probe = func(c context.Context, _ m.ProbeRequest) (json.RawMessage, error) {
		close(entered)
		<-c.Done()
		return nil, c.Err()
	}
	go func() {
		_, e := svc.TestModel(requestCtx, raw, model.ID, definition.Tag, []string{"generation"})
		done <- e
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("test did not start")
	}
	_, err = svc.TestProvider(ctx, raw, provider.ID, patched.Tag)
	modelsExpectCode(t, err, "MODEL_TEST_IN_PROGRESS")
	_, err = svc.PatchProvider(ctx, raw, provider.ID, patched.Tag, m.ProviderPatch{Name: m.Field[string]{Set: true, Value: "busy"}})
	modelsExpectCode(t, err, "MODEL_TEST_IN_PROGRESS")
	_, err = svc.DeleteDefinition(ctx, raw, model.ID, definition.Tag)
	modelsExpectCode(t, err, "MODEL_TEST_IN_PROGRESS")
	stop()
	select {
	case err = <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel blocked")
	}
	// A caller deadline terminates the remote wait and releases the same gate.
	svc.Probe = func(c context.Context, _ m.ProbeRequest) (json.RawMessage, error) {
		<-c.Done()
		return nil, c.Err()
	}
	timeoutCtx, timeoutCancel := context.WithTimeout(ctx, 200*time.Millisecond)
	_, err = svc.TestProvider(timeoutCtx, raw, provider.ID, patched.Tag)
	timeoutCancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("deadline did not cancel test", err)
	}
	svc.Probe = func(context.Context, m.ProbeRequest) (json.RawMessage, error) {
		return nil, errors.New("secret remote body")
	}
	result, err = svc.TestModel(ctx, raw, model.ID, definition.Tag, []string{"generation"})
	if err != nil || strings.Contains(string(result.Data.(json.RawMessage)), "secret remote body") || !strings.Contains(string(result.Data.(json.RawMessage)), `"failed"`) {
		t.Fatal("failure projection", err)
	}
	svc.ReferenceCheck = func(context.Context, identity.Tx, string, uint64) (bool, error) { return true, nil }
	_, err = svc.DeleteDefinition(ctx, raw, model.ID, definition.Tag)
	modelsExpectCode(t, err, "RESOURCE_IN_USE")
	svc.ReferenceCheck = nil
	if _, err = svc.DeleteDefinition(ctx, raw, model.ID, definition.Tag); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.DeleteProvider(ctx, raw, provider.ID, patched.Tag); err != nil {
		t.Fatal(err)
	}
	if err = s.SchemaReady(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('model_operation','model_command_receipt')"); err != nil || count != 0 {
		t.Fatal("removed tables remain", err)
	}
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM audit_event WHERE action='model_provider.create'"); err != nil || count == 0 {
		t.Fatal("audit lost", err)
	}
	svc.Probe = func(context.Context, m.ProbeRequest) (json.RawMessage, error) { return success, nil }
	modelsHTTPLifecycle(t, ctx, config.Database{Host: host, Port: port, Name: cfg.DBName, Username: cfg.User, Password: cfg.Passwd, TLSMode: "disabled"}, key, installation, svc)
}

func modelsHTTPLifecycle(t *testing.T, ctx context.Context, database config.Database, key []byte, installation string, svc *m.Service) {
	t.Helper()
	runtime := config.Runtime{DataDir: t.TempDir(), Server: config.Server{Listen: "127.0.0.1:0", PublicURL: "http://antcdp.test", TrustedProxies: []string{}}}
	if err := filestore.EnsurePrivateDir(runtime.DataDir); err != nil {
		t.Fatal(err)
	}
	encrypted, err := cryptox.Encrypt(key, installation, "database.password", database.Password)
	if err != nil {
		t.Fatal(err)
	}
	database.Password = encrypted
	if err = config.Write(filepath.Join(runtime.DataDir, "config.yaml"), config.File{SchemaVersion: 1, InstallationID: installation, Server: runtime.Server, Database: database}); err != nil {
		t.Fatal(err)
	}
	if err = filestore.AtomicWrite(filepath.Join(runtime.DataDir, "master.key"), key); err != nil {
		t.Fatal(err)
	}
	marker, err := json.Marshal(map[string]any{"version": 1, "installation_id": installation, "completed_at": time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if err = filestore.AtomicWrite(filepath.Join(runtime.DataDir, "installation.json"), marker); err != nil {
		t.Fatal(err)
	}
	installer, err := install.New(ctx, runtime, Open)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = installer.Close() }()
	if installer.Status(ctx).State != install.Ready {
		t.Fatal("HTTP fixture did not load the installation")
	}
	h := server.New(server.Options{Runtime: runtime, Installer: installer, Identity: svc.Identity, Models: svc, Static: web.DistFS(), Version: "models-integration"})
	admin := clientFor(h, 31)
	admin.login(t, "founder", "models-integration-password")
	secret := "only-in-encrypted-storage"
	providerBody := map[string]any{"name": "HTTP provider", "provider_type": "deepseek", "config": map[string]any{"base_url": "https://http-models.example.test"}, "authentication": map[string]any{"auth_method": "api_key", "secret": map[string]any{"operation": "replace", "value": secret}}}
	created := testData(admin.call(t, "POST", "/admin/models/providers", providerBody, 201, nil))
	providerID := created["id"].(string)
	providerPath := "/admin/models/providers/" + providerID
	firstTag := admin.last.Header().Get("ETag")
	if firstTag == "" || admin.last.Header().Get("Location") != "/api/v1"+providerPath || strings.Contains(admin.last.Body.String(), secret) || strings.Contains(admin.last.Body.String(), "secret_ciphertext") {
		t.Fatal("provider DTO or response headers")
	}
	admin.call(t, "POST", "/admin/models/providers", providerBody, 409, nil)
	admin.call(t, "GET", providerPath, nil, 200, nil)
	if admin.last.Header().Get("ETag") != firstTag {
		t.Fatal("GET ETag differs")
	}
	admin.call(t, "PATCH", providerPath, map[string]any{"description": "HTTP edited"}, 200, map[string]string{"If-Match": firstTag})
	tag := admin.last.Header().Get("ETag")
	expectCode(t, admin.call(t, "PATCH", providerPath, map[string]any{"description": "stale draft"}, 412, map[string]string{"If-Match": firstTag}), "VERSION_CONFLICT")
	for _, operation := range []string{"keep", "clear", "replace"} {
		value := map[string]any{"operation": operation}
		if operation == "replace" {
			value["value"] = secret
		}
		auth := testData(admin.call(t, "PUT", providerPath+"/authentication", map[string]any{"auth_method": "api_key", "secret": value}, 200, map[string]string{"If-Match": tag}))
		if auth["authentication"].(map[string]any)["has_secret"] != (operation != "clear") || strings.Contains(admin.last.Body.String(), secret) {
			t.Fatal("HTTP authentication DTO")
		}
		tag = admin.last.Header().Get("ETag")
		if operation == "clear" {
			expectCode(t, admin.call(t, "POST", providerPath+"/test", map[string]any{"level": "connectivity"}, 409, map[string]string{"If-Match": tag}), "MODEL_UNAVAILABLE")
		}
	}
	modelBody := map[string]any{"provider_id": providerID, "name": "HTTP model", "model_id": "http-model", "protocol": "chat_completions", "declared_capabilities": m.Capabilities{Text: "supported", Image: "unsupported", Tools: "unsupported", Streaming: "unsupported", Thinking: "unsupported"}, "context_window": 8192, "max_output_tokens": 1024, "default_parameters": map[string]any{}, "thinking_levels": []string{"none", "high"}}
	model := testData(admin.call(t, "POST", "/admin/models/definitions", modelBody, 201, nil))
	if model["model_id"] != "http-model" || model["remote_model_id"] != nil {
		t.Fatal("model ID contract", model)
	}
	options := model["thinking_options"].([]any)
	if len(options) != 2 || options[0].(map[string]any)["label"] != "关闭" || options[1].(map[string]any)["key"] != "high" {
		t.Fatal("resolved thinking options", options)
	}
	modelPath := "/admin/models/definitions/" + model["id"].(string)
	modelTag := admin.last.Header().Get("ETag")
	admin.call(t, "PATCH", modelPath, map[string]any{"description": "HTTP model edited"}, 200, map[string]string{"If-Match": modelTag})
	modelTag = admin.last.Header().Get("ETag")
	result := testData(admin.call(t, "POST", modelPath+"/test", map[string]any{"levels": []string{"generation"}}, 200, map[string]string{"If-Match": modelTag}))
	if result["diagnostic"].(map[string]any)["status"] != "succeeded" || admin.last.Header().Get("Retry-After") != "" || admin.last.Header().Get("Location") != "" {
		t.Fatal("sync HTTP contract")
	}
	for _, path := range []string{"/admin/models/operations/1", "/admin/models/command-receipts/old", providerPath + "/diagnostics", modelPath + "/diagnostics"} {
		admin.call(t, "GET", path, nil, 404, nil)
	}
	admin.call(t, "POST", "/admin/users", map[string]any{"username": "modelviewer", "display_name": "普通用户", "role": "user", "password": "viewer-initial-password"}, 201, nil)
	viewer := clientFor(h, 32)
	viewer.login(t, "modelviewer", "viewer-initial-password")
	viewer.call(t, "PUT", "/account/password", map[string]any{"current_password": "viewer-initial-password", "new_password": "viewer-updated-password"}, 204, nil)
	viewer.login(t, "modelviewer", "viewer-updated-password")
	for _, path := range []string{"/admin/models/providers", providerPath, "/admin/models/definitions"} {
		expectCode(t, viewer.call(t, "GET", path, nil, 403, nil), "FORBIDDEN")
	}
	expectCode(t, viewer.call(t, "POST", "/admin/models/providers", providerBody, 403, nil), "FORBIDDEN")
	admin.call(t, "DELETE", modelPath, nil, 204, map[string]string{"If-Match": modelTag})
	admin.call(t, "DELETE", providerPath, nil, 204, map[string]string{"If-Match": tag})
}

func modelsExpectCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *httpx.Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}
