package mysql

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type delayedHealthProvider struct {
	*volumeMemoryProvider
	started chan struct{}
	release chan struct{}
}

func (p *delayedHealthProvider) Health(ctx context.Context, _ *sb.ResourceRef) error {
	close(p.started)
	select {
	case <-p.release:
		return &sb.Error{Code: "SANDBOX_AUTHENTICATION_FAILED"}
	case <-ctx.Done():
		return ctx.Err()
	}
}

type healthFactory struct{ p sb.Provider }

func (f healthFactory) Open(context.Context, sb.Connection) (sb.Provider, error) { return f.p, nil }

func testSandboxAdmin(t *testing.T, f *agentIntegrationFixture, s *a.CloudService, remote *volumeMemoryProvider, id uint64) {
	_, member := favoriteTestUser(t, f, "sandbox_admin_reader")
	t.Run("connection", func(t *testing.T) { testAdminConnection(t, f, s, remote, id, member) })
	t.Run("spec_bindings", func(t *testing.T) { testAdminSpecBindings(t, f, s, remote, id, member) })
}
func testAdminConnection(t *testing.T, f *agentIntegrationFixture, s *a.CloudService, remote *volumeMemoryProvider, id uint64, member string) {
	ctx, raw := f.Context, f.AdminToken
	_, err := s.ListSpecs(ctx, member)
	modelsExpectCode(t, err, "FORBIDDEN")
	c, err := s.GetConnection(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if view := c.Data.(a.ConnectionView); !view.Configured || view.Type != "opensandbox" || !view.Authentication.HasSecret {
		t.Fatal("missing deployment connection")
	}
	p := &delayedHealthProvider{volumeMemoryProvider: remote, started: make(chan struct{}), release: make(chan struct{})}
	probeService := &a.CloudService{Host: s.Host, Connection: s.Connection, Factory: healthFactory{p}, Epoch: s.Epoch}
	session := runtimeSession(t, f, runtimeTestAgent(t, f).ID)
	fileService := &a.CloudService{Host: s.Host, Connection: s.Connection, Factory: artifactMemoryFactory{&artifactMemoryProvider{sandboxMemoryProvider: remote.sandboxMemoryProvider, files: map[string][]byte{"health.txt": []byte("ok")}}}, InstallationID: s.InstallationID}
	done := make(chan error, 1)
	go func() { _, e := probeService.CheckConnection(ctx, raw); done <- e }()
	select {
	case <-p.started:
	case <-time.After(3 * time.Second):
		t.Fatal("probe never started")
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	begin := time.Now()
	_, err = fileService.ListWorkspaceEntries(bounded, raw, id, a.WorkspaceEntryQuery{PageSize: 10})
	if err != nil {
		close(p.release)
		t.Fatal(err)
	}
	listed := time.Since(begin)
	x := runtimeClaim(t, f, session.Configuration.ID, "parallel health check")
	runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", Content: "ok"})
	runtimeEnd(t, f, x)
	t.Logf("While remote probe was suspended: list=%s ordinary turn=%s", listed, time.Since(begin)-listed)
	close(p.release)
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	c, err = s.GetConnection(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	checked, err := s.CheckConnection(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	var diag struct {
		Healthy bool `json:"healthy"`
	}
	if checked.Tag != c.Tag || json.Unmarshal(checked.Data.(a.ConnectionView).LastDiagnostic, &diag) != nil || !diag.Healthy {
		t.Fatal("health did not persist independently of config version")
	}

}
func testAdminSpecBindings(t *testing.T, f *agentIntegrationFixture, s *a.CloudService, remote *volumeMemoryProvider, id uint64, member string) {
	ctx, raw := f.Context, f.AdminToken
	binding, err := s.GetBinding(ctx, raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	unbound, err := s.SaveBinding(ctx, raw, binding.Tag, cryptox.ID(), nil, a.BindingWrite{SpecID: a.Field[string]{Set: true, Null: true}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.ActivatePersonal(ctx, member)
	modelsExpectCode(t, err, "CLOUD_SPEC_NOT_CONFIGURED")
	absent, err := s.GetPersonal(ctx, member)
	if err != nil || absent.Data != nil {
		t.Fatal("unspecified personal spec left a computer", err)
	}
	if err = s.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	if _, err = f.Agents.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
		t.Fatal(err)
	}
	computerBefore, err := s.GetComputer(ctx, raw, id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.MaintainComputer(ctx, raw, id, computerBefore.Tag, cryptox.ID(), a.CloudMaintenanceWrite{Action: "rebuild"})
	modelsExpectCode(t, err, "CLOUD_SPEC_NOT_CONFIGURED")
	afterReject, err := s.GetComputer(ctx, raw, id)
	if err != nil || afterReject.Tag != computerBefore.Tag {
		t.Fatal("missing spec changed computer", err)
	}
	_, err = s.SaveBinding(ctx, raw, unbound.Tag, cryptox.ID(), nil, a.BindingWrite{})
	modelsExpectCode(t, err, "VALIDATION_FAILED")
	originalID := binding.Data.(*a.SpecBinding).Spec.ID
	binding, err = s.SaveBinding(ctx, raw, unbound.Tag, cryptox.ID(), nil, a.BindingWrite{SpecID: a.Field[string]{Set: true, Value: strconv.FormatUint(originalID, 10)}})
	if err != nil {
		t.Fatal(err)
	}
	initial := binding.Data.(*a.SpecBinding).Spec
	agent := sandboxRobotChatAgent(t, f, "shared")
	shared, err := s.GetSpec(ctx, raw, initial.ID, true)
	if err != nil || len(shared.Data.([]a.SpecReference)) != 2 {
		t.Fatal("missing shared spec owner", err)
	}
	definition, err := f.Agents.GetDefinition(ctx, raw, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Agents.DeleteDefinition(ctx, raw, agent.ID, definition.Tag, cryptox.ID()); err != nil {
		t.Fatal(err)
	}
	refs, err := s.GetSpec(ctx, raw, initial.ID, true)
	if err != nil || len(refs.Data.([]a.SpecReference)) != 1 {
		t.Fatal("personal reference", err)
	}
	_, err = s.DeleteSpec(ctx, raw, `"`+initial.Version+`"`, cryptox.ID(), initial.ID)
	modelsExpectCode(t, err, "RESOURCE_IN_USE")
	w := a.SpecWrite{Name: "验收规格", CloudEnvironment: a.CloudEnvironment{Image: "demo:1", CPU: 1000, Memory: 1024, Network: a.NetworkPolicy{DefaultAction: "deny"}}}
	key := cryptox.ID()
	created, err := s.SaveSpec(ctx, raw, "", key, 0, w)
	if err != nil {
		t.Fatal(err)
	}
	if replay, e := s.SaveSpec(ctx, raw, "", key, 0, w); e != nil || !replay.Replayed {
		t.Fatal("spec create replay", e)
	}
	spec := created.Data.(*a.SandboxSpec)
	w.Name += "改名"
	renamed, err := s.SaveSpec(ctx, raw, created.Tag, cryptox.ID(), spec.ID, w)
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Data.(*a.SandboxSpec).ConfigVersion != spec.ConfigVersion || renamed.Tag == created.Tag {
		t.Fatal("rename changed runtime version or reused ETag")
	}
	selected, err := s.SaveBinding(ctx, raw, binding.Tag, cryptox.ID(), nil, a.BindingWrite{SpecID: a.Field[string]{Set: true, Value: strconv.FormatUint(spec.ID, 10)}})
	if err != nil {
		t.Fatal(err)
	}
	computer, err := s.GetComputer(ctx, raw, id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.MaintainComputer(ctx, raw, id, computer.Tag, cryptox.ID(), a.CloudMaintenanceWrite{Action: "rebuild"})
	if err != nil {
		t.Fatal(err)
	}
	w.Memory = 8192
	updated, err := s.SaveSpec(ctx, raw, renamed.Tag, cryptox.ID(), spec.ID, w)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.SaveBinding(ctx, raw, selected.Tag, cryptox.ID(), nil, a.BindingWrite{SpecID: a.Field[string]{Set: true, Value: strconv.FormatUint(initial.ID, 10)}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.DeleteSpec(ctx, raw, updated.Tag, cryptox.ID(), spec.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ProcessPending(ctx, 50); err != nil {
		t.Fatal(err)
	}
	actual, err := s.GetComputer(ctx, raw, id)
	if err != nil {
		t.Fatal(err)
	}
	v := actual.Data.(a.CloudView)
	var env struct {
		Network map[string]json.RawMessage `json:"network"`
		Memory  int                        `json:"memory_mib"`
	}
	if json.Unmarshal(v.Environment, &env) != nil || env.Memory != 1024 || env.Network["policy_sha256"] != nil || env.Network["resolved_presets"] != nil {
		t.Fatal("invalid effective environment", string(v.Environment))
	}
	if v.State != "ready" || v.AppliedSpecID == nil || *v.AppliedSpecID != spec.ID || v.AppliedSpecVersion == nil || *v.AppliedSpecVersion != spec.ConfigVersion || remote.specs[len(remote.specs)-1].Config.Environment.MemoryMiB != 1024 {
		t.Fatal("worker did not use queued snapshot")
	}
}
