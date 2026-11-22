package mysql

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/papi"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"platform_api", agentPAPIIntegration})
}

func agentPAPIIntegration(t *testing.T, f *agentIntegrationFixture) {
	svc := f.Agents
	oldCatalog, oldEpoch, oldPAPI := svc.Catalog, svc.Epoch, svc.PAPI
	t.Cleanup(func() { svc.Catalog, svc.Epoch, svc.PAPI = oldCatalog, oldEpoch, oldPAPI })
	registry, err := papi.New()
	if err != nil {
		t.Fatal(err)
	}
	svc.PAPI, svc.Epoch = registry, "platform-api-integration"
	svc.Catalog.Tool = func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "read_only", SupportedPolicies: []string{"allow", "deny", "confirm"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}
	agent := runtimeTestAgent(t, f)
	setTool := func(key string) {
		t.Helper()
		bindings, err := svc.GetToolBindings(f.Context, f.AdminToken, agent.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = svc.PutToolBindings(f.Context, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{{ToolKey: key, Policy: "allow", Constraints: json.RawMessage(`{}`)}}})
		if err != nil {
			t.Fatal(err)
		}
	}
	setTool(papi.CallTool)
	initial, err := svc.GetPAPIGrants(f.Context, f.AdminToken, agent.ID, a.Query{})
	if err != nil || initial.Pagination.Total != len(registry.Codes()) {
		t.Fatalf("catalog: %v (%v)", initial, err)
	}
	const constraints = `{"args_schema":{"properties":{"n":{"minimum":9007199254740993,"maximum":9007199254740993}},"required":["n"]}}`
	granted, err := svc.PutPAPIGrant(f.Context, f.AdminToken, agent.ID, "echo", initial.Tag, a.PAPIGrantWrite{Constraints: json.RawMessage(constraints)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.DeletePAPIGrant(f.Context, f.AdminToken, agent.ID, "echo", initial.Tag)
	modelsExpectCode(t, err, "VERSION_CONFLICT")
	var audits int
	err = f.Store.db.GetContext(f.Context, &audits, `SELECT COUNT(*) FROM audit_event WHERE action='agent.papi_grant.grant' AND target_id=? AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.api_code'))='echo'`, agent.ID)
	if err != nil || audits != 1 {
		t.Fatalf("grant audit count=%d: %v", audits, err)
	}
	session := runtimeSession(t, f, agent.ID)
	x := runtimeClaim(t, f, session.Configuration.ID, "Echo precise JSON")
	if _, err = svc.DeletePAPIGrant(f.Context, f.AdminToken, agent.ID, "echo", granted.Tag); err != nil {
		t.Fatal(err)
	}
	step, err := svc.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range step.Tools {
		if tool.Key == papi.ListTool || tool.Key == papi.DescTool {
			t.Fatalf("unbound tool exposed: %s", tool.Key)
		}
	}
	const echo = `{ "n":9007199254740993, "d":0.1234567890123456789, "nested":[null,true,{"locale":"你好"}] }`
	const args = `{"api":"echo","args":` + echo + `}`
	committed := runtimePreparedAttempt(t, f, x, step, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "papi-echo", Name: papi.CallTool, Arguments: args}}})
	admission, err := svc.PrepareDispatch(f.Context, x.Ref, committed.Calls[0].ID)
	if err != nil || admission.Kind != "execute" || admission.Permit.Call.Call.Arguments != args {
		t.Fatalf("frozen arguments or grant changed: %v (%s)", err, admission.Kind)
	}
	execution, err := svc.AuthorizeExecution(f.Context, x.Ref)
	if err != nil || len(execution.PAPIGrants) != 1 {
		t.Fatalf("run lost frozen grant: %v", err)
	}
	var authority struct {
		Resource papi.Authorization `json:"resource"`
	}
	if err = json.Unmarshal(admission.Permit.Authorization, &authority); err != nil {
		t.Fatal(err)
	}
	result, err := registry.Dispatch(f.Context, execution, papi.CallTool, admission.Permit.Call.Call.Arguments, authority.Resource, admission.Permit.Call.ID)
	if err != nil || string(result) != echo {
		t.Fatalf("exact echo after SQL round trip: %s (%v)", result, err)
	}
	yes := true
	settled, err := svc.CompleteTool(f.Context, x.Ref, agentcore.ToolResult{Call: admission.Permit.Call, Observation: agentcore.DispatchObservation{Status: "succeeded", Executed: &yes, Content: string(result)}})
	if err != nil || settled.Result.Content != echo || settled.Result.Truncated {
		t.Fatal("echo settlement", err)
	}
	history, err := svc.History(f.Context, f.AdminToken, session.Configuration.ID, a.HistoryQuery{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	var seen bool
	for _, record := range history.Data.(a.HistoryPage).Records {
		if record.Type == "tool/call" {
			var call struct {
				ArgumentsText string `json:"arguments_text"`
			}
			raw, err := json.Marshal(record.Data)
			if err != nil {
				t.Fatal(err)
			}
			if err = json.Unmarshal(raw, &call); err != nil || call.ArgumentsText != args {
				t.Fatal("history lost exact parameters", err)
			}
			seen = true
		}
	}
	if !seen {
		t.Fatal("missing tool intent in history")
	}
	runtimeEnd(t, f, x)
	setTool(papi.ListTool)
	next := runtimeClaim(t, f, session.Configuration.ID, "List preauthorized operations")
	current, err := svc.AuthorizeExecution(f.Context, next.Ref)
	if err != nil || len(current.PAPIGrants) != 0 {
		t.Fatalf("revoked grant was available in next turn: %v", err)
	}
	step, err = svc.PrepareStep(f.Context, next, 1)
	if err != nil {
		t.Fatal(err)
	}
	var listEnabled bool
	for _, tool := range step.Tools {
		listEnabled = listEnabled || tool.Key == papi.ListTool
		if tool.Key == papi.CallTool || tool.Key == papi.DescTool {
			t.Fatalf("unbound tool exposed: %s", tool.Key)
		}
	}
	if !listEnabled {
		t.Fatal("list did not enable independently of grants and call")
	}
	runtimeEnd(t, f, next)
}
