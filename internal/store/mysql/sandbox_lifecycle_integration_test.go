package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"sync"
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"cloud_lifecycle", cloudLifecycleIntegration})
}

type sandboxMemoryProvider struct {
	mu          sync.Mutex
	resources   map[string]sb.Observation
	specs       []sb.CreateSpec
	unknownNext bool
	rejectNext  bool
	createError error
	hideFind    bool
	terminated  int
}

func (p *sandboxMemoryProvider) Create(_ context.Context, spec sb.CreateSpec) (sb.Observation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.specs = append(p.specs, spec)
	if p.createError != nil {
		err := p.createError
		p.createError = nil
		return sb.Observation{}, err
	}
	if p.rejectNext || spec.Mount.Kind == "ephemeral" && spec.Mount.CreateIfMissing {
		p.rejectNext = false
		return sb.Observation{}, &sb.Error{Code: "SANDBOX_VOLUME_INVALID"}
	}
	id := fmt.Sprintf("sandbox-%d-%d", spec.Ownership.InstanceID, len(p.specs))
	v := sb.Observation{Ref: sb.ResourceRef{BackendGeneration: spec.BackendGeneration, RemoteID: id, Ownership: spec.Ownership}, State: "ready"}
	p.resources[id] = v
	if p.unknownNext {
		p.unknownNext = false
		return sb.Observation{}, &sb.Error{Code: "SANDBOX_TRANSPORT_UNKNOWN", Unknown: true}
	}
	return v, nil
}
func (p *sandboxMemoryProvider) Inspect(_ context.Context, ref sb.ResourceRef) (sb.Observation, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	v, ok := p.resources[ref.RemoteID]
	if !ok {
		return sb.Observation{Ref: ref, State: "absent"}, nil
	}
	if v.Ref.Ownership != ref.Ownership {
		return sb.Observation{}, &sb.Error{Code: "SANDBOX_OWNERSHIP_MISMATCH"}
	}
	return v, nil
}
func (p *sandboxMemoryProvider) Find(_ context.Context, ownership sb.Ownership, page, size int) (sb.ResourcePage, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	rows := []sb.Observation{}
	if !p.hideFind {
		for _, v := range p.resources {
			if v.Ref.Ownership == ownership {
				rows = append(rows, v)
			}
		}
	}
	return sb.ResourcePage{Items: rows}, nil
}
func (p *sandboxMemoryProvider) Terminate(_ context.Context, ref sb.ResourceRef) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	v, ok := p.resources[ref.RemoteID]
	if ok && v.Ref.Ownership != ref.Ownership {
		return &sb.Error{Code: "SANDBOX_OWNERSHIP_MISMATCH"}
	}
	delete(p.resources, ref.RemoteID)
	p.terminated++
	return nil
}
func (p *sandboxMemoryProvider) Health(context.Context, *sb.ResourceRef) error { return nil }
func (p *sandboxMemoryProvider) Exec(context.Context, sb.ResourceRef, sb.ExecSpec, sb.ExecCallbacks) (sb.ExecResult, error) {
	return sb.ExecResult{}, &sb.Error{Code: "UNSUPPORTED"}
}
func (p *sandboxMemoryProvider) InspectExecution(context.Context, sb.ExecutionHandle) (sb.ExecResult, error) {
	return sb.ExecResult{}, &sb.Error{Code: "UNSUPPORTED"}
}
func (p *sandboxMemoryProvider) CancelExecution(context.Context, sb.ExecutionHandle) error {
	return &sb.Error{Code: "UNSUPPORTED"}
}
func (p *sandboxMemoryProvider) ReadExecutionOutput(context.Context, sb.ExecutionHandle, int64, int) (sb.ExecutionOutput, error) {
	return sb.ExecutionOutput{}, &sb.Error{Code: "UNSUPPORTED"}
}
func (p *sandboxMemoryProvider) OpenFile(context.Context, sb.ResourceRef, sb.FileRequest) (io.ReadCloser, error) {
	return nil, &sb.Error{Code: "UNSUPPORTED"}
}
func (p *sandboxMemoryProvider) PutFile(context.Context, sb.ResourceRef, sb.FileRequest, io.Reader) error {
	return &sb.Error{Code: "UNSUPPORTED"}
}

type sandboxMemoryFactory struct{ provider *sandboxMemoryProvider }

func (f sandboxMemoryFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

func sandboxRobotChatAgent(t *testing.T, f *agentIntegrationFixture, mode string) *a.Definition {
	t.Helper()
	binding, e := f.Agents.Sandboxes.GetBinding(f.Context, f.AdminToken, nil)
	if e != nil {
		t.Fatal(e)
	}
	created, e := f.Agents.CreateDefinition(f.Context, f.AdminToken, cryptox.ID(), a.DefinitionCreate{Code: cryptox.ID(), Name: "Robot computer " + mode, Mode: "chat", ExecutorKind: "robot", UsePolicy: "scope", ScopeKind: "platform", SandboxSpecID: binding.Data.(*a.SpecBinding).SpecID})
	if e != nil {
		t.Fatal(e)
	}
	agent := created.Data.(*a.Definition)
	var modelID uint64
	if e = f.Store.db.GetContext(f.Context, &modelID, "SELECT id FROM model_definition WHERE model_id='agent-test' LIMIT 1"); e != nil {
		t.Fatal(e)
	}
	bindings, e := f.Agents.GetModelBindings(f.Context, f.AdminToken, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	id := strconv.FormatUint(modelID, 10)
	_, e = f.Agents.PutModelBindings(f.Context, f.AdminToken, agent.ID, bindings.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: id, GenerationParameters: json.RawMessage(`{}`)}}, DefaultModelID: id})
	if e != nil {
		t.Fatal(e)
	}
	runtimeToolPolicies(t, f, agent.ID, "allow")
	current, e := f.Agents.GetDefinition(f.Context, f.AdminToken, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	patched, e := f.Agents.PatchDefinition(f.Context, f.AdminToken, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}, PoolCapacity: a.Field[int]{Set: true, Value: 2}})
	if e != nil {
		t.Fatal(e)
	}
	return patched.Data.(*a.Definition)
}

var _ sb.Provider = (*sandboxMemoryProvider)(nil)
var _ core.Environment = (*a.CloudService)(nil)
