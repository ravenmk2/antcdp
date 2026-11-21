package mysql

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	s "github.com/ravenmk2/antcdp/internal/modules/sandboxes"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"standalone_sandbox", standaloneSandboxIntegration})
}

// Exercise the real schema/transactions with a non-Agent consumer. No cloud
// computer, definition, session, Run or tool call is created for this job.
func standaloneSandboxIntegration(t *testing.T, f *agentIntegrationFixture) {
	ctx := f.Context
	counts := func() string {
		var out string
		if e := f.Store.db.GetContext(ctx, &out, `SELECT CONCAT((SELECT COUNT(*) FROM agent),':',(SELECT COUNT(*) FROM agent_session),':',(SELECT COUNT(*) FROM agent_run),':',(SELECT COUNT(*) FROM cloud_computer),':',(SELECT COUNT(*) FROM agent_sandbox_execution))`); e != nil {
			t.Fatal(e)
		}
		return out
	}
	before := counts()
	remote := &environmentMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, executions: map[string]sb.ExecResult{}, outputs: map[string]string{}, files: map[string][]byte{}}
	service := &s.Service{Epoch: "script-worker", InstallationID: func() (string, error) { return f.Installation, nil }, Open: func(context.Context, uint64) (sb.Provider, error) { return remote, nil }, Transact: func(ctx context.Context, fn func(s.Repository) error) error {
		return f.Store.Transact(ctx, func(tx identity.Tx) error { return fn(tx.(interface{ SandboxState() s.Repository }).SandboxState()) })
	}}
	v, err := service.Reserve(ctx, 1, cryptox.ID(), json.RawMessage(`{"image":"test:1","purpose":"script"}`))
	if err != nil {
		t.Fatal(err)
	}
	v, err = service.Create(ctx, v.ID, sb.CreateSpec{Mount: sb.MountPlan{Kind: "ephemeral", MountPath: "/data"}})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := service.Acquire(ctx, v.ID, "script", "job-1", "exclusive", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Acquire(ctx, v.ID, "script", "job-2", "exclusive", time.Minute); err == nil {
		t.Fatal("exclusive instance acquired twice")
	}
	uploads := 0
	token := cryptox.ID()
	intent := json.RawMessage(`{"path":"/data/script.txt","content":"fixture"}`)
	put := func(fs sb.Filesystem, ref sb.ResourceRef) (json.RawMessage, error) {
		uploads++
		err := fs.PutFile(ctx, ref, sb.FileRequest{Path: "/data/script.txt", MaxBytes: 100}, strings.NewReader("script content"))
		return json.RawMessage(`{"uploaded":true}`), err
	}
	if _, err = service.File(ctx, *lease, token, intent, true, put); err != nil {
		t.Fatal(err)
	}
	if _, err = service.File(ctx, *lease, token, intent, true, put); err != nil || uploads != 1 {
		t.Fatal("duplicate upload", err, uploads)
	}
	if _, err = service.File(ctx, *lease, cryptox.ID(), json.RawMessage(`{"path":"/data/script.txt"}`), false, func(fs sb.Filesystem, ref sb.ResourceRef) (json.RawMessage, error) {
		r, e := fs.OpenFile(ctx, ref, sb.FileRequest{Path: "/data/script.txt", MaxBytes: 100})
		if e != nil {
			return nil, e
		}
		defer func() { _ = r.Close() }()
		data, e := io.ReadAll(r)
		if string(data) != "script content" {
			t.Error("download differs")
		}
		return json.RawMessage(`{"downloaded":true}`), e
	}); err != nil {
		t.Fatal(err)
	}
	command := sb.ExecSpec{Command: "printf ok", CWD: "/data", Timeout: time.Minute}
	exec, err := service.Execute(ctx, *lease, cryptox.ID(), command, sb.ExecCallbacks{})
	if err != nil || exec.FinishedAt == nil {
		t.Fatal(exec, err)
	}
	background, err := service.Execute(ctx, *lease, cryptox.ID(), sb.ExecSpec{Argv: []string{"/bin/sleep", "30"}, CWD: "/data", Background: true, Timeout: time.Minute}, sb.ExecCallbacks{})
	if err != nil || background.Status != "running" {
		t.Fatal(background, err)
	}
	later, err := service.Execute(ctx, *lease, cryptox.ID(), sb.ExecSpec{Argv: []string{"/bin/sleep", "30"}, CWD: "/data", Background: true, Timeout: time.Minute}, sb.ExecCallbacks{})
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Transact(ctx, func(r s.Repository) error {
		page, e := r.PendingExecutions(background.ID, 1)
		if e == nil && (len(page) != 1 || page[0].ID != later.ID) {
			t.Fatal("recovery cursor did not advance past earlier running command", page)
		}
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if err = service.Release(ctx, *lease, "premature"); err == nil {
		t.Fatal("running process released")
	}
	if err = service.CancelExecution(ctx, *lease, background.ID); err != nil {
		t.Fatal(err)
	}
	if err = service.Release(ctx, *lease, "one command stopped"); err == nil {
		t.Fatal("other running command lost its hold")
	}
	if err = service.CancelExecution(ctx, *lease, later.ID); err != nil {
		t.Fatal(err)
	}
	if err = service.Release(ctx, *lease, "job complete"); err != nil {
		t.Fatal(err)
	}
	if err = service.Transition(ctx, v.ID, "delete", cryptox.ID(), false); err != nil {
		t.Fatal(err)
	}
	if after := counts(); after != before {
		t.Fatal("standalone sandbox created Agent/product records", before, after)
	}
	var active int
	if err = f.Store.db.GetContext(ctx, &active, `SELECT (SELECT COUNT(*) FROM sandbox_lease WHERE sandbox_instance_id=? AND released_at IS NULL)+(SELECT COUNT(*) FROM sandbox_execution WHERE sandbox_instance_id=? AND finished_at IS NULL)+(SELECT COUNT(*) FROM sandbox_operation WHERE sandbox_instance_id=? AND finished_at IS NULL)`, v.ID, v.ID, v.ID); err != nil || active != 0 {
		t.Fatal("standalone resource holds leaked", active, err)
	}
}
