package mysql

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"strconv"
	"time"

	mcpruntime "github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	r "github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

type mcpDiscoveryClient struct {
	discovery        mcpruntime.Discovery
	failure          error
	entered, release chan struct{}
}

func (c mcpDiscoveryClient) Discover(context.Context) (mcpruntime.Discovery, error) {
	if c.entered != nil {
		close(c.entered)
		<-c.release
	}
	return c.discovery, c.failure
}
func (mcpDiscoveryClient) Call(context.Context, mcpruntime.CallRequest) (mcpruntime.CallResult, error) {
	return mcpruntime.CallResult{}, fmt.Errorf("unexpected call")
}
func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"mcp resources", mcpResourceLifecycle})
}

func mcpResourceLifecycle(t *testing.T, f *agentIntegrationFixture) {
	ctx, token := f.Context, f.AdminToken
	svc := &r.Service{Identity: f.Identity, Store: func() (identity.Store, error) { return f.Store, nil }, ETag: func(value string) string {
		mac := hmac.New(sha256.New, f.Key)
		_, _ = mac.Write([]byte(value))
		return hex.EncodeToString(mac.Sum(nil))
	}, Cipher: func(purpose, value string, seal bool) (string, error) {
		if seal {
			return cryptox.Encrypt(f.Key, f.Installation, purpose, value)
		}
		return cryptox.Decrypt(f.Key, f.Installation, purpose, value)
	}}
	secret := "integration-mcp-secret-not-for-output"
	input := r.MCPServerCreate{Name: "MCP integration", Config: &r.MCPConfig{URL: "https://mcp.example.test/mcp"}, Authentication: &r.MCPAuthenticationWrite{Method: "bearer", Secret: models.SecretWrite{Operation: "replace", Value: &secret}}}
	key := cryptox.ID()
	created, err := svc.CreateMCPServer(ctx, token, key, input)
	if err != nil {
		t.Fatal(err)
	}
	server := created.Data.(*r.MCPServer)
	id := server.ID
	replay, err := svc.CreateMCPServer(ctx, token, key, input)
	if err != nil || !replay.Replayed {
		t.Fatal("create replay", err)
	}
	encoded, _ := json.Marshal(created.Data)
	if strings.Contains(string(encoded), secret) || strings.Contains(string(encoded), "secret_ciphertext") {
		t.Fatal("public credential leak")
	}
	var cipher string
	if err = f.Store.db.GetContext(ctx, &cipher, "SELECT secret_ciphertext FROM agent_mcp_server WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	if cipher == secret {
		t.Fatal("plaintext credential persisted")
	}
	if _, err = cryptox.Decrypt(f.Key, f.Installation, fmt.Sprintf("agentresources/mcp/%d/authentication", id+1), cipher); err == nil {
		t.Fatal("cross-server credential replay")
	}
	tool := mcpruntime.Tool{RemoteName: "echo", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}`), Annotations: json.RawMessage(`{}`)}
	tool.Fingerprint, err = mcpruntime.Fingerprint(tool.InputSchema, nil, tool.Annotations)
	if err != nil {
		t.Fatal(err)
	}
	discovery := mcpruntime.Discovery{ProtocolVersion: "2026-07-28", Tools: []mcpruntime.Tool{tool}}
	client := mcpDiscoveryClient{discovery: discovery}
	svc.MCPFactory = func(_ context.Context, c mcpruntime.Config) (r.MCPClient, error) {
		if c.Secret != secret {
			t.Error("execution did not decrypt current credential")
		}
		return client, nil
	}
	tested, err := svc.TestMCP(ctx, token, id, created.Tag)
	if err != nil {
		t.Fatal(err)
	}
	result := tested.Data.(r.MCPTestResult)
	if result.ToolCount != 1 || result.Diagnostic.Status != "succeeded" {
		t.Fatal("test did not return discovery", result)
	}
	current, err := svc.GetMCPServer(ctx, token, id)
	if err != nil || current.Tag != created.Tag {
		t.Fatal("test changed ETag", err)
	}
	agentService := &agents.Service{Identity: f.Identity, Store: func() (identity.Store, error) { return f.Store, nil }, ETag: svc.ETag, Catalog: agents.ResourceCatalog{MCPServer: svc.ValidateMCPServer}}
	definition, err := agentService.CreateDefinition(ctx, token, cryptox.ID(), agents.DefinitionCreate{Name: "MCP bound agent", Mode: "interactive", ScopeKind: "platform"})
	if err != nil {
		t.Fatal(err)
	}
	agentID := definition.Data.(*agents.Definition).ID
	bound, err := agentService.GetMCPBindings(ctx, token, agentID)
	if err != nil {
		t.Fatal(err)
	}
	bound, err = agentService.PutMCPBindings(ctx, token, agentID, bound.Tag, agents.MCPBindingsWrite{Items: []agents.MCPBindingWrite{{ServerID: strconv.FormatUint(id, 10), Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	var bindingID uint64
	listed, err := svc.MCPAgents(ctx, token, id, r.Query{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	refs := listed.Data.([]r.MCPAgent)
	if len(refs) != 1 || refs[0].ID != agentID || !refs[0].BindingEnabled {
		t.Fatal("current MCP Agent references incorrect", refs)
	}
	withCount, err := svc.GetMCPServer(ctx, token, id)
	if err != nil || withCount.Data.(*r.MCPServer).AgentCount != 1 {
		t.Fatal("MCP Agent count incorrect", err)
	}
	if err = f.Store.db.GetContext(ctx, &bindingID, "SELECT id FROM agent_mcp_binding WHERE agent_id=? AND mcp_server_id=?", agentID, id); err != nil {
		t.Fatal(err)
	}
	changed := server.Config
	changed.URL = "https://other.example.test/mcp"
	_, err = svc.PatchMCPServer(ctx, token, id, current.Tag, r.MCPServerPatch{Config: r.Field[r.MCPConfig]{Set: true, Value: changed}})
	modelsExpectCode(t, err, "RESOURCE_IN_USE")
	_, err = svc.DeleteMCPServer(ctx, token, id, current.Tag, cryptox.ID())
	modelsExpectCode(t, err, "RESOURCE_IN_USE")
	header := "Authorization"
	secret = "Token rotated-integration-secret"
	auth, err := svc.SetMCPAuthentication(ctx, token, id, current.Tag, cryptox.ID(), r.MCPAuthenticationWrite{Method: "custom_header", HeaderName: &header, Secret: models.SecretWrite{Operation: "replace", Value: &secret}})
	if err != nil {
		t.Fatal(err)
	}
	diagnostic, err := svc.MCPDiagnostics(ctx, token, id)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(diagnostic.Data)
	if !strings.Contains(string(encoded), `"outdated":true`) {
		t.Fatal("rotation did not invalidate test")
	}
	client.failure = fmt.Errorf("private remote body %s", secret)
	failed, err := svc.TestMCP(ctx, token, id, auth.Tag)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(failed.Data)
	if strings.Contains(string(encoded), secret) {
		t.Fatal("remote error leaked")
	}
	if failed.Data.(r.MCPTestResult).Diagnostic.Status != "failed" {
		t.Fatal("failure hidden")
	}
	client = mcpDiscoveryClient{discovery: discovery, entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan error, 1)
	go func() { _, e := svc.TestMCP(ctx, token, id, auth.Tag); done <- e }()
	select {
	case <-client.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("discovery did not start")
	}
	// Configuration writes must remain available while remote IO is blocked.
	patchCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err = svc.PatchMCPServer(patchCtx, token, id, auth.Tag, r.MCPServerPatch{Name: r.Field[string]{Set: true, Value: "Renamed during test"}})
	close(client.release)
	if err != nil {
		t.Fatal("remote IO held database lock", err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	bound, err = agentService.PutMCPBindings(ctx, token, agentID, bound.Tag, agents.MCPBindingsWrite{Items: []agents.MCPBindingWrite{}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = agentService.PutMCPBindings(ctx, token, agentID, bound.Tag, agents.MCPBindingsWrite{Items: []agents.MCPBindingWrite{{ServerID: strconv.FormatUint(id, 10), Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	var restoredID uint64
	if err = f.Store.db.GetContext(ctx, &restoredID, "SELECT id FROM agent_mcp_binding WHERE agent_id=? AND mcp_server_id=?", agentID, id); err != nil || restoredID != bindingID {
		t.Fatal("binding identity changed", err)
	}
}
