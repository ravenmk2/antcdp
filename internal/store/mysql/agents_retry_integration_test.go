package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/eino"
	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func runtimeModelRetry(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	t.Run("http_engine_store_recovery", func(t *testing.T) { runtimeRetryHTTP(t, f, agent) })
	for _, mode := range []string{"recover", "stop", "restart", "budget", "cancelled_output", "generation_limit", "generation_limit_reasoning_only", "output_limit"} {
		t.Run(mode, func(t *testing.T) {
			session := runtimeSession(t, f, agent)
			x := runtimeClaim(t, f, session.Configuration.ID, "retry integration task")
			step, err := f.Agents.PrepareStep(f.Context, x, 1)
			if err != nil {
				t.Fatal(err)
			}
			hash, err := core.ContentHash(step.Request)
			if err != nil {
				t.Fatal(err)
			}
			reservation := core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}
			if mode == "budget" {
				reservation.InputTokens = x.Policy.MaxInputTokens
			}
			draft := core.AttemptDraft{Step: step, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now(), 30, x.Deadline), Reservation: reservation}
			first, err := f.Agents.FreezeAttempt(f.Context, x.Ref, draft)
			if err != nil {
				t.Fatal(err)
			}
			outcome := core.AttemptOutcome{Err: modelcore.ErrIncompleteStream, StreamStarted: true, Response: modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "failed fragment must not enter context", Reasoning: "failed thinking", ToolCalls: []modelcore.ToolCall{{ID: "unsafe-fragment", Name: "effect", Arguments: `{}`}}}}}
			if mode == "cancelled_output" {
				outcome.Cancelled = true
			}
			if strings.HasPrefix(mode, "generation_limit") {
				outcome.Err = modelcore.ErrGenerationLimit
				outcome.Response.Message.NativeProtocol = modelcore.AnthropicMessages
				outcome.Response.Message.Native = json.RawMessage(`{"role":"assistant","content":[{"type":"thinking","signature":"unsafe-signature"}]}`)
				if mode == "generation_limit_reasoning_only" {
					outcome.Response.Message.Content = ""
				}
			}
			if mode == "output_limit" {
				outcome.Err = modelcore.ErrOutputLimit
			}
			result := core.AttemptResult{Permit: first.Permit, Outcome: outcome}
			commit, err := f.Agents.CompleteAttempt(f.Context, x.Ref, result)
			if err != nil || commit.Failure != nil || len(commit.Calls) != 0 {
				t.Fatal("failed attempt settlement", err, commit)
			}
			var tools int
			if err = f.Store.db.GetContext(f.Context, &tools, "SELECT COUNT(*) FROM agent_tool_call WHERE run_id=?", x.Ref.RunID); err != nil || tools != 0 {
				t.Fatal("partial tool dispatched", tools, err)
			}
			wantRetry := mode != "budget" && mode != "cancelled_output" && !strings.HasPrefix(mode, "generation_limit") && mode != "output_limit"
			if commit.Retry != wantRetry {
				t.Fatal("retry eligibility", commit.Retry, mode)
			}
			if mode == "budget" {
				var reserved string
				if err = f.Store.db.GetContext(f.Context, &reserved, "SELECT budget_reserved FROM agent_run WHERE id=?", x.Ref.RunID); err != nil {
					t.Fatal(err)
				}
				var budget core.Budget
				if json.Unmarshal([]byte(reserved), &budget) != nil || budget.InputTokens != reservation.InputTokens {
					t.Fatal("unknown usage reservation released", reserved)
				}
			}
			if !wantRetry {
				if _, err = f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Cancelled, Reason: "test_finished"}); err != nil {
					t.Fatal(err)
				}
				if mode == "cancelled_output" || strings.HasPrefix(mode, "generation_limit") || mode == "output_limit" {
					nextRun := runtimeClaim(t, f, session.Configuration.ID, "continue after stop")
					next, e := f.Agents.PrepareStep(f.Context, nextRun, 1)
					if e != nil {
						t.Fatal(e)
					}
					encoded, e := json.Marshal(next.Request.Messages)
					wantText := mode == "cancelled_output" || mode == "generation_limit"
					if e != nil || strings.Contains(string(encoded), "failed fragment") != wantText || strings.Contains(string(encoded), "unsafe-fragment") || strings.Contains(string(encoded), "unsafe-signature") || strings.Contains(string(encoded), "failed thinking") {
						t.Fatal("partial output was not preserved safely", mode, string(encoded), e)
					}
					if strings.Contains(string(encoded), "Output limit reached") != (mode == "generation_limit") {
						t.Fatal("incorrect partial-answer provenance", mode, string(encoded))
					}
					runtimeEnd(t, f, nextRun)
				}
				return
			}
			again, err := f.Agents.CompleteAttempt(f.Context, x.Ref, result)
			if err != nil || !again.Retry || again.Failure != nil || again.AssistantSeq != commit.AssistantSeq || again.RetryAfter > commit.RetryAfter {
				t.Fatal("retry decision not idempotent", again, err)
			}
			if mode == "stop" {
				if _, err = f.Agents.StopRun(f.Context, f.AdminToken, uint64(x.Ref.RunID), cryptox.ID(), a.StopRunWrite{}); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "restart" {
				if _, err = f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Interrupted, Reason: "executor_restarted"}); err != nil {
					t.Fatal(err)
				}
			}
			// Respect the actual durable schedule, rather than rewriting recorded facts.
			time.Sleep(again.RetryAfter + time.Millisecond)
			draft.Attempt = 2
			second, err := f.Agents.FreezeAttempt(f.Context, x.Ref, draft)
			if mode == "stop" || mode == "restart" {
				if err == nil {
					t.Fatal("closed execution admitted retry")
				}
				return
			}
			if err != nil {
				t.Fatal("retry frozen surface changed", err)
			}
			if _, err = f.Agents.FreezeAttempt(f.Context, x.Ref, draft); err == nil {
				t.Fatal("duplicate attempt admitted")
			}
			var started int
			if err = f.Store.db.GetContext(f.Context, &started, "SELECT COUNT(*) FROM agent_event WHERE run_id=? AND event_type='model/retry-started'", x.Ref.RunID); err != nil || started != 1 {
				t.Fatal("retry start observation", started, err)
			}
			zero := int64(0)
			response := modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "recovered tool", ToolCalls: []modelcore.ToolCall{{ID: "safe-complete", Name: "echo", Arguments: `{}`}}}, Usage: modelcore.Usage{InputTokens: &zero, OutputTokens: &zero}}
			success, err := f.Agents.CompleteAttempt(f.Context, x.Ref, core.AttemptResult{Permit: second.Permit, Outcome: core.AttemptOutcome{Response: response}})
			if err != nil || success.Retry || len(success.Calls) != 1 {
				t.Fatal("successful retry", success, err)
			}
			permit, err := f.Agents.PrepareDispatch(f.Context, x.Ref, success.Calls[0].ID)
			if err != nil || permit.Kind != "execute" {
				t.Fatal("dispatch", permit.Kind, err)
			}
			yes := true
			if _, err = f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: success.Calls[0], Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: "durable tool result"}}); err != nil {
				t.Fatal(err)
			}
			next, err := f.Agents.PrepareStep(f.Context, x, 2)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(next.Request.Messages)
			if err != nil || strings.Contains(string(encoded), "failed fragment") || strings.Contains(string(encoded), "failed thinking") || strings.Contains(string(encoded), "unsafe-fragment") || !strings.Contains(string(encoded), "durable tool result") {
				t.Fatal("failed output polluted next step", string(encoded), err)
			}
			runtimeEnd(t, f, x)
		})
	}
}

