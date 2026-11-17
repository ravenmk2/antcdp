package mysql

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func runtimeContextMeter(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	svc := f.Agents
	oldCounter, oldModels, oldCompactor := svc.Tokens, svc.RuntimeModels, svc.Compactor
	t.Cleanup(func() { svc.Tokens, svc.RuntimeModels, svc.Compactor = oldCounter, oldModels, oldCompactor })
	svc.Tokens = modelcore.RequestTokenCounter{}
	model := &runtimeSummaryModel{text: "Earlier work checked; keep current user constraints and continue pending work."}
	svc.RuntimeModels = model
	svc.Compactor = &core.Compactor{Store: svc, Models: svc, Tokens: svc.Tokens}
	session := runtimeSession(t, f, agent)
	read := func() a.ContextUsage {
		t.Helper()
		report, err := svc.SessionUsage(f.Context, f.AdminToken, session.Configuration.ID)
		if err != nil {
			t.Fatal("read pressure", err)
		}
		return report.Data.(a.SessionUsageReport).Context
	}
	if got := read(); got.Projected != nil {
		t.Fatal("unstarted session has invented input", got)
	}
	x := runtimeClaim(t, f, session.Configuration.ID, "Keep the latest instruction verbatim.")
	prepared, err := svc.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	before := read()
	expected, _ := svc.Tokens.Count(prepared.Request)
	if before.Projected == nil || *before.Projected != expected || before.MeasurementSource != "estimated" {
		t.Fatal("UI and admission disagree", before, expected)
	}
	commit := runtimePreparedAttempt(t, f, x, prepared, modelcore.Message{Role: "assistant", Content: strings.Repeat("verified historical evidence ", 300), ToolCalls: []modelcore.ToolCall{{ID: "meter-tool", Name: "echo", Arguments: `{}`}}})
	// The committed declaration is measurable before its result exists, but
	// remains ineligible for a model request or compaction range.
	pending := read()
	if pending.Projected == nil || *pending.Projected <= *before.Projected {
		t.Fatal("pending tool declaration not reflected", pending)
	}
	if _, err = svc.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID); err != nil {
		t.Fatal(err)
	}
	yes := true
	if _, err = svc.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: commit.Calls[0], Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: strings.Repeat("result evidence ", 500)}}); err != nil {
		t.Fatal(err)
	}
	withResult := read()
	if withResult.Projected == nil || *withResult.Projected <= *pending.Projected {
		t.Fatal("committed tool result did not increase pressure")
	}
	// Anchor against actual total input (which includes cache), then survive
	// reload from the database and subsequent context replacement.
	var callID uint64
	if err = f.Store.db.GetContext(f.Context, &callID, "SELECT id FROM agent_model_call WHERE session_id=? AND purpose='generation' ORDER BY id DESC LIMIT 1", session.Configuration.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.Store.db.ExecContext(f.Context, "UPDATE agent_model_call SET input_tokens=?, cache_read_tokens=? WHERE id=?", expected+100, expected, callID); err != nil {
		t.Fatal(err)
	}
	anchored := read()
	if anchored.Projected == nil || anchored.Estimated == nil || *anchored.Projected != *anchored.Estimated+100 || anchored.MeasurementSource != "usage_adjusted" {
		t.Fatal("actual usage counted incorrectly", anchored)
	}
	// Old snapshots are reconstructed using their historical manifest.
	if _, err = f.Store.db.ExecContext(f.Context, "UPDATE agent_model_call SET request_config=JSON_REMOVE(request_config,'$.input_estimate_tokens') WHERE id=?", callID); err != nil {
		t.Fatal(err)
	}
	legacy := read()
	if legacy.Projected == nil || *legacy.Projected != *anchored.Projected {
		t.Fatal("legacy snapshot pressure drift", legacy, anchored)
	}
	runtimeAttempt(t, f, x, 2, modelcore.Message{Role: "assistant", Content: "Ready for the next step."})
	runtimeEnd(t, f, x)
	beforeCompact := read()
	if _, err = svc.CompactSession(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID()); err != nil {
		t.Fatal("manual compaction", err)
	}
	if err = svc.ProcessPendingCompactions(f.Context, 10); err != nil {
		t.Fatal(err)
	}
	after := read()
	if after.Projected == nil || *after.Projected >= *beforeCompact.Projected || !after.Stale {
		t.Fatal("compaction not reflected before next request", beforeCompact, after)
	}
	// Continue through the real preparation path with the new surface and
	// assert the API reads exactly the same input estimate.
	x = runtimeClaim(t, f, session.Configuration.ID, "Continue the remaining work.")
	prepared, err = svc.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ = svc.Tokens.Count(prepared.Request)
	continued := read()
	if continued.Projected == nil || *continued.Projected != expected {
		t.Fatal("post-compaction UI diverges from request", continued, expected)
	}
	encoded, _ := json.Marshal(prepared.Request.Messages)
	if !strings.Contains(string(encoded), model.text) {
		t.Fatal("replacement missing from next request")
	}
	runtimePreparedAttempt(t, f, x, prepared, modelcore.Message{Role: "assistant", Content: strings.Repeat("new verified evidence ", 500)})
	runtimeEnd(t, f, x)

	// A provider rejection is committed first. Recovery must replace durable
	// history and permit attempt two of this same step without preparing again.
	x = runtimeClaim(t, f, session.Configuration.ID, "Keep working after provider overflow.")
	prepared, err = svc.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	beforeOverflow, _ := svc.Tokens.Count(prepared.Request)
	finishAttempt := func(attempt uint32, outcome core.AttemptOutcome) {
		t.Helper()
		hash, e := core.ContentHash(prepared.Request)
		if e != nil {
			t.Fatal(e)
		}
		frozen, e := svc.FreezeAttempt(f.Context, x.Ref, core.AttemptDraft{Step: prepared, Attempt: attempt, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now().UTC(), 30, x.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: beforeOverflow, OutputTokens: 100}})
		if e != nil {
			t.Fatal("freeze recovery attempt", e)
		}
		committed, e := svc.CompleteAttempt(f.Context, x.Ref, core.AttemptResult{Permit: frozen.Permit, Outcome: outcome})
		if e != nil || committed.Failure != nil {
			t.Fatal("commit recovery attempt", e, committed.Failure)
		}
	}
	finishAttempt(1, core.AttemptOutcome{Err: modelcore.ErrContextWindowExceeded})
	var changed bool
	prepared, changed, err = svc.CompactOverflow(f.Context, x, prepared)
	if err != nil || !changed || prepared.Step != 1 {
		t.Fatal("durable overflow recovery", changed, err)
	}
	afterOverflow, _ := svc.Tokens.Count(prepared.Request)
	if afterOverflow >= beforeOverflow {
		t.Fatal("overflow retry did not reduce request", beforeOverflow, afterOverflow)
	}
	finishAttempt(2, core.AttemptOutcome{Response: modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "Recovered."}}})
	runtimeEnd(t, f, x)
}
