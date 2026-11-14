package mysql

import (
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func claimQueuedTurn(t *testing.T, f *agentIntegrationFixture, session, input uint64) core.ExecutionContext {
	t.Helper()
	claim, err := f.Agents.ClaimRoot(f.Context, core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session), InputID: core.ID(input)}, Epoch: f.Agents.Epoch})
	if err != nil || !claim.Claimed {
		t.Fatalf("queued input was not admitted: %v", err)
	}
	return claim.Execution
}

func turnPendingResponse(t *testing.T, f *agentIntegrationFixture, interaction core.ID) uint64 {
	t.Helper()
	var input uint64
	if err := f.Store.db.GetContext(f.Context, &input, "SELECT pending_reply_input_id FROM agent_interaction WHERE id=?", uint64(interaction)); err != nil {
		t.Fatal(err)
	}
	return input
}

func runtimeTurnLifecycle(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	svc, ctx, raw := f.Agents, f.Context, f.AdminToken
	t.Run("local_worker_retains_session_slot", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "worker lifecycle")
		if err := svc.WorkerStarted(ctx, x.Ref); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Cancelled}); err != nil {
			t.Fatal(err)
		}
		var pending int
		if err := f.Store.db.GetContext(ctx, &pending, "SELECT COUNT(*) FROM agent_run WHERE id=? AND finished_at IS NOT NULL AND settled_at IS NULL", uint64(x.Ref.RunID)); err != nil || pending != 1 {
			t.Fatal("worker did not retain slot", err)
		}
		if err := svc.WorkerStopped(ctx, x.Ref); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
			t.Fatal(err)
		}
		if err := f.Store.db.GetContext(ctx, &pending, "SELECT COUNT(*) FROM agent_run WHERE id=? AND settled_at IS NULL", uint64(x.Ref.RunID)); err != nil || pending != 0 {
			t.Fatal("stopped worker did not release slot", err)
		}
	})
	t.Run("fifo", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "first")
		queued, err := svc.SubmitInput(ctx, raw, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "second"}}})
		if err != nil {
			t.Fatal(err)
		}
		boundary, err := svc.BeginStep(ctx, x.Ref, 1)
		if err != nil || len(boundary.InputIDs) != 0 {
			t.Fatalf("new input entered current turn: %v", err)
		}
		runtimeEnd(t, f, x)
		next := claimQueuedTurn(t, f, session.Configuration.ID, queued.Data.(a.InputAccepted).InputID)
		if next.Ref.RootRunID == x.Ref.RootRunID {
			t.Fatal("next message reused root")
		}
		runtimeEnd(t, f, next)
	})
	t.Run("question_response_starts_new_turn", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "ask a question")
		attempt := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "question", Name: "ask_user_question", Arguments: runtimeQuestionArgs}}})
		wait, err := svc.PrepareDispatch(ctx, x.Ref, attempt.Calls[0].ID)
		if err != nil || wait.Kind != "await_interaction" || wait.InteractionID == nil {
			t.Fatalf("question was not persisted: %+v %v", wait, err)
		}
		if _, err = svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.WaitingInput}); err != nil {
			t.Fatal(err)
		}
		q, err := svc.GetInteraction(ctx, raw, uint64(*wait.InteractionID))
		if err != nil {
			t.Fatal(err)
		}
		_, err = svc.AnswerInteraction(ctx, raw, uint64(*wait.InteractionID), q.Tag, cryptox.ID(), core.QuestionAnswer{Answers: []core.AnswerItem{{QuestionID: "q1", OptionIDs: []string{"yes"}}}})
		if err != nil {
			t.Fatal(err)
		}
		next := claimQueuedTurn(t, f, session.Configuration.ID, turnPendingResponse(t, f, *wait.InteractionID))
		if next.Ref.RunID == x.Ref.RunID {
			t.Fatal("answer resumed old authority")
		}
		runtimeEnd(t, f, next)
	})
	t.Run("late_question_reply_steers_running_turn", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "ask then continue independent work")
		attempt := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "question", Name: "ask_user_question", Arguments: runtimeQuestionArgs}}})
		wait, err := svc.PrepareDispatch(ctx, x.Ref, attempt.Calls[0].ID)
		if err != nil || wait.InteractionID == nil {
			t.Fatal("question admission", err)
		}
		if _, err = svc.ConvergeDue(ctx, time.Now().UTC().Add(6*time.Second), 100); err != nil {
			t.Fatal(err)
		}
		pending, err := svc.LookupCompletion(ctx, attempt.Calls[0].ID)
		if err != nil || !strings.Contains(pending.Result.Content, `"pending":true`) {
			t.Fatal("missing pending result", err)
		}
		q, err := svc.GetInteraction(ctx, raw, uint64(*wait.InteractionID))
		if err != nil {
			t.Fatal(err)
		}
		answer, err := svc.AnswerInteraction(ctx, raw, uint64(*wait.InteractionID), q.Tag, cryptox.ID(), core.QuestionAnswer{Answers: []core.AnswerItem{{QuestionID: "q1", OptionIDs: []string{"yes"}}}})
		if err != nil || answer.Data.(map[string]any)["delivery"] != "next_step" {
			t.Fatal("late reply not steered", err)
		}
		inputID := turnPendingResponse(t, f, *wait.InteractionID)
		runtimeAttempt(t, f, x, 2, modelcore.Message{Role: "assistant", Content: "Received the late answer in the same turn"})
		var claimedRun uint64
		if err = f.Store.db.GetContext(ctx, &claimedRun, "SELECT claimed_run_id FROM agent_input WHERE id=?", inputID); err != nil || claimedRun != uint64(x.Ref.RunID) {
			t.Fatal("reply started a new turn", err)
		}
		input, err := svc.GetInput(ctx, raw, session.Configuration.ID, inputID)
		if err != nil {
			t.Fatal(err)
		}
		view := input.Data.(a.InputView)
		if view.QuestionContext == nil || view.Source == nil || view.QuestionContext.ToolCallID != attempt.Calls[0].ID || view.Delivery != "next_step" {
			t.Fatalf("reply lost question context: %+v", view)
		}
		unchanged, err := svc.LookupCompletion(ctx, attempt.Calls[0].ID)
		if err != nil || unchanged.Result.Content != pending.Result.Content {
			t.Fatal("late reply rewrote original result", err)
		}
		runtimeEnd(t, f, x)
	})
	t.Run("approval_is_reauthorized_in_new_turn", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "request approval")
		attempt := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "effect", Name: "effect", Arguments: `{}`}}})
		wait, err := svc.PrepareDispatch(ctx, x.Ref, attempt.Calls[0].ID)
		if err != nil || wait.Kind != "await_interaction" || wait.InteractionID == nil {
			t.Fatalf("approval was not persisted: %+v %v", wait, err)
		}
		if _, err = svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.WaitingInput}); err != nil {
			t.Fatal(err)
		}
		q, err := svc.GetInteraction(ctx, raw, uint64(*wait.InteractionID))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = svc.DecideInteraction(ctx, raw, uint64(*wait.InteractionID), q.Tag, cryptox.ID(), a.DecisionWrite{Decision: "approve_once"}); err != nil {
			t.Fatal(err)
		}
		if _, err = svc.PrepareDispatch(ctx, x.Ref, attempt.Calls[0].ID); err == nil {
			t.Fatal("old tool intent was revived")
		}
		next := claimQueuedTurn(t, f, session.Configuration.ID, turnPendingResponse(t, f, *wait.InteractionID))
		newAttempt := runtimeAttempt(t, f, next, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "new-effect", Name: "effect", Arguments: `{}`}}})
		permit, err := svc.PrepareDispatch(ctx, next.Ref, newAttempt.Calls[0].ID)
		if err != nil || permit.Kind != "execute" {
			t.Fatalf("matching fresh action did not consume approval: %s %v", permit.Kind, err)
		}
		yes := true
		if _, err = svc.CompleteTool(ctx, next.Ref, core.ToolResult{Call: newAttempt.Calls[0], Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: "done"}}); err != nil {
			t.Fatal(err)
		}
		runtimeEnd(t, f, next)
	})
	t.Run("physical_unknown_retains_session_slot", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "external action")
		attempt := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "echo", Name: "echo", Arguments: `{}`}}})
		if permit, err := svc.PrepareDispatch(ctx, x.Ref, attempt.Calls[0].ID); err != nil || permit.Kind != "execute" {
			t.Fatalf("dispatch: %v", err)
		}
		queued, err := svc.SubmitInput(ctx, raw, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "wait for cleanup"}}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Failed}); err != nil {
			t.Fatal(err)
		}
		request := core.ClaimRequest{Candidate: core.Candidate{SessionID: x.Ref.SessionID, InputID: core.ID(queued.Data.(a.InputAccepted).InputID)}, Epoch: svc.Epoch}
		claim, err := svc.ClaimRoot(ctx, request)
		if err != nil || claim.Claimed {
			t.Fatalf("unknown physical execution released session: %v", err)
		}
		no := false
		if _, err = svc.RecordReconciliation(ctx, core.ReconciliationEvidence{Ref: x.Ref, CallID: attempt.Calls[0].ID, ObservedStatus: "cancelled", Executed: &no, ObservedAt: time.Now().UTC()}); err != nil {
			t.Fatal(err)
		}
		if _, err = svc.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
			t.Fatal(err)
		}
		next := claimQueuedTurn(t, f, session.Configuration.ID, queued.Data.(a.InputAccepted).InputID)
		runtimeEnd(t, f, next)
	})
}
