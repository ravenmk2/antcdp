package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// Cache counters are paired per request. Missing counters and impossible pairs
// never contribute to the denominator, and remain visible in the coverage.
type CacheUsage struct {
	Calls   uint64  `db:"calls" json:"call_count"`
	Covered uint64  `db:"covered" json:"covered_call_count"`
	Input   *string `db:"input_tokens" json:"input_tokens"`
	Read    *string `db:"cache_read_tokens" json:"cache_read_tokens"`
	Write   *string `db:"cache_write_tokens" json:"cache_write_tokens"`
}

type ContextUsage struct {
	Projected         *uint64    `json:"projected_tokens,string"`
	Estimated         *uint64    `json:"estimated_tokens,string"`
	Threshold         *uint64    `json:"compaction_threshold_tokens,string"`
	InputLimit        *uint64    `json:"input_limit_tokens,string"`
	Headroom          *uint64    `json:"headroom_tokens,string"`
	MeasurementSource string     `json:"measurement_source"`
	Window            uint64     `json:"window_tokens,string"`
	ReservedOutput    uint64     `json:"reserved_output_tokens,string"`
	Input             *uint64    `json:"input_tokens,string"`
	CacheRead         *uint64    `json:"cache_read_tokens,string"`
	CallID            *uint64    `json:"model_call_id,string"`
	ObservedAt        *time.Time `json:"observed_at"`
	Stale             bool       `json:"stale"`
}

type SessionUsageReport struct {
	UsageTotals
	SessionActivity
	Context ContextUsage `json:"context"`
	Cache   CacheUsage   `json:"cache"`
}

type SessionActivity struct {
	Runs  uint64 `db:"runs" json:"run_count"`
	Steps uint64 `db:"steps" json:"step_count"`
}

func sessionContextUsage(session *SessionRow, latest *ModelCallRow, summarySeq uint64) (ContextUsage, error) {
	var result ContextUsage
	if session.ModelLockedAt != nil {
		var model frozenModel
		if json.Unmarshal(session.LockedModelConfig, &model) != nil || model.SelectionHash == "" {
			return result, integrity()
		}
		result.Window = model.ContextWindow
		var err error
		result.ReservedOutput, err = modelcore.EffectiveOutputTokens(model.Parameters, model.MaxOutputTokens)
		if err != nil {
			return result, err
		}
	}
	if latest == nil {
		return result, nil
	}
	result.CallID, result.Input, result.CacheRead = &latest.ID, latest.InputTokens, latest.CacheReadTokens
	result.ObservedAt = latest.FinishedAt
	// Compare the request's actual surface to the latest committed summary.
	// Completion time cannot establish whether a request included that summary.
	if summarySeq > 0 {
		var surface agentcore.SurfaceManifest
		if json.Unmarshal(latest.SurfaceManifest, &surface) != nil {
			result.Stale = true
		} else {
			result.Stale = true
			for _, entry := range surface.Entries {
				for _, seq := range entry.Sequences {
					if uint64(seq) == summarySeq {
						result.Stale = false
					}
				}
			}
		}
	}
	return result, nil
}

func (s *Service) projectContextUsage(tx identity.Tx, st StateRepository, session *SessionRow, result *ContextUsage) error {
	if session.ModelLockedAt == nil {
		return nil
	}
	var model frozenModel
	if json.Unmarshal(session.LockedModelConfig, &model) != nil {
		return integrity()
	}
	budget, err := agentcore.ResolveContextBudget(model.LockedModel)
	if err != nil {
		return err
	}
	result.Threshold, result.InputLimit, result.Headroom = &budget.Threshold, &budget.Limit, &budget.Headroom
	manifest, facts, err := loadSurface(st, session)
	if err != nil {
		return err
	}
	request, err := s.sessionContextRequest(tx, st, session, manifest, facts)
	if err != nil || request.Model == "" {
		return err
	}
	model.Parameters = request.Parameters
	budget, err = agentcore.ResolveContextBudget(model.LockedModel)
	if err != nil {
		return err
	}
	result.ReservedOutput = budget.Output
	result.Threshold, result.InputLimit, result.Headroom = &budget.Threshold, &budget.Limit, &budget.Headroom
	anchor, err := s.contextAnchor(st, session)
	if err != nil {
		return err
	}
	measurement, err := agentcore.MeasureContext(s.contextCounter(), request, anchor)
	if err != nil {
		return err
	}
	result.Projected, result.Estimated = &measurement.Tokens, &measurement.Estimated
	result.MeasurementSource = measurement.Source
	return nil
}
