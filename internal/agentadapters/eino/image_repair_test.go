package eino

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type imageRepairHooks struct {
	*engineHooks
	repairs int
}

func (h *imageRepairHooks) RepairImageFiles(context.Context, agentcore.PreparedStep) (bool, error) {
	h.repairs++
	return true, nil
}
func TestImageFileRepairIsNewStepAndBounded(t *testing.T) {
	for _, repeat := range []bool{false, true} {
		ref := agentcore.ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}
		h := &imageRepairHooks{engineHooks: &engineHooks{ref: ref}}
		h.prepare = func(step uint32) agentcore.PreparedStep {
			return agentcore.PreparedStep{Ref: ref, Step: step, Request: modelcore.Request{Model: "vision", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "user", Content: "inspect"}}}, MaxParallelTools: 1}
		}
		h.client = &scriptedClient{invoke: func(_ context.Context, n int, _ modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
			if n == 1 || repeat {
				return modelcore.Response{}, modelcore.ErrImageFileRejected
			}
			return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "done"}}, nil
		}}
		err := (Engine{MaxSteps: 5}).Execute(t.Context(), ref, h)
		if repeat && !errors.Is(err, modelcore.ErrImageFileRejected) || !repeat && err != nil {
			t.Fatal(err)
		}
		if h.repairs != 1 || len(h.commits) != 2 || !reflect.DeepEqual(h.prepared, []uint32{1, 2}) {
			t.Fatal("unbounded or same-step repair", h.repairs, h.prepared, len(h.commits))
		}
	}
}
