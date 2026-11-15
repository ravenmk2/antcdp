package mysql

import (
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func assertRunSteps(t *testing.T, f *agentIntegrationFixture, x core.ExecutionContext, current, ended uint64) {
	t.Helper()
	r, err := f.Agents.GetRun(f.Context, f.AdminToken, uint64(x.Ref.RunID))
	if err != nil {
		t.Fatal(err)
	}
	run := r.Data.(a.RunDetail)
	if run.CurrentStep != current || run.Steps != ended {
		t.Fatalf("current/ended steps = %d/%d, want %d/%d", run.CurrentStep, run.Steps, current, ended)
	}
	var events uint64
	if err = f.Store.db.GetContext(f.Context, &events, "SELECT COUNT(*) FROM agent_event WHERE run_id=? AND event_type='step/ended'", x.Ref.RunID); err != nil || events != ended {
		t.Fatal("step endings must be exactly once", events, ended, err)
	}
}

func runtimeStepStatistics(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "step statistics")
	assertRunSteps(t, f, x, 0, 0)
	if _, err := f.Agents.PrepareStep(f.Context, x, 1); err != nil {
		t.Fatal(err)
	}
	assertRunSteps(t, f, x, 1, 0)
	if _, err := f.Agents.PrepareStep(f.Context, x, 1); err == nil {
		t.Fatal("repeated step admitted")
	}
	assertRunSteps(t, f, x, 1, 0)
	if _, err := f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Cancelled}); err != nil {
		t.Fatal(err)
	}
	assertRunSteps(t, f, x, 1, 1)
	if _, err := f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Cancelled}); err != nil {
		t.Fatal(err)
	}
	assertRunSteps(t, f, x, 1, 1)
	x = runtimeClaim(t, f, session.Configuration.ID, "zero step failure")
	if _, err := f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Failed, Reason: "setup_failed"}); err != nil {
		t.Fatal(err)
	}
	assertRunSteps(t, f, x, 0, 0)
	usage, err := f.Agents.SessionUsage(f.Context, f.AdminToken, session.Configuration.ID)
	if err != nil {
		t.Fatal(err)
	}
	activity := usage.Data.(a.SessionUsageReport).SessionActivity
	if activity.Runs != 2 || activity.Steps != 1 {
		t.Fatal("session must count started runs and ended steps", activity)
	}
}
