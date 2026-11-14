package agents

import (
	"context"
	"strconv"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type DebugStart struct {
	SessionID      Field[string] `json:"session_id"`
	Title          Field[string] `json:"title"`
	ProjectID      Field[string] `json:"project_context_id"`
	ModelBindingID Field[string] `json:"model_binding_id"`
	Thinking       Field[string] `json:"thinking_option_key"`
	Input          InputCreate   `json:"input"`
}

func (s *Service) DebugRun(ctx context.Context, raw string, id uint64, tag, key string, w DebugStart) (*Result, error) {
	return s.agentAccess(ctx, raw, id, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		agent, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		if e = s.definition(agent); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "agent.debug_run", "agent:"+strconv.FormatUint(id, 10), w, func(rec *Receipt) error {
			if e = checkTag(tag, s.tag("definition", id, agent.RowVersion)); e != nil {
				return e
			}
			var sessionID uint64
			if w.SessionID.Set {
				if w.SessionID.Null || w.Title.Set || w.ProjectID.Set || w.ModelBindingID.Set || w.Thinking.Set {
					return httpx.Invalid("session_id", "existing_session_conflicts")
				}
				sessionID, e = idValue(w.SessionID.Value, "session_id")
				if e != nil {
					return e
				}
				v, e := s.sessionAccess(st, sessionID, a, true, false)
				if e != nil {
					return e
				}
				if v.AgentID != id {
					return missing()
				}
			} else {
				if len(w.Input.Files) > 0 {
					return httpx.Invalid("input.file_refs", "session_required")
				}
				create := SessionCreate{AgentID: strconv.FormatUint(id, 10), Title: w.Title, ProjectID: w.ProjectID}
				if w.ModelBindingID.Set || w.Thinking.Set {
					if w.ModelBindingID.Null || w.Thinking.Null {
						return httpx.Invalid("model_binding_id", "null_not_allowed")
					}
					bindingID := agent.DefaultModelBindingID
					if w.ModelBindingID.Set {
						value, e := idValue(w.ModelBindingID.Value, "model_binding_id")
						if e != nil {
							return e
						}
						bindingID = &value
					}
					if bindingID == nil {
						return httpx.E(409, "AGENT_UNAVAILABLE", "智能体缺少默认模型")
					}
					bindings, e := r.ModelBindings(id, false)
					if e != nil {
						return e
					}
					thinking := ""
					for _, binding := range bindings {
						if binding.ID == *bindingID {
							thinking = binding.DefaultThinking
						}
					}
					if w.Thinking.Set {
						thinking = w.Thinking.Value
					}
					create.Selection = &ModelSelection{BindingID: strconv.FormatUint(*bindingID, 10), Thinking: thinking}
				}
				if e = s.createSessionTx(ctx, tx, r, st, a, out, rec, create); e != nil {
					return e
				}
				detail, ok := out.Data.(SessionDetail)
				if !ok {
					return integrity()
				}
				sessionID = detail.Configuration.ID
			}
			if e = s.submitInputTx(ctx, tx, r, st, a, out, rec, sessionID, w.Input); e != nil {
				return e
			}
			current, e := r.Definition(id, true)
			if e != nil {
				return e
			}
			if current == nil {
				return missing()
			}
			if e = checkTag(tag, s.tag("definition", id, current.RowVersion)); e != nil {
				return e
			}
			accepted, ok := out.Data.(InputAccepted)
			if !ok {
				return integrity()
			}
			out.Data = map[string]any{"session_id": agentcore.ID(sessionID), "input_id": agentcore.ID(accepted.InputID), "run_id": stringID(accepted.RunID), "delivery": accepted.Delivery, "queue_paused": accepted.QueuePaused, "accepted_seq": agentcore.Seq(accepted.AcceptedSeq)}
			out.Location = ""
			return nil
		})
	})
}
