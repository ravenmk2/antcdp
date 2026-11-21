package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// PrepareStep projects the root snapshot into model context. Later configuration
// writes never add, remove, or replace capabilities inside this turn.
func (s *Service) PrepareStep(ctx context.Context, execution agentcore.ExecutionContext, step uint32) (agentcore.PreparedStep, error) {
	// The root may still be preparing its cloud environment before inference.
	if s.Sandboxes != nil && execution.Binding == nil {
		binding, e := s.Sandboxes.Acquire(ctx, execution)
		if e != nil {
			return agentcore.PreparedStep{}, e
		}
		if binding != nil {
			if _, e = s.ActivateBinding(ctx, execution.Ref, *binding); e != nil {
				return agentcore.PreparedStep{}, e
			}
			execution.Binding = binding
		}
	}
	if s.Sandboxes != nil && step == 1 {
		if e := s.Sandboxes.PrepareTurn(ctx, execution); e != nil {
			return agentcore.PreparedStep{}, e
		}
	}
	boundary, e := s.BeginStep(ctx, execution.Ref, step)
	if e != nil {
		return agentcore.PreparedStep{}, e
	}
	var prompt string
	var tools []agentcore.ToolSpec
	runtime := agentcore.ContextFact{Kind: "runtime-context", Form: "snapshot"}
	var mcpBindings []mcpPreparation
	var mcpTools []agentcore.ToolSpec
	var mcpPrepared bool
	skillsEnabled := false
	e = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, execution.Ref, true)
		if e != nil {
			return e
		}
		mcpBindings = x.Context.MCP
		mcpPrepared = x.Context.Row.MCPPreparedAt != nil
		mcpTools = x.Context.MCPTools
		prompt = x.Context.Row.SystemPrompt
		tools = []agentcore.ToolSpec{}
		for _, frozen := range x.Context.Tools {
			if frozen.RequiresSandbox && x.Execution.Binding == nil {
				continue
			}
			tools = append(tools, frozen.Spec)
			skillsEnabled = skillsEnabled || (frozen.Spec.Key == "skill" && frozen.Spec.Policy != "deny")
		}
		if x.Execution.Binding != nil {
			cwd, _ := json.Marshal(x.Context.Row.CWD)
			runtime.Sections = []agentcore.ContextSection{{Name: "working-directory:current", Text: "Current working directory: " + string(cwd) + "."}}
		}
		return nil
	})
	if e != nil {
		return agentcore.PreparedStep{}, e
	}
	if !mcpPrepared {
		discovered, fact := s.discoverMCPBindings(ctx, mcpBindings)
		surface, err := json.Marshal(map[string]any{"tools": discovered, "fact": fact})
		if err != nil {
			return agentcore.PreparedStep{}, err
		}
		err = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
			x, err := s.lockExecution(tx, r, st, execution.Ref, true)
			if err != nil {
				return err
			}
			if err = st.PrepareMCPManifest(x.Root.ID, surface, time.Now().UTC()); err != nil {
				return err
			}
			frozen, err := readRunContext(st, x.Root.ID)
			if err != nil {
				return err
			}
			mcpTools = frozen.MCPTools
			return nil
		})
		if err != nil {
			return agentcore.PreparedStep{}, err
		}
	}
	tools = append(tools, mcpTools...)
	directory := agentcore.SkillDirectory{Complete: true, Entries: []agentcore.SkillEntry{}}
	if skillsEnabled && s.Skills != nil {
		directory, e = s.Skills.Directory(ctx, execution)
		if e != nil {
			return agentcore.PreparedStep{}, e
		}
	}
	skill, e := agentcore.SkillContext(directory, skillsEnabled)
	if e != nil {
		return agentcore.PreparedStep{}, e
	}
	facts := []agentcore.ContextFact{runtime, skill}
	commit, e := s.CommitContext(ctx, execution.Ref, agentcore.ContextUpdate{SurfaceRevision: boundary.Manifest.Revision, Events: facts})
	if e != nil {
		return agentcore.PreparedStep{}, e
	}
	if s.Committed != nil && len(commit.Receipt.Ranges) > 0 {
		s.Committed(ctx, commit.Receipt)
	}
	var out agentcore.PreparedStep
	var imageReceipt agentcore.CommitReceipt
	e = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, execution.Ref, true)
		if e != nil {
			return e
		}
		manifest, history, e := loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		imageFrom := x.Session.LastSeq + 1
		if e = budgetImages(st, x.Session, x.RootSession.ID, &x.Run.ID, &manifest, history); e != nil {
			return e
		}
		if x.Session.LastSeq >= imageFrom {
			imageReceipt = eventReceipt(x.Session.ID, imageFrom, x.Session.LastSeq)
		}
		messages, e := agentcore.BuildSurface(manifest, history)
		if e != nil {
			return coreError(e)
		}
		out, e = agentcore.BuildPreparedStep(execution.Ref, step, execution.Model, prompt, manifest, messages, tools, execution.Policy.MaxParallelTools)
		return coreError(e)
	})
	if e != nil {
		return out, e
	}
	if s.Committed != nil && len(imageReceipt.Ranges) > 0 {
		s.Committed(ctx, imageReceipt)
	}
	out, e = s.maybeCompact(ctx, execution, out, prompt, tools, facts)
	if e != nil {
		return agentcore.PreparedStep{}, e
	}
	if e = s.prepareImages(ctx, execution.Model, &execution.Ref, nil, &out.Request); e != nil {
		return agentcore.PreparedStep{}, e
	}
	return out, nil
}
