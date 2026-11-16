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

func failContinuationAttempt(t *testing.T, f *agentIntegrationFixture, x core.ExecutionContext, cause error) {
	t.Helper()
	step, err := f.Agents.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	failPreparedContinuationAttempt(t, f, x, step, cause)
}

func failPreparedContinuationAttempt(t *testing.T, f *agentIntegrationFixture, x core.ExecutionContext, step core.PreparedStep, cause error) {
	t.Helper()
	hash, err := core.ContentHash(step.Request)
	if err != nil {
		t.Fatal(err)
	}
	attempt, err := f.Agents.FreezeAttempt(f.Context, x.Ref, core.AttemptDraft{Step: step, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now(), 30, x.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Agents.CompleteAttempt(f.Context, x.Ref, core.AttemptResult{Permit: attempt.Permit, Outcome: core.AttemptOutcome{Err: cause}}); err != nil {
		t.Fatal(err)
	}
}

func continuationView(t *testing.T, f *agentIntegrationFixture, session uint64) *a.ViewState {
	t.Helper()
	detail, err := f.Agents.GetSession(f.Context, f.AdminToken, session)
	if err != nil {
		t.Fatal(err)
	}
	return detail.Data.(a.SessionDetail).ViewState
}

func runtimeContinuation(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	svc, ctx, raw := f.Agents, f.Context, f.AdminToken
	t.Run("eligibility", func(t *testing.T) {
		for _, tc := range []struct {
			name    string
			cause   error
			status  core.RunStatus
			allowed bool
		}{
			{"transport", modelcore.ErrTransport, core.Failed, true},
			{"timeout", modelcore.ErrTransportTimeout, core.Failed, true},
			{"attempt_timeout", &core.Error{Code: "MODEL_ATTEMPT_TIMEOUT"}, core.Failed, true},
			{"rate_limit", modelcore.ErrRateLimited, core.Failed, true},
			{"server", modelcore.ErrRemoteService, core.Failed, true},
			{"empty", modelcore.ErrEmptyResponse, core.Failed, true},
			{"stream", modelcore.ErrIncompleteStream, core.Failed, true},
			{"authentication", modelcore.ErrAuthenticationFailed, core.Failed, false},
			{"invalid", modelcore.ErrInvalidResponse, core.Failed, false},
			{"generation_limit", modelcore.ErrGenerationLimit, core.Failed, false},
			{"preparation", nil, core.Failed, false},
			{"stopped", modelcore.ErrTransport, core.Cancelled, false},
			{"restarted", modelcore.ErrTransport, core.Interrupted, false},
		} {
			t.Run(tc.name, func(t *testing.T) {
				session := runtimeSession(t, f, agent)
				x := runtimeClaim(t, f, session.Configuration.ID, "你好呀")
				if tc.cause != nil {
					failContinuationAttempt(t, f, x, tc.cause)
				}
				if _, err := svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: tc.status, Reason: "EXECUTION_FAILED"}); err != nil {
					t.Fatal(err)
				}
				view := continuationView(t, f, session.Configuration.ID)
				if (view.Continuation != nil) != tc.allowed {
					t.Fatalf("continuation eligibility: %+v", view)
				}
				result, err := svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), cryptox.ID(), a.RetryRunWrite{ExpectedEndSeq: core.Seq(view.LatestResult.EndSeq)})
				if !tc.allowed {
					modelsExpectCode(t, err, "RUN_NOT_RETRYABLE")
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				next := claimQueuedTurn(t, f, session.Configuration.ID, result.Data.(a.InputAccepted).InputID)
				runtimeEnd(t, f, next)
			})
		}
	})
	t.Run("empty_control_preserves_original_request", func(t *testing.T) {
		other := runtimeSession(t, f, agent)
		prior := runtimeClaim(t, f, other.Configuration.ID, "Build the unrelated annual report")
		runtimeAttempt(t, f, prior, 1, modelcore.Message{Role: "assistant", Content: "Unrelated report is ready"})
		runtimeEnd(t, f, prior)
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "你好呀")
		failContinuationAttempt(t, f, x, modelcore.ErrTransport)
		for iteration := range 2 {
			if _, err := svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Failed, Reason: "EXECUTION_FAILED"}); err != nil {
				t.Fatal(err)
			}
			view := continuationView(t, f, session.Configuration.ID)
			request := a.RetryRunWrite{ExpectedEndSeq: core.Seq(view.LatestResult.EndSeq)}
			key := cryptox.ID()
			accepted, err := svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), key, request)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), key, request); err != nil {
				t.Fatal("same command must remain idempotent", err)
			}
			if continuationView(t, f, session.Configuration.ID).Continuation != nil {
				t.Fatal("queued continuation still offered")
			}
			_, err = svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), cryptox.ID(), request)
			modelsExpectCode(t, err, "RUN_NOT_RETRYABLE")
			x = claimQueuedTurn(t, f, session.Configuration.ID, accepted.Data.(a.InputAccepted).InputID)
			prepared, err := svc.PrepareStep(ctx, x, 1)
			if err != nil {
				t.Fatal(err)
			}
			var users []string
			for _, message := range prepared.Request.Messages {
				if message.Role == "user" && !strings.HasPrefix(message.Content, "[Platform context: ") {
					users = append(users, message.Content)
				}
				if strings.Contains(message.Content, "Unrelated report") || strings.Contains(message.Content, "unrelated annual report") {
					t.Fatal("other session entered retry context")
				}
			}
			if len(users) != 1 || users[0] != "你好呀" {
				t.Fatalf("retry changed task messages: %q", users)
			}
			if iteration == 0 {
				failPreparedContinuationAttempt(t, f, x, prepared, modelcore.ErrTransport)
			} else {
				runtimePreparedAttempt(t, f, x, prepared, modelcore.Message{Role: "assistant", Content: "你好！"})
			}
		}
		runtimeEnd(t, f, x)
		view := continuationView(t, f, session.Configuration.ID)
		if view.Continuation != nil {
			t.Fatal("completed generation still offered")
		}
	})
	t.Run("rejects_pending_input_and_stale_failure", func(t *testing.T) {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "first request")
		failContinuationAttempt(t, f, x, modelcore.ErrTransport)
		if _, err := svc.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Failed, Reason: "EXECUTION_FAILED"}); err != nil {
			t.Fatal(err)
		}
		view := continuationView(t, f, session.Configuration.ID)
		request := a.RetryRunWrite{ExpectedEndSeq: core.Seq(view.LatestResult.EndSeq)}
		_, err := svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), cryptox.ID(), a.RetryRunWrite{ExpectedEndSeq: request.ExpectedEndSeq + 1})
		modelsExpectCode(t, err, "RUN_END_CHANGED")
		queued, err := svc.SubmitInput(ctx, raw, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "new request"}}})
		if err != nil {
			t.Fatal(err)
		}
		if continuationView(t, f, session.Configuration.ID).Continuation != nil {
			t.Fatal("pending human input must suppress continuation")
		}
		_, err = svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), cryptox.ID(), request)
		modelsExpectCode(t, err, "RUN_NOT_RETRYABLE")
		next := claimQueuedTurn(t, f, session.Configuration.ID, queued.Data.(a.InputAccepted).InputID)
		_, err = svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), cryptox.ID(), request)
		modelsExpectCode(t, err, "RUN_NOT_RETRYABLE")
		failContinuationAttempt(t, f, next, modelcore.ErrTransport)
		if _, err = svc.EndRoot(ctx, next.Ref, core.RunEnd{Status: core.Failed, Reason: "EXECUTION_FAILED"}); err != nil {
			t.Fatal(err)
		}
		_, err = svc.RetryRun(ctx, raw, uint64(x.Ref.RunID), cryptox.ID(), request)
		modelsExpectCode(t, err, "RUN_NOT_RETRYABLE")
	})
}
