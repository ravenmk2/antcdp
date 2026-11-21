package mysql

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func fixtureConnection() (*a.SandboxConnection, error) {
	return &a.SandboxConnection{BackendType: "opensandbox", Endpoint: new("https://cloud.invalid"), AccessMode: "direct", APIKey: "fixture", ConnectTimeout: 10, OperationTimeout: 300, BackendGeneration: 1, MaintenanceState: "normal"}, nil
}
func configureTestCloud(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService) {
	t.Helper()
	binding, err := svc.GetBinding(f.Context, f.AdminToken, nil)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := svc.SaveSpec(f.Context, f.AdminToken, "", cryptox.ID(), 0, a.SpecWrite{Name: cryptox.ID(), CloudEnvironment: a.CloudEnvironment{Image: "test/runtime:fixed", CPU: 2000, Memory: 4096, Network: a.NetworkPolicy{DefaultAction: "allow"}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.SaveBinding(f.Context, f.AdminToken, binding.Tag, cryptox.ID(), nil, a.BindingWrite{SpecID: a.Field[string]{Set: true, Value: strconv.FormatUint(spec.Data.(*a.SandboxSpec).ID, 10)}})
	if err != nil {
		t.Fatal(err)
	}
}

func claimCloudRoot(t *testing.T, f *agentIntegrationFixture, svc *a.CloudService, request core.ClaimRequest) (core.ClaimResult, error) {
	t.Helper()
	for attempt := 0; attempt < 6; attempt++ {
		claim, err := f.Agents.ClaimRoot(f.Context, request)
		if err != nil || claim.Claimed || svc == nil {
			return claim, err
		}
		if err = svc.ProcessPending(f.Context, 50); err != nil {
			return claim, err
		}
	}
	return core.ClaimResult{}, nil
}

func cloudLifecycleIntegration(t *testing.T, f *agentIntegrationFixture) {
	ctx, host := f.Context, f.Agents
	oldCatalog, oldEpoch, oldCloud := host.Catalog, host.Epoch, host.Sandboxes
	t.Cleanup(func() { host.Catalog, host.Epoch, host.Sandboxes = oldCatalog, oldEpoch, oldCloud })
	host.Epoch = "cloud-lifecycle-test"
	host.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "sandbox", RequiresSandbox: true, SupportedPolicies: []string{"allow", "deny", "confirm"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, Description: "Cloud fixture", InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}}
	remote := &sandboxMemoryProvider{resources: map[string]sb.Observation{}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, Connection: fixtureConnection, InstallationID: func() (string, error) { return f.Installation, nil }, Factory: sandboxMemoryFactory{remote}, EndpointTargets: func(string) ([]string, error) { return []string{"192.0.2.20"}, nil }, PrepareWorkspace: func(context.Context, *a.SandboxAccess, uint64) error { return nil }, VerifyEnvironment: func(context.Context, *a.SandboxAccess) (a.SandboxCapabilities, []a.DiagnosticCheck, error) {
		return a.SandboxCapabilities{Execution: "supported"}, nil, nil
	}}
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	readComputer := func(id core.ID) a.CloudView {
		t.Helper()
		out, err := svc.GetComputer(ctx, f.AdminToken, uint64(id))
		if err != nil {
			t.Fatal(err)
		}
		return out.Data.(a.CloudView)
	}
	finish := func(x core.ExecutionContext) {
		t.Helper()
		if _, err := host.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Succeeded}); err != nil {
			t.Fatal(err)
		}
		if err := svc.ProcessPending(ctx, 50); err != nil {
			t.Fatal(err)
		}
		if _, err := host.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
			t.Fatal(err)
		}
	}
	maintain := func(id core.ID, action string) {
		t.Helper()
		current, err := svc.GetComputer(ctx, f.AdminToken, uint64(id))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = svc.MaintainComputer(ctx, f.AdminToken, uint64(id), current.Tag, cryptox.ID(), a.CloudMaintenanceWrite{Action: action, ConfirmDelete: action == "delete"}); err != nil {
			t.Fatal(action, err)
		}
		if err = svc.ProcessPending(ctx, 50); err != nil {
			t.Fatal(action, err)
		}
	}
	t.Run("personal_parallel_and_rebuild", func(t *testing.T) {
		agent := runtimeTestAgent(t, f)
		first := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "first personal session")
		second := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "second personal session")
		if first.Binding == nil || second.Binding == nil || first.Binding.ComputerID != second.Binding.ComputerID || first.Binding.ID == second.Binding.ID {
			t.Fatal("personal sessions must share a computer with distinct root leases")
		}
		before := readComputer(first.Binding.ComputerID)
		if before.ActiveLeases != 2 || before.State != "ready" {
			t.Fatalf("parallel personal leases: %+v", before)
		}
		current, err := svc.GetComputer(ctx, f.AdminToken, before.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = svc.MaintainComputer(ctx, f.AdminToken, before.ID, current.Tag, cryptox.ID(), a.CloudMaintenanceWrite{Action: "rebuild"})
		modelsExpectCode(t, err, "CLOUD_COMPUTER_BUSY")
		finish(first)
		finish(second)
		detail, err := host.GetSession(ctx, f.AdminToken, uint64(first.Ref.SessionID))
		if err != nil {
			t.Fatal(err)
		}
		workspace := detail.Data.(a.SessionDetail).State.Workspace
		if workspace.ComputerID == nil || *workspace.ComputerID != before.ID || workspace.BindingID != nil || workspace.Availability != "available" {
			t.Fatalf("settled session lost its permanent computer: %+v", workspace)
		}
		binding, err := svc.GetBinding(ctx, f.AdminToken, nil)
		if err != nil {
			t.Fatal(err)
		}
		spec := binding.Data.(*a.SpecBinding).Spec
		_, err = svc.SaveSpec(ctx, f.AdminToken, `"`+spec.Version+`"`, cryptox.ID(), spec.ID, a.SpecWrite{Name: spec.Name, CloudEnvironment: a.CloudEnvironment{Image: "test/runtime:updated", CPU: 3000, Memory: 4096, Network: a.NetworkPolicy{DefaultAction: "allow"}}})
		if err != nil {
			t.Fatal(err)
		}
		unchanged := readComputer(first.Binding.ComputerID)
		if string(unchanged.Environment) != string(before.Environment) {
			t.Fatal("template edit changed an existing computer")
		}
		maintain(first.Binding.ComputerID, "rebuild")
		after := readComputer(first.Binding.ComputerID)
		if after.State != "ready" || after.StorageGeneration != before.StorageGeneration || after.InstanceID != before.InstanceID+1 || after.VolumeName == nil || before.VolumeName == nil || *after.VolumeName != *before.VolumeName {
			t.Fatalf("ordinary rebuild lost storage identity: %+v -> %+v", before, after)
		}
		if remote.specs[len(remote.specs)-1].Mount.CreateIfMissing {
			t.Fatal("rebuild may not substitute an empty volume")
		}
	})
	t.Run("service_pool_and_session_affinity", func(t *testing.T) {
		agent := sandboxServiceAgent(t, f, "pool")
		oneSession := runtimeSession(t, f, agent.ID).Configuration.ID
		first := runtimeClaim(t, f, oneSession, "task one")
		second := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "task two")
		if first.Binding.ComputerID == second.Binding.ComputerID {
			t.Fatal("service roots must be exclusive")
		}
		thirdSession := runtimeSession(t, f, agent.ID)
		accepted, err := host.SubmitInput(ctx, f.AdminToken, thirdSession.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "wait for capacity"}}, ExpectedHash: thirdSession.Selection.Hash})
		if err != nil {
			t.Fatal(err)
		}
		request := core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(thirdSession.Configuration.ID), InputID: core.ID(accepted.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch}
		waiting, err := host.ClaimRoot(ctx, request)
		if err != nil || waiting.Claimed {
			t.Fatal("full pool must queue", err)
		}
		finish(first)
		third, err := host.ClaimRoot(ctx, request)
		if err != nil || !third.Claimed || third.Execution.Binding.ComputerID != first.Binding.ComputerID {
			t.Fatal("reuse oldest available computer", err)
		}
		finish(second)
		detail, err := host.GetSession(ctx, f.AdminToken, oneSession)
		if err != nil {
			t.Fatal(err)
		}
		reply, err := host.SubmitInput(ctx, f.AdminToken, oneSession, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "continue on original"}}, ExpectedHash: detail.Data.(a.SessionDetail).Selection.Hash})
		if err != nil {
			t.Fatal(err)
		}
		continuation := core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(oneSession), InputID: core.ID(reply.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch}
		waiting, err = host.ClaimRoot(ctx, continuation)
		if err != nil || waiting.Claimed {
			t.Fatal("bound conversation must wait even when another computer is idle", err)
		}
		finish(third.Execution)
		resumed, err := host.ClaimRoot(ctx, continuation)
		if err != nil || !resumed.Claimed || resumed.Execution.Binding.ComputerID != first.Binding.ComputerID {
			t.Fatal("session changed computers", err)
		}
		finish(resumed.Execution)
	})
	t.Run("unknown_create_is_observed_not_replayed", func(t *testing.T) {
		agent := sandboxServiceAgent(t, f, "unknown")
		session := runtimeSession(t, f, agent.ID)
		input, err := host.SubmitInput(ctx, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "unknown create"}}, ExpectedHash: session.Selection.Hash})
		if err != nil {
			t.Fatal(err)
		}
		request := core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session.Configuration.ID), InputID: core.ID(input.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch}
		claim, err := host.ClaimRoot(ctx, request)
		if err != nil || claim.Claimed {
			t.Fatal("activation should precede root", err)
		}
		remote.unknownNext, remote.hideFind = true, true
		count := len(remote.specs)
		for range 2 {
			if err = svc.ProcessPending(ctx, 50); err != nil {
				t.Fatal(err)
			}
		}
		if len(remote.specs) != count+1 {
			t.Fatal("unknown create repeated")
		}
		claim, err = host.ClaimRoot(ctx, request)
		if err != nil || claim.Claimed {
			t.Fatal("unknown computer became available", err)
		}
		remote.hideFind = false
		if err = svc.ProcessPending(ctx, 50); err != nil {
			t.Fatal(err)
		}
		claim, err = host.ClaimRoot(ctx, request)
		if err != nil || !claim.Claimed {
			t.Fatal("observed created instance not adopted", err)
		}
		if len(remote.specs) != count+1 {
			t.Fatal("adoption created another instance")
		}
		finish(claim.Execution)
	})

	t.Run("creation_diagnostic_before_run", func(t *testing.T) {
		agent := sandboxServiceAgent(t, f, "diagnostic")
		session := runtimeSession(t, f, agent.ID)
		input, err := host.SubmitInput(ctx, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "creation rejected"}}, ExpectedHash: session.Selection.Hash})
		if err != nil {
			t.Fatal(err)
		}
		request := core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session.Configuration.ID), InputID: core.ID(input.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch}
		claim, err := host.ClaimRoot(ctx, request)
		if err != nil || claim.Claimed {
			t.Fatal("expected queued environment", err)
		}
		remote.createError = &sb.Error{Code: "SANDBOX_AUTHENTICATION_FAILED", Detail: &diagnostic.Detail{HTTPStatus: 403}}
		if err = svc.ProcessPending(ctx, 50); err != nil {
			t.Fatal(err)
		}
		count := len(remote.specs)
		claim, err = host.ClaimRoot(ctx, request)
		if err != nil || claim.Claimed {
			t.Fatal("rejected environment admitted a run", err)
		}
		var seq core.Seq
		if err = f.Store.db.GetContext(ctx, &seq, "SELECT seq FROM agent_event WHERE session_id=? AND event_type='input/cancelled'", session.Configuration.ID); err != nil {
			t.Fatal(err)
		}
		assertDiagnosticEvent(t, f, core.ID(session.Configuration.ID), seq, 403)
		var runs int
		if err = f.Store.db.GetContext(ctx, &runs, "SELECT COUNT(*) FROM agent_run WHERE session_id=?", session.Configuration.ID); err != nil || runs != 0 {
			t.Fatal("created synthetic failed run", runs, err)
		}
		if _, err = host.ClaimRoot(ctx, request); err != nil {
			t.Fatal(err)
		}
		if len(remote.specs) != count {
			t.Fatal("diagnostic replay recreated sandbox")
		}
	})
	t.Run("pinned_skills_wait_for_old_turns", func(t *testing.T) { cloudSkillBindingsIntegration(t, f, svc, remote) })
}
