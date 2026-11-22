package eino

import (
	"context"
	"errors"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type contextRecoveryHooks struct {
	*engineHooks
	recoveries int
	changed    bool
}

func (h *contextRecoveryHooks) CompleteAttempt(ctx context.Context, permit agentcore.AttemptPermit, out agentcore.AttemptOutcome) (agentcore.AttemptCommit, error) {
	commit, err := h.engineHooks.CompleteAttempt(ctx, permit, out)
	commit.RecoverContext = errors.Is(out.Err, modelcore.ErrContextWindowExceeded) && h.recoveries == 0
	return commit, err
}

func (h *contextRecoveryHooks) RecoverContext(_ context.Context, step agentcore.PreparedStep) (agentcore.PreparedStep, bool, error) {
	h.recoveries++
	step.Request.Messages = []modelcore.Message{{Role: "user", Content: "replacement checkpoint"}}
	return step, h.changed, nil
}

func TestContextOverflowRetriesOnlyOnceAfterDurableReduction(t *testing.T) {
	for _, test := range []struct {
		name              string
		changed, repeated bool
		wantCalls         int
	}{
		{"recovered", true, false, 2}, {"no progress", false, false, 1}, {"bounded", true, true, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "test", Fence: 1}
			h := &contextRecoveryHooks{engineHooks: &engineHooks{ref: ref}, changed: test.changed}
			h.prepare = func(step uint32) agentcore.PreparedStep {
				return agentcore.PreparedStep{Ref: ref, Step: step, MaxParallelTools: 1, Request: modelcore.Request{Model: "test", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "long input"}}}}
			}
			calls := 0
			h.client = &scriptedClient{invoke: func(_ context.Context, _ int, request modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
				calls++
				if calls == 1 || test.repeated {
					return modelcore.Response{}, modelcore.ErrContextWindowExceeded
				}
				if request.Messages[0].Content != "replacement checkpoint" {
					t.Fatal("retried original request")
				}
				return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "done"}}, nil
			}}
			err := (Engine{MaxSteps: 3}).Execute(t.Context(), ref, h)
			if calls != test.wantCalls || h.recoveries != 1 || len(h.prepared) != 1 || len(h.dispatch) != 0 {
				t.Fatal("recovery repeated work", calls, h.recoveries, h.prepared)
			}
			if test.changed && !test.repeated {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, modelcore.ErrContextWindowExceeded) {
				t.Fatal("original overflow lost", err)
			}
		})
	}
}
