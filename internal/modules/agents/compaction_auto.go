package agents

import (
	"context"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) stepPressure(ctx context.Context, execution agentcore.ExecutionContext, step agentcore.PreparedStep) (agentcore.ContextMeasurement, map[agentcore.Seq]agentcore.HistoryFact, error) {
	var measurement agentcore.ContextMeasurement
	var facts map[agentcore.Seq]agentcore.HistoryFact
	err := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, execution.Ref, true)
		if err != nil {
			return err
		}
		manifest, loaded, err := loadSurface(st, x.Session)
		if err != nil {
			return err
		}
		if !semanticSame(manifest, step.Manifest) {
			return httpx.E(409, "SURFACE_CHANGED", "上下文发生变化")
		}
		facts = loaded
		anchor, err := s.contextAnchor(st, x.Session)
		if err != nil {
			return err
		}
		measurement, err = agentcore.MeasureContext(s.contextCounter(), step.Request, anchor)
		return err
	})
	return measurement, facts, err
}

// CompactOverflow runs only after a provider-confirmed rejection. It never
// dispatches tools or repeats a preparation side effect; the next model attempt
// uses this same step with the committed replacement surface.
func (s *Service) CompactOverflow(ctx context.Context, execution agentcore.ExecutionContext, step agentcore.PreparedStep) (agentcore.PreparedStep, bool, error) {
	if s.Compactor == nil {
		return step, false, nil
	}
	before, facts, err := s.stepPressure(ctx, execution, step)
	if err != nil {
		return step, false, err
	}
	var prompt agentcore.PromptConfig
	for _, message := range step.Request.Messages {
		if message.Role != "system" {
			break
		}
		if prompt.Platform != "" {
			prompt.Platform += "\n\n"
		}
		prompt.Platform += message.Content
	}
	var contextFacts []agentcore.ContextFact
	for _, entry := range step.Manifest.Entries {
		for _, seq := range entry.Sequences {
			if facts[seq].Context != nil {
				contextFacts = append(contextFacts, *facts[seq].Context)
			}
		}
	}
	originalRevision := step.Manifest.Revision
	step, err = s.pruneToolOutputs(ctx, execution, step, prompt, step.Tools)
	if err != nil {
		return step, false, err
	}
	_, facts, err = s.stepPressure(ctx, execution, step)
	if err != nil {
		return step, false, err
	}
	first, last, rangeErr := agentcore.CompactionTokenRange(step.Manifest, facts, 0, s.contextCounter())
	if rangeErr == nil {
		request, e := summaryRequest(step.Request, step.Manifest, facts, first, last)
		if e != nil {
			return step, false, e
		}
		ref := execution.Ref
		_, err = s.Compactor.Compact(ctx, agentcore.CompactionRequest{SessionID: ref.SessionID, Ref: &ref, Source: step.Manifest, First: first, Last: last, Deadline: agentcore.BoundedDeadline(time.Now().UTC(), 180, execution.Deadline)}, request, facts)
	} else {
		var cause *agentcore.Error
		if !errors.As(rangeErr, &cause) || cause.Code != "COMPACTION_NOT_NEEDED" {
			return step, false, rangeErr
		}
	}
	// A successful prune remains useful even if the optional summary fails.
	if ctx.Err() != nil {
		return step, false, ctx.Err()
	}
	if err != nil && step.Manifest.Revision == originalRevision {
		return step, false, err
	}
	step, err = s.rebuildCompactedStep(ctx, execution, step, prompt, step.Tools, latestContextFacts(contextFacts))
	if err != nil {
		return step, false, err
	}
	after, _, err := s.stepPressure(ctx, execution, step)
	if err != nil {
		return step, false, err
	}
	changed := step.Manifest.Revision != originalRevision && after.Tokens < before.Tokens
	if changed {
		err = s.prepareImages(ctx, execution.Model, &execution.Ref, nil, &step.Request)
	}
	return step, changed, err
}

func latestContextFacts(facts []agentcore.ContextFact) []agentcore.ContextFact {
	seen := map[string]bool{}
	var latest []agentcore.ContextFact
	for i := len(facts) - 1; i >= 0; i-- {
		if !seen[facts[i].Kind] && facts[i].Kind != "context/tool_reconciliation" {
			latest = append(latest, facts[i])
			seen[facts[i].Kind] = true
		}
	}
	return latest
}

