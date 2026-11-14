package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
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
	Window         uint64     `json:"window_tokens,string"`
	ReservedOutput uint64     `json:"reserved_output_tokens,string"`
	Input          *uint64    `json:"input_tokens,string"`
	CacheRead      *uint64    `json:"cache_read_tokens,string"`
	CallID         *uint64    `json:"model_call_id,string"`
	ObservedAt     *time.Time `json:"observed_at"`
	Stale          bool       `json:"stale"`
}

type SessionUsageReport struct {
	UsageTotals
	Context ContextUsage `json:"context"`
	Cache   CacheUsage   `json:"cache"`
}

func sessionContextUsage(session *SessionRow, latest *ModelCallRow, summarySeq uint64) (ContextUsage, error) {
	var result ContextUsage
	if session.ModelLockedAt != nil {
		var model frozenModel
		if json.Unmarshal(session.LockedModelConfig, &model) != nil || model.SelectionHash == "" {
			return result, integrity()
		}
		result.Window, result.ReservedOutput = model.ContextWindow, model.MaxOutputTokens
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
