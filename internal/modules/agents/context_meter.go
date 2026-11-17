package agents

import (
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *Service) contextCounter() agentcore.TokenCounter {
	if s.Tokens != nil {
		return s.Tokens
	}
	return modelcore.RequestTokenCounter{}
}

func snapshotEnvelope(call *ModelCallRow) (modelcore.Request, error) {
	var snapshot attemptSnapshot
	if json.Unmarshal(call.RequestConfig, &snapshot) != nil || snapshot.SchemaVersion != 1 {
		return modelcore.Request{}, integrity()
	}
	return modelcore.Request{Model: snapshot.Model, Protocol: snapshot.Protocol, Messages: snapshot.System, Tools: snapshot.ModelTools, Parameters: snapshot.Parameters}, nil
}

func (s *Service) contextAnchor(st StateRepository, session *SessionRow) (*agentcore.ContextAnchor, error) {
	call, err := st.LatestGenerationCall(session.ID, true)
	if err != nil || call == nil || call.InputTokens == nil {
		return nil, err
	}
	envelope, err := snapshotEnvelope(call)
	if err != nil {
		return nil, err
	}
	var snapshot attemptSnapshot
	if err = json.Unmarshal(call.RequestConfig, &snapshot); err != nil {
		return nil, err
	}
	var estimate uint64
	if snapshot.InputEstimate != nil {
		estimate = *snapshot.InputEstimate
	} else {
		// Older calls have no priced snapshot. Rebuild their original surface,
		// including history hidden by a later compaction, from immutable events.
		if call.ResponseEventSeq == nil {
			return nil, nil
		}
		at := *session
		at.LastSeq = *call.ResponseEventSeq - 1
		_, facts, e := loadSurface(st, &at)
		if e != nil {
			return nil, e
		}
		var manifest agentcore.SurfaceManifest
		if json.Unmarshal(call.SurfaceManifest, &manifest) != nil {
			return nil, integrity()
		}
		messages, e := agentcore.BuildSurface(manifest, facts)
		if e != nil {
			return nil, e
		}
		request := envelope
		request.Messages = append(append([]modelcore.Message{}, envelope.Messages...), messages...)
		estimate, e = s.contextCounter().Count(request)
		if e != nil {
			return nil, e
		}
	}
	return &agentcore.ContextAnchor{Envelope: envelope, Estimated: estimate, Input: *call.InputTokens}, nil
}

// The same persisted envelope and surface feed UI pressure and pre-request
// admission. Queued inputs and transient streaming drafts are not model facts.
func (s *Service) sessionContextRequest(tx identity.Tx, st StateRepository, session *SessionRow, manifest agentcore.SurfaceManifest, facts map[agentcore.Seq]agentcore.HistoryFact) (modelcore.Request, error) {
	latest, err := st.LatestGenerationCall(session.ID, false)
	if err != nil {
		return modelcore.Request{}, err
	}
	var request modelcore.Request
	if session.ActiveRunID != nil {
		run, e := st.Run(*session.ActiveRunID, false)
		if e != nil {
			return request, e
		}
		if run == nil {
			return request, integrity()
		}
		root := run.ID
		if run.RootRunID != nil {
			root = *run.RootRunID
		}
		frozen, e := readRunContext(st, root)
		if e != nil {
			return request, e
		}
		rootRun, e := st.Run(root, false)
		if e != nil {
			return request, e
		}
		if rootRun == nil {
			return request, integrity()
		}
		binding, e := s.executionBinding(tx, rootRun)
		if e != nil {
			return request, e
		}
		tools := []agentcore.ToolSpec{}
		for _, tool := range frozen.Tools {
			if tool.RequiresSandbox && binding == nil {
				continue
			}
			tools = append(tools, tool.Spec)
		}
		tools = append(tools, frozen.MCPTools...)
		step, e := agentcore.BuildPreparedStep(agentcore.ExecutionRef{}, 1, frozen.Model, agentcore.PromptConfig{Platform: platformPrompt, Administrator: frozen.Row.SystemPrompt}, manifest, nil, tools, frozen.Policy.MaxParallelTools)
		if e != nil {
			return request, e
		}
		request = step.Request
	} else if latest != nil {
		request, err = snapshotEnvelope(latest)
		if err != nil {
			return request, err
		}
	} else {
		return request, nil
	}
	messages, err := agentcore.SurfaceForMeasurement(manifest, facts)
	if err != nil {
		return request, err
	}
	request.Messages = append(append([]modelcore.Message{}, request.Messages...), messages...)
	return request, nil
}
