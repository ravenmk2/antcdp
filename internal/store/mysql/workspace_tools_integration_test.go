package mysql

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"workspace_tools", workspaceToolsIntegration})
}

type workspaceToolProvider struct{ *environmentMemoryProvider }

func (p *workspaceToolProvider) Exec(ctx context.Context, ref sb.ResourceRef, spec sb.ExecSpec, callbacks sb.ExecCallbacks) (sb.ExecResult, error) {
	if len(spec.Argv) != 2 {
		return p.environmentMemoryProvider.Exec(ctx, ref, spec, callbacks)
	}
	request, err := workspacefs.Decode(spec.Argv[1])
	if err != nil {
		return sb.ExecResult{}, err
	}
	if request.Operation != "read" && request.Operation != "write" && request.Operation != "list" {
		return p.environmentMemoryProvider.Exec(ctx, ref, spec, callbacks)
	}
	p.launches++
	handle := sb.ExecutionHandle{Resource: ref, ID: fmt.Sprintf("file-tool-%d", p.launches)}
	if err = callbacks.Started(ctx, handle); err != nil {
		return sb.ExecResult{Handle: &handle}, err
	}
	key := p.fileKey(ref, request.Path)
	var value any
	switch request.Operation {
	case "write":
		data, e := base64.StdEncoding.DecodeString(request.Data)
		if e != nil {
			return sb.ExecResult{}, e
		}
		p.files[key] = data
		value = map[string]any{"path": request.Path, "size_bytes": fmt.Sprint(len(data))}
	case "list":
		path := request.Path + "/note.md"
		data := p.files[p.fileKey(ref, path)]
		value = map[string]any{"entries": []workspacefs.Entry{{Name: "note.md", Path: path, Kind: "file", Size: int64(len(data)), ModifiedAt: time.Now().UTC().Format(time.RFC3339Nano), Identity: strings.Repeat("a", 64)}}, "total": 1, "has_more": false}
	default:
		data := p.files[key]
		value = map[string]any{"path": request.Path, "data_base64": base64.StdEncoding.EncodeToString(data), "offset": 0, "next_offset": len(data), "size_bytes": fmt.Sprint(len(data)), "has_more": false, "identity": strings.Repeat("a", 64)}
	}
	encoded, _ := json.Marshal(workspacefs.Result(value, request.Operation == "write", nil))
	zero := int32(0)
	result := sb.ExecResult{Handle: &handle, ExitCode: &zero}
	p.executions[handle.ID], p.outputs[handle.ID] = result, string(encoded)
	return result, nil
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
	remote := &workspaceToolProvider{&environmentMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, executions: map[string]sb.ExecResult{}, outputs: map[string]string{}, files: map[string][]byte{}, transfers: map[string][]byte{}}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, Factory: workspaceToolFactory{remote}, Cipher: f.Models.Cipher, InstallationID: func() (string, error) { return f.Installation, nil }, EndpointTargets: func(string) ([]string, error) { return []string{"192.0.2.21"}, nil }}
	svc.PrepareWorkspace, svc.VerifyEnvironment = svc.InitializeComputer, svc.VerifyWorkspaceEnvironment
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	agent := sandboxServiceAgent(t, f, "per_run")
	bindings, err := host.GetToolBindings(ctx, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = host.PutToolBindings(ctx, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{{ToolKey: "write_file", Policy: "allow", Constraints: json.RawMessage(`{}`)}, {ToolKey: "read_file", Policy: "allow", Constraints: json.RawMessage(`{}`)}}}); err != nil {
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
	args := json.RawMessage(`{"path":"note.md","content":"controlled contents"}`)
	call := commandDeclare(t, f, x, 1, "write_file", string(args))
	before := remote.launches
	if _, err = svc.FileTool(ctx, x.Ref, uint64(call.ID), "write_file", json.RawMessage(`{"path":"other.md","content":"changed"}`)); err == nil || remote.launches != before {
		t.Fatal("frozen arguments did not protect dispatch")
	}
	observation, err := svc.FileTool(ctx, x.Ref, uint64(call.ID), "write_file", args)
	if err != nil || observation.Status != "succeeded" || observation.Executed == nil || !*observation.Executed {
		t.Fatal("write", err)
	}
	if _, err = host.CompleteTool(ctx, x.Ref, core.ToolResult{Call: call, Observation: observation}); err != nil {
		t.Fatal(err)
	}
	before = remote.launches
	if _, err = svc.FileTool(ctx, x.Ref, uint64(call.ID), "write_file", args); err == nil || remote.launches != before {
		t.Fatal("completed file tool replayed")
	}
	readArgs, _ := json.Marshal(map[string]any{"path": binding.CWD + "/note.md"})
	readCall := commandDeclare(t, f, x, 2, "read_file", string(readArgs))
	read, err := svc.FileTool(ctx, x.Ref, uint64(readCall.ID), "read_file", readArgs)
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
	var held int
	if err = f.Store.db.GetContext(ctx, &held, "SELECT COUNT(*) FROM agent_resource_reference WHERE holder_kind='workspace_operation' AND resource_kind='binding' AND resource_id=? AND state IN ('active','unknown')", uint64(binding.ID)); err != nil || held != 0 {
		t.Fatal("completed helper kept resources", held, err)
	}
	runtimeEnd(t, f, x)
}