type retryClientFactory struct{ client modelcore.Client }

func (f retryClientFactory) Open(context.Context, core.LockedModel) (modelcore.Client, error) {
	return f.client, nil
}

type retryStoreHooks struct {
	*core.PersistentHooks
	service    *a.Service
	dispatched int
}

func (h *retryStoreHooks) InvokeTool(ctx context.Context, call core.PreparedToolCall) (core.ToolCompletion, error) {
	h.dispatched++
	permit, err := h.service.PrepareDispatch(ctx, call.Ref, call.ID)
	if err != nil {
		return core.ToolCompletion{}, err
	}
	if permit.Kind != "execute" {
		return core.ToolCompletion{}, fmt.Errorf("unexpected tool permission: %s", permit.Kind)
	}
	yes := true
	result, err := h.service.CompleteTool(ctx, call.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: "single durable effect"}})
	if err != nil {
		return core.ToolCompletion{}, err
	}
	return result.Result, nil
}

func runtimeRetryHTTP(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "recover two model failures then execute one tool")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Messages []modelcore.Message `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		n := requests.Add(1)
		if n == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		for _, message := range input.Messages {
			if strings.Contains(message.Content, "discarded fragment") {
				t.Error("failed attempt entered retried context")
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if n == 2 {
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"discarded fragment\"}}]}\n\n")
			return
		}
		if n == 3 {
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"once\",\"type\":\"function\",\"function\":{\"name\":\"echo\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		found := false
		for _, message := range input.Messages {
			found = found || message.Role == "tool" && message.Content == "single durable effect"
		}
		if n != 4 || !found {
			t.Error("unexpected next step or missing committed tool", n)
		}
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"recovered final answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	if x.Model.Protocol != modelcore.ChatCompletions {
		t.Fatal("fixture protocol changed")
	}
	client, err := modeladapters.NewClient(modeladapters.Config{Provider: modelcore.DeepSeek, Protocol: x.Model.Protocol, BaseURL: server.URL, APIKey: "synthetic-test"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	hooks := &retryStoreHooks{PersistentHooks: &core.PersistentHooks{Execution: x, Prepare: f.Agents.PrepareStep, Models: retryClientFactory{client}, Store: f.Agents, Estimate: func(modelcore.Request) (core.Budget, error) {
		return core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}, nil
	}}, service: f.Agents}
	if err = (eino.Engine{}).Execute(f.Context, x.Ref, hooks); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 4 || hooks.dispatched != 1 {
		t.Fatal("attempt/tool counts", requests.Load(), hooks.dispatched)
	}
	var attempts, starts int
	if err = f.Store.db.GetContext(f.Context, &attempts, "SELECT COUNT(*) FROM agent_model_call WHERE run_id=?", x.Ref.RunID); err != nil || attempts != 4 {
		t.Fatal("durable attempts", attempts, err)
	}
	if err = f.Store.db.GetContext(f.Context, &starts, "SELECT COUNT(*) FROM agent_event WHERE run_id=? AND event_type='model/retry-started'", x.Ref.RunID); err != nil || starts != 2 {
		t.Fatal("durable starts", starts, err)
	}
	runtimeEnd(t, f, x)
}
