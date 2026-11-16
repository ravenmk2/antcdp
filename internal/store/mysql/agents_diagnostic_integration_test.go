package mysql

import (
	"encoding/json"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func runtimeDiagnostics(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "diagnostic persistence")
	step, err := f.Agents.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := core.ContentHash(step.Request)
	if err != nil {
		t.Fatal(err)
	}
	attempt, err := f.Agents.FreezeAttempt(f.Context, x.Ref, core.AttemptDraft{Step: step, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now(), 30, x.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}})
	if err != nil {
		t.Fatal(err)
	}
	var revision uint64
	if err = f.Store.db.GetContext(f.Context, &revision, "SELECT surface_revision FROM agent_session WHERE id=?", x.Ref.SessionID); err != nil {
		t.Fatal(err)
	}
	result := core.AttemptResult{Permit: attempt.Permit, Outcome: core.AttemptOutcome{Err: &modeladapters.RemoteError{Status: 422}}}
	commit, err := f.Agents.CompleteAttempt(f.Context, x.Ref, result)
	if err != nil || commit.Retry || len(commit.Calls) != 0 {
		t.Fatal("diagnostic affected retry or tool dispatch", err, commit)
	}
	replay, err := f.Agents.CompleteAttempt(f.Context, x.Ref, result)
	if err != nil || replay.AssistantSeq != commit.AssistantSeq {
		t.Fatal("duplicate attempt", err)
	}
	assertDiagnosticEvent(t, f, x.Ref.SessionID, commit.AssistantSeq, 422)
	end := core.RunEnd{Status: core.Failed, Reason: "EXECUTION_FAILED", Diagnostic: &diagnostic.Detail{Source: "sandbox", Stage: "prepare", Code: "SANDBOX_AUTHENTICATION_FAILED", HTTPStatus: 403}}
	receipt, err := f.Agents.EndRoot(f.Context, x.Ref, end)
	if err != nil {
		t.Fatal(err)
	}
	var endSeq core.Seq
	if err = f.Store.db.GetContext(f.Context, &endSeq, "SELECT seq FROM agent_event WHERE session_id=? AND run_id=? AND event_type='run/ended'", x.Ref.SessionID, x.Ref.RunID); err != nil {
		t.Fatal(err)
	}
	if len(receipt.Ranges) != 1 || receipt.Ranges[0].From > endSeq || receipt.Ranges[0].Through < endSeq {
		t.Fatal("terminal event absent from committed receipt", receipt)
	}
	assertDiagnosticEvent(t, f, x.Ref.SessionID, endSeq, 403)
	end.Diagnostic.HTTPStatus = 500
	again, err := f.Agents.EndRoot(f.Context, x.Ref, end)
	if err != nil || len(again.Ranges) != 1 || again.Ranges[0].Through != endSeq {
		t.Fatal("duplicate terminal event", err)
	}
	assertDiagnosticEvent(t, f, x.Ref.SessionID, endSeq, 403)
	var after uint64
	if err = f.Store.db.GetContext(f.Context, &after, "SELECT surface_revision FROM agent_session WHERE id=?", x.Ref.SessionID); err != nil || after != revision {
		t.Fatal("display diagnostic changed model context", revision, after, err)
	}
}

func assertDiagnosticEvent(t *testing.T, f *agentIntegrationFixture, session core.ID, seq core.Seq, status int) {
	t.Helper()
	var raw string
	if err := f.Store.db.GetContext(f.Context, &raw, "SELECT payload FROM agent_event WHERE session_id=? AND seq=?", session, seq); err != nil {
		t.Fatal(err)
	}
	var event struct {
		Public json.RawMessage `json:"public"`
	}
	if json.Unmarshal([]byte(raw), &event) != nil {
		t.Fatal("invalid stored event")
	}
	detail := diagnostic.Read(event.Public)
	if detail == nil || detail.HTTPStatus != status {
		t.Fatal("diagnostic not durably retained", raw)
	}
	history, err := f.Agents.History(f.Context, f.AdminToken, uint64(session), a.HistoryQuery{Limit: 200})
	if err != nil {
		t.Fatal("history integrity or projection failed", err)
	}
	found := false
	for _, record := range history.Data.(a.HistoryPage).Records {
		if record.Seq == seq {
			found = true
			public, err := json.Marshal(record.Data)
			if err != nil || diagnostic.Read(public) == nil || diagnostic.Read(public).HTTPStatus != status {
				t.Fatal("public replay lost details", err)
			}
		}
	}
	if !found {
		t.Fatal("event absent from replay")
	}
}
