package mysql

import (
	"context"
	"encoding/json"
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"root_context", agentRootContext})
}

func agentRootContext(t *testing.T, f *agentIntegrationFixture) {
	s := f.Agents
	oldCatalog, oldEpoch := s.Catalog, s.Epoch
	t.Cleanup(func() { s.Catalog, s.Epoch = oldCatalog, oldEpoch })
	s.Epoch = "frozen-context-test"
	s.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "backend", SupportedPolicies: []string{"allow", "confirm", "deny"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}}
	agent := runtimeTestAgent(t, f)
	session := runtimeSession(t, f, agent.ID)
	x := runtimeClaim(t, f, session.Configuration.ID, "first turn")
	queued, err := s.SubmitInput(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "queued before disable"}}})
	if err != nil {
		t.Fatal(err)
	}
	bindings, err := s.GetToolBindings(f.Context, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PutToolBindings(f.Context, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{}}); err != nil {
		t.Fatal(err)
	}
	current, err := s.GetDefinition(f.Context, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PatchDefinition(f.Context, f.AdminToken, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: false}, SystemPrompt: a.Field[string]{Set: true, Value: "replacement prompt"}}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AuthorizeExecution(f.Context, x.Ref); err != nil {
		t.Fatalf("disable interrupted an admitted turn: %v", err)
	}
	prepared, err := s.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.Tools) != 4 {
		t.Fatalf("root capabilities changed after revocation: %d", len(prepared.Tools))
	}
	var status, prompt string
	if err = f.Store.db.GetContext(f.Context, &status, "SELECT status FROM agent_input WHERE id=?", queued.Data.(a.InputAccepted).InputID); err != nil || status != "cancelled" {
		t.Fatalf("disabled Agent retained queued input: %s %v", status, err)
	}
	if err = f.Store.db.GetContext(f.Context, &prompt, "SELECT system_prompt FROM agent_run_context WHERE root_run_id=?", uint64(x.Ref.RootRunID)); err != nil || prompt == "replacement prompt" {
		t.Fatalf("prompt was not frozen: %v", err)
	}
	runtimeEnd(t, f, x)
	current, err = s.GetDefinition(f.Context, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PatchDefinition(f.Context, f.AdminToken, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}}); err != nil {
		t.Fatal(err)
	}
	next := runtimeClaim(t, f, session.Configuration.ID, "new turn")
	prepared, err = s.PrepareStep(f.Context, next, 1)
	if err != nil || len(prepared.Tools) != 0 {
		t.Fatalf("new turn reused old capabilities: %d %v", len(prepared.Tools), err)
	}
	runtimeEnd(t, f, next)
}
