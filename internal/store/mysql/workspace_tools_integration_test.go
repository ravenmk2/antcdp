package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"workspace_tools", workspaceToolsIntegration})
}

type workspaceToolProvider struct {
	*environmentMemoryProvider
	stats, downloads int
}

func (p *workspaceToolProvider) StatFile(ctx context.Context, ref sb.ResourceRef, name string) (sb.FileInfo, error) {
	p.stats++
	return p.environmentMemoryProvider.StatFile(ctx, ref, name)
}

func (p *workspaceToolProvider) OpenFile(ctx context.Context, ref sb.ResourceRef, q sb.FileRequest) (io.ReadCloser, error) {
	p.downloads++
	return p.environmentMemoryProvider.OpenFile(ctx, ref, q)
}

func (p *workspaceToolProvider) StreamFile(ctx context.Context, ref sb.ResourceRef, q sb.FileRequest, _ string) (*sb.FileStream, error) {
	r, err := p.OpenFile(ctx, ref, q)
	if err != nil {
		return nil, err
	}
	return &sb.FileStream{Reader: r, ContentLength: -1, StatusCode: 200}, nil
}

type workspaceToolFactory struct{ provider *workspaceToolProvider }

func (f workspaceToolFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

// The in-memory remote isolates SQL authorization, idempotency and reference
// semantics. Actual safe IO is separately exercised by Linux/provider tests.
func workspaceToolsIntegration(t *testing.T, f *agentIntegrationFixture) {
	ctx, host := f.Context, f.Agents
	oldCatalog, oldEpoch, oldSandbox := host.Catalog, host.Epoch, host.Sandboxes
	t.Cleanup(func() { host.Catalog, host.Epoch, host.Sandboxes = oldCatalog, oldEpoch, oldSandbox })
	host.Epoch = "workspace-tool-test"
	host.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "side_effect", RequiresSandbox: true, SupportedPolicies: []string{"allow", "deny"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, Description: "Controlled file fixture", InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}, AuthorizeTool: func(context.Context, identity.Tx, core.ExecutionContext, a.ToolDescriptor, json.RawMessage, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{}`), nil
	}}
	remote := &workspaceToolProvider{environmentMemoryProvider: &environmentMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, executions: map[string]sb.ExecResult{}, outputs: map[string]string{}, files: map[string][]byte{}}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, Factory: workspaceToolFactory{remote}, Connection: fixtureConnection, InstallationID: func() (string, error) { return f.Installation, nil }, EndpointTargets: func(string) ([]string, error) { return []string{"192.0.2.21"}, nil }}
	svc.PrepareWorkspace, svc.VerifyEnvironment = svc.InitializeComputer, svc.VerifyWorkspaceEnvironment
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	agent := sandboxServiceAgent(t, f, "per_run")
	bindings, err := host.GetToolBindings(ctx, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = host.PutToolBindings(ctx, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{{ToolKey: "write", Policy: "allow", Constraints: json.RawMessage(`{}`)}, {ToolKey: "read", Policy: "allow", Constraints: json.RawMessage(`{}`)}}}); err != nil {
		t.Fatal(err)
	}
	x := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "write and read an authorized work file")
	binding, err := svc.Acquire(ctx, x)
	if err != nil || binding == nil {
		t.Fatal("acquire", err)
	}
	if _, err = host.ActivateBinding(ctx, x.Ref, *binding); err != nil {
		t.Fatal(err)
	}
	x.Binding = binding
	if binding.CWD != fmt.Sprintf("/data/sessions/%d", x.ContentSessionID) {
		t.Fatal("binding used a different session CWD", binding.CWD)
	}
	if err = svc.PrepareTurn(ctx, x); err != nil {
		t.Fatal("prepare frozen working directory", err)
	}
	var frozenCWD string
	if err = f.Store.db.GetContext(ctx, &frozenCWD, "SELECT cwd FROM agent_run_context WHERE root_run_id=?", uint64(x.Ref.RootRunID)); err != nil || frozenCWD != binding.CWD {
		t.Fatal("binding differs from frozen CWD", frozenCWD, err)
	}
	args := json.RawMessage(`{"file_path":"note.md","content":"controlled contents"}`)
	call := commandDeclare(t, f, x, 1, "write", string(args))
	before := remote.launches
	if _, err = svc.FileTool(ctx, x.Ref, uint64(call.ID), "write", json.RawMessage(`{"file_path":"other.md","content":"changed"}`)); err == nil || remote.launches != before {
		t.Fatal("frozen arguments did not protect dispatch")
	}
	observation, err := svc.FileTool(ctx, x.Ref, uint64(call.ID), "write", args)
	if err != nil || observation.Status != "succeeded" || observation.Executed == nil || !*observation.Executed {
		t.Fatal("write", err)
	}
	if _, err = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: call, Observation: observation}); err != nil {
		t.Fatal(err)
	}
	before = remote.launches
	if _, err = svc.FileTool(ctx, x.Ref, uint64(call.ID), "write", args); err == nil || remote.launches != before {
		t.Fatal("completed file tool replayed")
	}
	readArgs, _ := json.Marshal(map[string]any{"file_path": binding.CWD + "/note.md"})
	readCall := commandDeclare(t, f, x, 2, "read", string(readArgs))
	read, err := svc.FileTool(ctx, x.Ref, uint64(readCall.ID), "read", readArgs)
	if err != nil || !strings.Contains(read.Content, "controlled contents") {
		t.Fatal("read", err)
	}
	if _, err = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: readCall, Observation: read}); err != nil {
		t.Fatal(err)
	}
	listing, err := svc.ListWorkspaceEntries(ctx, f.AdminToken, uint64(binding.ComputerID), a.WorkspaceEntryQuery{Path: strings.TrimPrefix(binding.CWD, "/data/"), Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal("list working files", err)
	}
	entries, ok := listing.Data.([]a.WorkspaceEntry)
	if !ok || len(entries) != 1 || entries[0].Name != "note.md" || entries[0].EntryToken == "" || listing.Pagination == nil || listing.Pagination.Page != 1 || listing.Pagination.PageSize != 20 || listing.Pagination.Total != 1 {
		t.Fatal("workspace list must use the shared array and pagination contract", listing)
	}
	workspacePreviewIntegration(t, f, svc, remote, uint64(binding.ComputerID), binding.CWD)
	var held int
	if err = f.Store.db.GetContext(ctx, &held, "SELECT COUNT(*) FROM agent_resource_reference WHERE holder_kind='workspace_operation' AND resource_kind='binding' AND resource_id=? AND state IN ('active','unknown')", uint64(binding.ID)); err != nil || held != 0 {
		t.Fatal("completed native operation kept resources", held, err)
	}
	// Existing home remains readable while the root lease is active.
	before = remote.launches
	if _, err = svc.EnsureWorkspaceHome(ctx, f.AdminToken, uint64(binding.ComputerID), cryptox.ID()); err != nil || remote.launches != before {
		t.Fatal("existing home should not mutate a busy computer", err)
	}
	var homeKey string
	for key := range remote.files {
		if strings.HasSuffix(key, "home") {
			homeKey = key
			break
		}
	}
	if homeKey == "" {
		t.Fatal("computer initialization did not prepare home")
	}
	delete(remote.files, homeKey)
	if _, err = svc.EnsureWorkspaceHome(ctx, f.AdminToken, uint64(binding.ComputerID), cryptox.ID()); err == nil || remote.launches != before {
		t.Fatal("missing home was created during an active lease", err)
	}
	runtimeEnd(t, f, x)
	if err = svc.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	key := cryptox.ID()
	result, err := svc.EnsureWorkspaceHome(ctx, f.AdminToken, uint64(binding.ComputerID), key)
	if err != nil {
		t.Fatal("ensure home", err)
	}
	encoded, _ := json.Marshal(result.Data)
	if !strings.Contains(string(encoded), `"status":"succeeded"`) {
		t.Fatal("home preparation did not finish", string(encoded))
	}
	if data, exists := remote.files[homeKey]; !exists || data != nil {
		t.Fatal("home directory not created")
	}
	before = remote.launches
	if _, err = svc.EnsureWorkspaceHome(ctx, f.AdminToken, uint64(binding.ComputerID), key); err != nil || remote.launches != before {
		t.Fatal("duplicate home preparation mutated directory", err)
	}
	delete(remote.files, homeKey)
	if _, err = svc.EnsureWorkspaceHome(ctx, f.AdminToken, uint64(binding.ComputerID), cryptox.ID()); err != nil || remote.launches != before+1 {
		t.Fatal("next visit did not recreate home", err)
	}
	remote.files[homeKey] = []byte("keep this file")
	if _, err = svc.EnsureWorkspaceHome(ctx, f.AdminToken, uint64(binding.ComputerID), cryptox.ID()); err == nil || string(remote.files[homeKey]) != "keep this file" {
		t.Fatal("conflicting file was overwritten", err)
	}
	if err = f.Store.db.GetContext(ctx, &held, "SELECT COUNT(*) FROM agent_resource_reference WHERE holder_kind='cloud_file_operation' AND resource_kind='cloud_computer' AND resource_id=? AND state IN ('active','unknown')", uint64(binding.ComputerID)); err != nil || held != 0 {
		t.Fatal("home preparation leaked references", held, err)
	}
}