func (s *Service) maybeCompact(ctx context.Context, execution agentcore.ExecutionContext, step agentcore.PreparedStep, prompt agentcore.PromptConfig, tools []agentcore.ToolSpec, contextFacts []agentcore.ContextFact) (agentcore.PreparedStep, error) {
	if s.Tokens == nil {
		return step, nil
	}
	budget, err := agentcore.ResolveContextBudget(execution.Model)
	if err != nil {
		return step, coreError(err)
	}
	measurement, _, err := s.stepPressure(ctx, execution, step)
	if err != nil || measurement.Tokens < budget.Threshold {
		return step, err
	}
	step, err = s.pruneToolOutputs(ctx, execution, step, prompt, tools)
	if err != nil {
		return step, err
	}
	// One initial summary plus one bounded retry, as in DSH. A successful
	// replacement must clear the trigger, not merely fit under the hard window.
	for attempt := 0; attempt < 2; attempt++ {
		measurement, facts, err := s.stepPressure(ctx, execution, step)
		if err != nil || measurement.Tokens < budget.Threshold {
			return step, err
		}
		first, last, err := agentcore.CompactionTokenRange(step.Manifest, facts, budget.Retain, s.contextCounter())
		if err != nil {
			var cause *agentcore.Error
			if !errors.As(err, &cause) || cause.Code != "COMPACTION_NOT_NEEDED" {
				return step, err
			}
			if attempt == 0 && measurement.Tokens <= budget.Limit {
				return step, nil
			}
			return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "无法在保留当前指令及完整工具结果的同时释放足够上下文")
		}
		if s.Compactor == nil {
			return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "上下文需要压缩")
		}
		request, err := summaryRequest(step.Request, step.Manifest, facts, first, last)
		if err != nil {
			return step, err
		}
		ref := execution.Ref
		deadline := agentcore.BoundedDeadline(time.Now().UTC(), 180, execution.Deadline)
		if _, err = s.Compactor.Compact(ctx, agentcore.CompactionRequest{SessionID: ref.SessionID, Ref: &ref, Source: step.Manifest, First: first, Last: last, Deadline: deadline}, request, facts); err != nil {
			return step, err
		}
		step, err = s.rebuildCompactedStep(ctx, execution, step, prompt, tools, contextFacts)
		if err != nil {
			return step, err
		}
	}
	measurement, _, err = s.stepPressure(ctx, execution, step)
	if err != nil {
		return step, err
	}
	if measurement.Tokens >= budget.Threshold {
		return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "压缩后仍未释放足够上下文")
	}
	return step, nil
}

func (s *Service) rebuildCompactedStep(ctx context.Context, execution agentcore.ExecutionContext, step agentcore.PreparedStep, prompt agentcore.PromptConfig, tools []agentcore.ToolSpec, contextFacts []agentcore.ContextFact) (agentcore.PreparedStep, error) {
	var revision agentcore.Version
	err := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, execution.Ref, true)
		if err != nil {
			return err
		}
		revision = agentcore.Version(x.Session.SurfaceRevision)
		return nil
	})
	if err != nil {
		return step, err
	}
	commit, err := s.CommitContext(ctx, execution.Ref, agentcore.ContextUpdate{SurfaceRevision: revision, Events: contextFacts})
	if err != nil {
		return step, err
	}
	if s.Committed != nil && len(commit.Receipt.Ranges) > 0 {
		s.Committed(ctx, commit.Receipt)
	}
	err = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, execution.Ref, true)
		if err != nil {
			return err
		}
		manifest, facts, err := loadSurface(st, x.Session)
		if err != nil {
			return err
		}
		messages, err := agentcore.BuildSurface(manifest, facts)
		if err != nil {
			return err
		}
		step, err = agentcore.BuildPreparedStep(execution.Ref, step.Step, execution.Model, prompt, manifest, messages, tools, execution.Policy.MaxParallelTools)
		return err
	})
	return step, err
}
