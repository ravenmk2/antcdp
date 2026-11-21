package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) pruneToolOutputs(ctx context.Context, execution agentcore.ExecutionContext, step agentcore.PreparedStep, prompt string, tools []agentcore.ToolSpec) (agentcore.PreparedStep, error) {
	var receipt agentcore.CommitReceipt
	err := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, execution.Ref, true)
		if err != nil {
			return err
		}
		manifest, facts, err := loadSurface(st, x.Session)
		if err != nil {
			return err
		}
		if !semanticSame(manifest, step.Manifest) {
			return httpx.E(409, "SURFACE_CHANGED", "上下文发生变化")
		}
		pruned := map[agentcore.Seq]bool{}
		for _, target := range manifest.ToolOutputPrunes {
			pruned[target.Seq] = true
		}
		var targets []agentcore.ToolOutputPrune
		for _, entry := range manifest.Entries {
			if entry.Kind != "tool_group" {
				continue
			}
			for _, seq := range entry.Sequences {
				fact := facts[seq]
				if !pruned[seq] && fact.Kind == "tool/result" && fact.Message != nil && len(fact.Message.Content) > 8192 {
					targets = append(targets, agentcore.ToolOutputPrune{Seq: seq, SHA256: agentcore.ToolOutputHash(fact.Message.Content)})
				}
			}
		}
		if len(targets) == 0 {
			return nil
		}
		from := x.Session.LastSeq + 1
		// Bound each event even when a very long session is pruned in one pass.
		for start := 0; start < len(targets); start += 500 {
			batch := targets[start:min(start+500, len(targets))]
			if _, err = appendEvent(st, x.Session, &x.Run.ID, "tool/output_pruned", "", map[string]any{"count": len(batch), "policy_version": 1}, &StoredEvent{ToolOutputPrunes: batch}, time.Now().UTC()); err != nil {
				return err
			}
		}
		manifest.ToolOutputPrunes = append(manifest.ToolOutputPrunes, targets...)
		manifest.Revision = agentcore.Version(x.Session.SurfaceRevision)
		messages, err := agentcore.BuildSurface(manifest, facts)
		if err != nil {
			return err
		}
		step, err = agentcore.BuildPreparedStep(execution.Ref, step.Step, execution.Model, prompt, manifest, messages, tools, execution.Policy.MaxParallelTools)
		if err != nil {
			return err
		}
		receipt = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
		return st.SaveSession(x.Session)
	})
	if err == nil && s.Committed != nil && len(receipt.Ranges) > 0 {
		s.Committed(ctx, receipt)
	}
	return step, err
}
