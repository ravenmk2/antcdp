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

// Runs in its own empty schema to verify ownership and cleanup against its actual resources.
func TestCloudBackendOwnershipAndVerifiedDeletion(t *testing.T) {
	f := newAgentIntegrationFixtureFor(t, "ANTCDP_TEST_CLOUD_MYSQL_DSN")
	agentManagementLifecycle(t, f)
	ctx, host := f.Context, f.Agents
	host.Epoch = "cloud-reset-test"
	host.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "backend", SupportedPolicies: []string{"allow", "deny", "confirm"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}, AuthorizeTool: func(context.Context, identity.Tx, core.ExecutionContext, a.ToolDescriptor, json.RawMessage, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{"authorized":true}`), nil
	}}
	remote := &volumeMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, volumes: map[string]bool{}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, Connection: fixtureConnection, InstallationID: func() (string, error) { return f.Installation, nil }, Factory: volumeMemoryFactory{remote}, EndpointTargets: func(string) ([]string, error) { return []string{"192.0.2.30"}, nil }, PrepareWorkspace: func(context.Context, *a.SandboxAccess, uint64) error { return nil }, VerifyEnvironment: func(context.Context, *a.SandboxAccess) (a.SandboxCapabilities, []a.DiagnosticCheck, error) {
		return a.SandboxCapabilities{Execution: "supported"}, nil, nil
	}}
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	t.Run("session_workspace_upload", func(t *testing.T) {
		testSessionWorkspaceUpload(t, f, svc, remote.sandboxMemoryProvider)
	})
	// Both requests race to allocate the same owner's first computer.
	type activation struct {
		id  uint64
		err error
	}
	activated := make(chan activation, 2)
	for range 2 {
		go func() {
			r, e := svc.ActivatePersonal(ctx, f.AdminToken)
			v := activation{err: e}
			if e == nil {
				v.id = r.Data.(a.CloudView).ID
			}
			activated <- v
		}()
	}
	first, second := <-activated, <-activated
	if first.err != nil || second.err != nil || first.id != second.id {
		t.Fatal("concurrent activation", first, second)
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
	t.Run("admin_terminals", func(t *testing.T) { testCloudTerminals(t, f, svc, before.ID) })
	t.Run("synchronous_file_mutations", func(t *testing.T) {
		testSynchronousWorkspaceMutations(t, f, svc, before.ID, remote.sandboxMemoryProvider)
	})
	t.Run("workspace_upload", func(t *testing.T) {
		testWorkspaceUpload(t, f, svc, before.ID, remote.sandboxMemoryProvider)
	})
	t.Run("sandbox_admin", func(t *testing.T) { testSandboxAdmin(t, f, svc, remote, before.ID) })
	busy, err := f.Store.SandboxInUse(ctx)
	if err != nil || !busy {
		t.Fatal("active resources must block backend replacement", err)
	}
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	if _, err = host.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
		t.Fatal(err)
	}
	created, err := svc.GetComputer(ctx, f.AdminToken, before.ID)
	if err != nil {
		t.Fatal(err)
	}
	current := created.Data.(a.CloudView)
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
}
