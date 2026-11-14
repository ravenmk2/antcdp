package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) maybeCompact(ctx context.Context, execution agentcore.ExecutionContext, step agentcore.PreparedStep, prompt agentcore.PromptConfig, tools []agentcore.ToolSpec, contextFacts []agentcore.ContextFact) (agentcore.PreparedStep, error) {
	if s.Tokens == nil {
		return step, nil
	}
	count, e := s.Tokens.Count(step.Request)
	if e != nil {
		return step, e
	}
	if execution.Model.ContextWindow <= execution.Model.MaxOutputTokens {
		return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "模型上下文窗口配置无有效输入空间")
	}
	limit := execution.Model.ContextWindow - execution.Model.MaxOutputTokens
	if count <= limit/5*4 {
		return step, nil
	}
	if s.Compactor == nil {
		return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "上下文需要压缩")
	}
	var facts map[agentcore.Seq]agentcore.HistoryFact
	e = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, execution.Ref, true)
		if e != nil {
			return e
		}
		manifest, loaded, e := loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		if !semanticSame(manifest, step.Manifest) {
			return httpx.E(409, "SURFACE_CHANGED", "上下文发生变化")
		}
		facts = loaded
		return nil
	})
	if e != nil {
		return step, e
	}
	first, last, e := agentcore.CompactionRange(step.Manifest, facts, 4)
	if e != nil {
		if count <= limit {
			return step, nil
		}
		return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "最新任务已超过上下文窗口，无法通过压缩历史解决")
	}
	request, e := summaryRequest(step.Request, step.Manifest, facts, first, last)
	if e != nil {
		return step, e
	}
	deadline := agentcore.BoundedDeadline(time.Now().UTC(), 180, execution.Deadline)
	ref := execution.Ref
	if _, e = s.Compactor.Compact(ctx, agentcore.CompactionRequest{SessionID: ref.SessionID, Ref: &ref, Source: step.Manifest, First: first, Last: last, Deadline: deadline}, request, facts); e != nil {
		return step, e
	}
	var revision agentcore.Version
	e = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, execution.Ref, true)
		if e != nil {
			return e
		}
		revision = agentcore.Version(x.Session.SurfaceRevision)
		return nil
	})
	if e != nil {
		return step, e
	}
	commit, e := s.CommitContext(ctx, execution.Ref, agentcore.ContextUpdate{SurfaceRevision: revision, Events: contextFacts})
	if e != nil {
		return step, e
	}
	if s.Committed != nil && len(commit.Receipt.Ranges) > 0 {
		s.Committed(ctx, commit.Receipt)
	}
	e = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, execution.Ref, true)
		if e != nil {
			return e
		}
		m, facts, e := loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		messages, e := agentcore.BuildSurface(m, facts)
		if e != nil {
			return e
		}
		step, e = agentcore.BuildPreparedStep(execution.Ref, step.Step, execution.Model, prompt, m, messages, tools, execution.Policy.MaxParallelTools)
		return e
	})
	if e != nil {
		return step, e
	}
	count, e = s.Tokens.Count(step.Request)
	if e != nil {
		return step, e
	}
	if count > limit {
		return step, httpx.E(409, "CONTEXT_BUDGET_EXCEEDED", "压缩后仍超出模型上下文窗口")
	}
	return step, nil
}
