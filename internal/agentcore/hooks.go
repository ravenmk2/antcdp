package agentcore

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type ModelClientFactory interface {
	Open(context.Context, LockedModel) (modelcore.Client, error)
}
type StepPreparer func(context.Context, ExecutionContext, uint32) (PreparedStep, error)

// PersistentHooks composes narrow host ports without importing platform code.
// Prepare performs live discovery/context commits once; retries use its frozen
// value. Opening a client resolves the current secret without changing route.
type PersistentHooks struct {
	Execution      ExecutionContext
	Prepare        StepPreparer
	Models         ModelClientFactory
	Store          StepStore
	Tools          *ToolRunner
	Hub            *Hub
	AttemptTimeout time.Duration
	Estimate       func(modelcore.Request) (Budget, error)
}

func (h *PersistentHooks) PrepareStep(ctx context.Context, ref ExecutionRef, step uint32) (PreparedStep, error) {
	if ref != h.Execution.Ref || step < 1 || step > h.Execution.Policy.MaxSteps {
		return PreparedStep{}, reject("STEP_LIMIT_EXCEEDED")
	}
	if h.Prepare == nil {
		return PreparedStep{}, invalid("step_preparer")
	}
	v, err := h.Prepare(ctx, h.Execution, step)
	if err != nil {
		return PreparedStep{}, err
	}
	if v.Ref != ref || v.Step != step || v.Request.Model != h.Execution.Model.RemoteModelID || v.Request.Protocol != h.Execution.Model.Protocol {
		return PreparedStep{}, reject("MODEL_STATE_INVALID")
	}
	if v.MaxParallelTools == 0 {
		v.MaxParallelTools = h.Execution.Policy.MaxParallelTools
	}
	if len(v.Tools) != len(v.Request.Tools) {
		return PreparedStep{}, reject("TOOL_SCHEMA_MISMATCH")
	}
	for n, t := range v.Tools {
		a, _ := json.Marshal(t.Definition)
		b, _ := json.Marshal(v.Request.Tools[n])
		if string(a) != string(b) {
			return PreparedStep{}, reject("TOOL_SCHEMA_MISMATCH")
		}
	}
	return v, nil
}
func (h *PersistentHooks) BeginAttempt(ctx context.Context, step PreparedStep, attempt uint32) (AttemptPermit, error) {
	if h.Store == nil || h.Models == nil || step.Ref != h.Execution.Ref || attempt == 0 {
		return AttemptPermit{}, invalid("attempt")
	}
	requestHash, err := ContentHash(step.Request)
	if err != nil {
		return AttemptPermit{}, err
	}
	reservation := Budget{ModelCalls: 1}
	if h.Estimate != nil {
		reservation, err = h.Estimate(step.Request)
		if err != nil {
			return AttemptPermit{}, err
		}
		reservation.ModelCalls = 1
	}
	timeout := h.AttemptTimeout
	if timeout <= 0 {
		timeout = 180 * time.Second
	}
	deadline := time.Now().Add(timeout)
	if h.Execution.Deadline.Before(deadline) {
		deadline = h.Execution.Deadline
	}
	// Resolve availability before reserving a remote attempt; the host factory
	// still checks live credentials and never writes them to AttemptDraft.
	client, err := h.Models.Open(ctx, h.Execution.Model)
	if err != nil {
		return AttemptPermit{}, err
	}
	record, err := h.Store.FreezeAttempt(ctx, step.Ref, AttemptDraft{Step: step, Attempt: attempt, Purpose: "generation", RequestHash: requestHash, Deadline: deadline, Reservation: reservation})
	if err != nil {
		return AttemptPermit{}, err
	}
	record.Permit.Client = client
	if h.Hub != nil {
		h.Hub.Committed(ctx, record.Receipt)
		if err = h.Hub.Start(record.Permit); err != nil {
			return AttemptPermit{}, err
		}
	}
	return record.Permit, nil
}
func (h *PersistentHooks) CompleteAttempt(ctx context.Context, permit AttemptPermit, outcome AttemptOutcome) (AttemptCommit, error) {
	result := AttemptResult{Permit: permit, Outcome: outcome}
	if h.Hub != nil {
		result.ReasoningDurationMS = h.Hub.FinishReasoning(permit)
	}
	commit, err := h.Store.CompleteAttempt(ctx, permit.Ref, result)
	if h.Hub != nil {
		streamOutcome := StreamOutcome{Kind: "abandoned", Reason: "commit_failed"}
		if err == nil {
			h.Hub.Committed(ctx, commit.Receipt)
			if commit.AssistantSeq > 0 {
				seq := commit.AssistantSeq
				streamOutcome = StreamOutcome{Kind: "committed", EventSeq: &seq}
			} else {
				streamOutcome.Reason = "no_visible_content"
			}
		}
		// Failure to publish an observation cannot undo a committed attempt.
		_ = h.Hub.End(permit, streamOutcome)
	}
	return commit, err
}
func (h *PersistentHooks) InvokeTool(ctx context.Context, call PreparedToolCall) (ToolCompletion, error) {
	if h.Tools == nil {
		return ToolCompletion{}, invalid("tool_runner")
	}
	return h.Tools.Invoke(ctx, h.Execution, call)
}
func (h *PersistentHooks) Emit(ctx context.Context, permit AttemptPermit, delta modelcore.Delta) error {
	if h.Hub != nil {
		return h.Hub.Emit(ctx, permit, delta)
	}
	return nil
}

var _ EngineHooks = (*PersistentHooks)(nil)
