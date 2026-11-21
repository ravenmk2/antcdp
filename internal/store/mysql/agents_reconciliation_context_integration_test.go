package mysql

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func runtimeReconciliationContext(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	for _, status := range []string{"succeeded", "failed", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			session := runtimeSession(t, f, agent)
			x := runtimeClaim(t, f, session.Configuration.ID, "inspect external effect")
			first := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "original-effect", Name: "echo", Arguments: `{}`}}})
			call := first.Calls[0]
			permit, err := f.Agents.PrepareDispatch(f.Context, x.Ref, call.ID)
			if err != nil || permit.Kind != "execute" {
				t.Fatal("dispatch", err)
			}
			_, err = f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "outcome_unknown", Content: "effect outcome is unknown", Reason: "lost_callback"}})
			if err != nil {
				t.Fatal(err)
			}
			var originalHash string
			if err = f.Store.db.GetContext(f.Context, &originalHash, "SELECT HEX(payload_sha256) FROM agent_event WHERE session_id=? AND event_type='tool/result'", session.Configuration.ID); err != nil {
				t.Fatal(err)
			}
			step, err := f.Agents.PrepareStep(f.Context, x, 2)
			if err != nil {
				t.Fatal(err)
			}
			hash, err := core.ContentHash(step.Request)
			if err != nil {
				t.Fatal(err)
			}
			draft := core.AttemptDraft{Step: step, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now(), 30, x.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}}
			attempt, err := f.Agents.FreezeAttempt(f.Context, x.Ref, draft)
			if err != nil {
				t.Fatal(err)
			}
			failed, err := f.Agents.CompleteAttempt(f.Context, x.Ref, core.AttemptResult{Permit: attempt.Permit, Outcome: core.AttemptOutcome{Err: modelcore.ErrIncompleteStream, StreamStarted: true}})
			if err != nil || !failed.Retry {
				t.Fatal("retry not admitted", err)
			}
			var executed *bool
			if status != "cancelled" {
				executed = new(true)
			}
			evidence := core.ReconciliationEvidence{Ref: x.Ref, CallID: call.ID, ObservedStatus: status, Executed: executed, ObservedAt: time.Now().UTC(), Reason: "physical_execution_ended"}
			if _, err = f.Agents.RecordReconciliation(f.Context, evidence); err != nil {
				t.Fatal(err)
			}
			if _, err = f.Agents.RecordReconciliation(f.Context, evidence); err != nil {
				t.Fatal("duplicate observation", err)
			}
			var contexts int
			countContexts := func() int {
				t.Helper()
				if err = f.Store.db.GetContext(f.Context, &contexts, "SELECT COUNT(*) FROM agent_event WHERE session_id=? AND event_type='context/message' AND payload->>'$.public.source.kind'='tool-reconciliation'", session.Configuration.ID); err != nil {
					t.Fatal(err)
				}
				return contexts
			}
			if countContexts() != 0 {
				t.Fatal("context entered an in-flight request")
			}
			time.Sleep(failed.RetryAfter + time.Millisecond)
			draft.Attempt = 2
			retried, err := f.Agents.FreezeAttempt(f.Context, x.Ref, draft)
			if err != nil {
				t.Fatal("asynchronous observation invalidated frozen retry", err)
			}
			zero := int64(0)
			_, err = f.Agents.CompleteAttempt(f.Context, x.Ref, core.AttemptResult{Permit: retried.Permit, Outcome: core.AttemptOutcome{Response: modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "continue inspecting"}, Usage: modelcore.Usage{InputTokens: &zero, OutputTokens: &zero}}}})
			if err != nil {
				t.Fatal(err)
			}
			next, err := f.Agents.PrepareStep(f.Context, x, 3)
			if err != nil {
				t.Fatal("admit observation", err)
			}
			if countContexts() != 1 || !reflect.DeepEqual(step.Request.Messages, next.Request.Messages[:len(step.Request.Messages)]) {
				t.Fatal("observation duplicated or rewrote prefix")
			}
			var found bool
			for _, message := range next.Request.Messages {
				if !strings.HasPrefix(message.Content, "<system-reminder>\nUpdated tool execution result:\n") {
					continue
				}
				found = true
				if !strings.Contains(message.Content, `"observed_status":"`+status+`"`) || !strings.Contains(message.Content, `"provider_call_id":"original-effect"`) || (status == "cancelled" && !strings.Contains(message.Content, `"executed":null`)) {
					t.Fatal("incorrect evidence", message.Content)
				}
			}
			if !found {
				t.Fatal("model did not receive verified evidence")
			}
			var currentHash string
			if err = f.Store.db.GetContext(f.Context, &currentHash, "SELECT HEX(payload_sha256) FROM agent_event WHERE session_id=? AND event_type='tool/result'", session.Configuration.ID); err != nil || currentHash != originalHash {
				t.Fatal("original result was changed", err)
			}
			runtimeEnd(t, f, x)
			resumed := runtimeClaim(t, f, session.Configuration.ID, "continue next turn")
			prepared, err := f.Agents.PrepareStep(f.Context, resumed, 1)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(prepared.Request.Messages)
			if err != nil || strings.Count(string(encoded), "Updated tool execution result:") != 1 || countContexts() != 1 {
				t.Fatal("replay duplicated or lost observation", err)
			}
			runtimeEnd(t, f, resumed)
		})
	}
}
