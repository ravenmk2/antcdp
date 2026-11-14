package agentresources

import (
	"encoding/json"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
)

type mcpMemory struct {
	MCPRepository
	server MCPServer
}

func (m *mcpMemory) MCPServer(uint64, bool) (*MCPServer, error) { v := m.server; return &v, nil }

type mcpTestTx struct {
	identity.Tx
	repo MCPRepository
}

func (t mcpTestTx) AgentMCP() MCPRepository { return t.repo }
func TestMCPAuthenticationAndConfiguration(t *testing.T) {
	secret := "Token custom-value"
	header := "Authorization"
	if e := validateMCPAuth(MCPAuthenticationWrite{Method: "custom_header", HeaderName: &header, Secret: models.SecretWrite{Operation: "replace", Value: &secret}}, "", nil, false); e != nil {
		t.Fatal(e)
	}
	header = "Host"
	if e := validateMCPAuth(MCPAuthenticationWrite{Method: "custom_header", HeaderName: &header, Secret: models.SecretWrite{Operation: "replace", Value: &secret}}, "", nil, false); e == nil {
		t.Fatal("routing header accepted")
	}
	if e := validateMCPAuth(MCPAuthenticationWrite{Method: "bearer", Secret: models.SecretWrite{Operation: "keep"}}, "custom_header", nil, true); e == nil {
		t.Fatal("keep changed authentication identity")
	}
	config := MCPConfig{URL: "https://mcp.example.test"}
	if e := validateMCPConfig(&config); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(config)
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)
	if len(fields) != 4 || config.Timeout != 60 {
		t.Fatalf("unexpected configuration: %s", raw)
	}
}
func TestMCPCredentialRevisionInvalidatesIdentity(t *testing.T) {
	repo := &mcpMemory{server: MCPServer{ID: 1, Enabled: true, AuthMethod: "none", ConfigVersion: 2, SecretRevision: 3, URL: "https://mcp.example.test", StoredConfig: json.RawMessage(`{"url":"https://mcp.example.test","transport":"streamable_http","timeout_seconds":60}`)}}
	svc := Service{}
	tx := mcpTestTx{repo: repo}
	before, e := svc.ReadMCPIdentity(tx, 1)
	if e != nil {
		t.Fatal(e)
	}
	repo.server.SecretRevision++
	after, e := svc.ReadMCPIdentity(tx, 1)
	if e != nil {
		t.Fatal(e)
	}
	if same(before, after) {
		t.Fatal("credential revision did not invalidate identity")
	}
	repo.server.Enabled = false
	if _, e = svc.ReadMCPIdentity(tx, 1); e == nil {
		t.Fatal("disabled server admitted")
	}
	if _, e = svc.ReadAuthorizedMCPRuntime(tx, 1, before); e != nil {
		t.Fatal("disable invalidated an already admitted turn", e)
	}
}
