package mysql

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type volumeMemoryProvider struct {
	*sandboxMemoryProvider
	volumes       map[string]bool
	deleteUnknown bool
}

func (p *volumeMemoryProvider) Create(ctx context.Context, spec sb.CreateSpec) (sb.Observation, error) {
	p.volumes[spec.Mount.VolumeID] = true
	return p.sandboxMemoryProvider.Create(ctx, spec)
}
func (p *volumeMemoryProvider) VolumeExists(_ context.Context, ref sb.VolumeRef) (bool, error) {
	return p.volumes[ref.ID], nil
}
func (p *volumeMemoryProvider) DeleteVolume(_ context.Context, ref sb.VolumeRef) error {
	if p.deleteUnknown {
		return &sb.Error{Code: "DELETE_UNCONFIRMED", Unknown: true}
	}
	delete(p.volumes, ref.ID)
	return nil
}

type volumeMemoryFactory struct{ provider *volumeMemoryProvider }

func (f volumeMemoryFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

// Runs in its own empty schema so unrelated active roots cannot mask reset bugs.
func TestCloudBackendResetAndVerifiedDeletion(t *testing.T) {
	f := newAgentIntegrationFixtureFor(t, "ANTCDP_TEST_CLOUD_MYSQL_DSN")
	agentManagementLifecycle(t, f)
	ctx, host := f.Context, f.Agents
	host.Epoch = "cloud-reset-test"
	host.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "backend", SupportedPolicies: []string{"allow", "deny", "confirm"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}}
	remote := &volumeMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, volumes: map[string]bool{}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, Cipher: f.Models.Cipher, InstallationID: func() (string, error) { return f.Installation, nil }, Factory: volumeMemoryFactory{remote}, EndpointTargets: func(string) ([]string, error) { return []string{"192.0.2.30"}, nil }, PrepareWorkspace: func(context.Context, *a.SandboxAccess, uint64, uint64) error { return nil }, VerifyEnvironment: func(context.Context, *a.SandboxAccess) (a.SandboxCapabilities, []a.DiagnosticCheck, error) {
		return a.SandboxCapabilities{Execution: "supported"}, nil, nil
	}}
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	if _, err := svc.ActivatePersonal(ctx, f.AdminToken); err != nil {
		t.Fatal(err)
	}
	if err := svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	beforeResult, err := svc.GetPersonal(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	before := beforeResult.Data.(a.CloudView)
	if before.State != "ready" || before.VolumeID == nil {
		t.Fatal("computer not prepared")
	}
	agent := runtimeTestAgent(t, f)
	session := runtimeSession(t, f, agent.ID)
	x := runtimeClaim(t, f, session.Configuration.ID, "hold reset")
	connection, err := svc.GetConnection(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	target := a.ConnectionWrite{Endpoint: "https://new-cloud.invalid"}
	preview, err := svc.PreviewConnection(ctx, f.AdminToken, target)
	if err != nil {
		t.Fatal(err)
	}
	target.ConfirmationToken = preview.Data.(map[string]any)["confirmation_token"].(string)
	_, err = svc.SaveConnection(ctx, f.AdminToken, connection.Tag, cryptox.ID(), target)
	modelsExpectCode(t, err, "CLOUD_COMPUTERS_BUSY")
	if _, err = host.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Succeeded}); err != nil {
		t.Fatal(err)
	}
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	if _, err = host.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
		t.Fatal(err)
	}
	queued, err := host.SubmitInput(ctx, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "queued before reset"}}, ExpectedHash: session.Selection.Hash})
	if err != nil {
		t.Fatal(err)
	}
	preview, err = svc.PreviewConnection(ctx, f.AdminToken, target)
	if err != nil {
		t.Fatal(err)
	}
	target.ConfirmationToken = preview.Data.(map[string]any)["confirmation_token"].(string)
	key := cryptox.ID()
	if _, err = svc.SaveConnection(ctx, f.AdminToken, connection.Tag, key, target); err != nil {
		t.Fatal(err)
	}
	if replay, err := svc.SaveConnection(ctx, f.AdminToken, connection.Tag, key, target); err != nil || !replay.Replayed {
		t.Fatal("reset replay", err)
	}
	afterResult, err := svc.GetPersonal(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	after := afterResult.Data.(a.CloudView)
	if after.ID != before.ID || after.State != "uninitialized" || after.RuntimeID != nil || after.VolumeID != nil || after.BackendGeneration != before.BackendGeneration+1 || after.StorageGeneration != before.StorageGeneration+1 {
		t.Fatalf("reset did not preserve only logical identity: %+v", after)
	}
	var bound uint64
	if err = f.Store.db.GetContext(ctx, &bound, "SELECT cloud_computer_id FROM agent_session WHERE id=?", session.Configuration.ID); err != nil || bound != before.ID {
		t.Fatal("reset changed session affinity", err)
	}
	var status string
	if err = f.Store.db.GetContext(ctx, &status, "SELECT status FROM agent_input WHERE id=?", queued.Data.(a.InputAccepted).InputID); err != nil || status != "cancelled" {
		t.Fatal("reset retained queued work", err)
	}
	if _, err = svc.ActivatePersonal(ctx, f.AdminToken); err != nil {
		t.Fatal(err)
	}
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	created, err := svc.GetPersonal(ctx, f.AdminToken)
	if err != nil {
		t.Fatal(err)
	}
	current := created.Data.(a.CloudView)
	if current.State != "ready" || current.VolumeID == nil || *current.VolumeID == *before.VolumeID || remote.terminated != 0 || !remote.volumes[*before.VolumeID] {
		t.Fatal("reset reused storage or cleaned old backend")
	}
	remote.deleteUnknown = true
	if _, err = svc.MaintainComputer(ctx, f.AdminToken, current.ID, created.Tag, cryptox.ID(), a.CloudMaintenanceWrite{Action: "delete", ConfirmDelete: true}); err != nil {
		t.Fatal(err)
	}
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	deleting, err := svc.GetComputer(ctx, f.AdminToken, current.ID)
	if err != nil || deleting.Data.(a.CloudView).State != "deleting" {
		t.Fatal("unconfirmed volume deletion released computer", err)
	}
	delete(remote.volumes, *current.VolumeID)
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	deleted, err := svc.GetComputer(ctx, f.AdminToken, current.ID)
	if err != nil || deleted.Data.(a.CloudView).State != "deleted" {
		t.Fatal("verified deletion did not finish", err)
	}
	if err = f.Store.db.GetContext(ctx, &bound, "SELECT cloud_computer_id FROM agent_session WHERE id=?", session.Configuration.ID); err != nil || bound != before.ID {
		t.Fatal("delete drifted historical session", err)
	}
}
