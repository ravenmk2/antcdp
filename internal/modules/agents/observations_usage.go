package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type UsageQuery struct {
	Page, PageSize                                          int
	From, To                                                *time.Time
	GroupBy, Mode, Status                                   string
	AgentID, ModelID, ProviderID, OwnerID, RunID, SessionID uint64
}
type UsageTotals struct {
	Calls        uint64  `db:"calls" json:"model_call_count"`
	Completed    uint64  `db:"completed" json:"completed_call_count"`
	Failed       uint64  `db:"failed" json:"failed_call_count"`
	Input        *string `db:"input_tokens" json:"input_tokens"`
	Output       *string `db:"output_tokens" json:"output_tokens"`
	CacheRead    *string `db:"cache_read_tokens" json:"cache_read_tokens"`
	CacheWrite   *string `db:"cache_write_tokens" json:"cache_write_tokens"`
	Known        uint64  `db:"known_calls" json:"known_usage_call_count"`
	Unknown      uint64  `db:"unknown_calls" json:"unknown_usage_call_count"`
	Complete     uint64  `db:"complete_calls" json:"-"`
	Completeness string  `json:"usage_completeness"`
	Cost         any     `json:"estimated_cost"`
}

func (t *UsageTotals) normalize() {
	t.Completeness = "unknown"
	if t.Calls > 0 && t.Complete == t.Calls {
		t.Completeness = "complete"
	} else if t.Known > 0 {
		t.Completeness = "partial"
	}
}

type UsageBucket struct {
	Key    string      `db:"bucket_key" json:"key"`
	Totals UsageTotals `db:"totals" json:"totals"`
}
type RunMetadataRow struct {
	RunRow
	AgentID uint64  `db:"agent_id"`
	Mode    string  `db:"agent_type"`
	OwnerID *uint64 `db:"owner_user_id"`
}
type usageRepository interface {
	Usage(UsageQuery) (UsageTotals, []UsageBucket, error)
	SessionUsageMetrics(uint64) (CacheUsage, *ModelCallRow, uint64, error)
	ModelCallPage(UsageQuery) ([]ModelCallRow, int, error)
	RunMetadataPage(UsageQuery) ([]RunMetadataRow, int, error)
}

func usageFor(tx identity.Tx) (usageRepository, error) {
	repo, e := observationsFor(tx)
	if e != nil {
		return nil, e
	}
	v, ok := repo.(usageRepository)
	if !ok {
		return nil, unavailable()
	}
	return v, nil
}
func validateUsage(q *UsageQuery, report bool) error {
	base := Query{Page: q.Page, PageSize: q.PageSize, Mode: q.Mode}
	if e := validateQuery(&base); e != nil {
		return e
	}
	q.Page, q.PageSize = base.Page, base.PageSize
	if report && (q.From == nil || q.To == nil) {
		return httpx.Invalid("from", "required")
	}
	if q.From != nil && q.To != nil && (!q.From.Before(*q.To) || q.To.Sub(*q.From) > 90*24*time.Hour) {
		return httpx.Invalid("to", "invalid_range")
	}
	if report && q.GroupBy != "day" && q.GroupBy != "agent" && q.GroupBy != "model" && q.GroupBy != "provider" && q.GroupBy != "agent_type" {
		return httpx.Invalid("group_by", "unsupported")
	}
	return nil
}
func (s *Service) UsageReport(ctx context.Context, raw string, q UsageQuery) (*Result, error) {
	if e := validateUsage(&q, true); e != nil {
		return nil, e
	}
	return s.access(ctx, raw, true, func(tx identity.Tx, _ Repository, _ *identity.Auth, out *Result) error {
		repo, e := usageFor(tx)
		if e != nil {
			return e
		}
		totals, items, e := repo.Usage(q)
		if e != nil {
			return e
		}
		totals.normalize()
		for i := range items {
			items[i].Totals.normalize()
		}
		out.Data = map[string]any{"from": q.From, "to": q.To, "group_by": q.GroupBy, "items": items, "totals": totals, "generated_at": time.Now().UTC()}
		return nil
	})
}
func (s *Service) SessionUsage(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		session, e := s.sessionAccess(st, id, a, false, false)
		if e != nil {
			return e
		}
		repo, e := usageFor(tx)
		if e != nil {
			return e
		}
		totals, _, e := repo.Usage(UsageQuery{SessionID: id})
		if e != nil {
			return e
		}
		totals.normalize()
		cache, latest, summarySeq, e := repo.SessionUsageMetrics(id)
		if e != nil {
			return e
		}
		context, e := sessionContextUsage(session, latest, summarySeq)
		if e != nil {
			return e
		}
		out.Data = SessionUsageReport{UsageTotals: totals, Context: context, Cache: cache}
		return nil
	})
}
func modelCallMetadata(row ModelCallRow) (map[string]any, error) {
	var thinking struct {
		Key string `json:"option_key"`
	}
	if json.Unmarshal(row.Thinking, &thinking) != nil {
		return nil, integrity()
	}
	if row.ResponseModelID != nil && len(*row.ResponseModelID) > 255 {
		return nil, integrity()
	}
	var latency *int64
	if row.StartedAt != nil && row.FinishedAt != nil {
		n := max(int64(0), row.FinishedAt.Sub(*row.StartedAt).Milliseconds())
		latency = &n
	}
	// Project only the model adapter's numeric vocabulary. Ignore malformed or
	// unknown historical keys rather than exposing arbitrary persisted metadata.
	metrics := map[string]any{}
	var raw map[string]json.RawMessage
	if len(row.UsageRaw) > 0 && json.Unmarshal(row.UsageRaw, &raw) == nil {
		for _, key := range modelcore.RawUsageFields(modelcore.Protocol(row.Protocol)) {
			value, exists := raw[key]
			if !exists || string(value) == "null" {
				continue
			}
			var count int64
			if json.Unmarshal(value, &count) == nil && count >= 0 {
				metrics[key] = strconv.FormatInt(count, 10)
			}
		}
	}
	switch row.Status {
	case "running":
		row.Status = "streaming"
	case "completed":
		row.Status = "succeeded"
	}
	return map[string]any{"id": agentcore.ID(row.ID), "session_id": agentcore.ID(row.SessionID), "run_id": coreID(row.RunID), "purpose": row.Purpose, "compaction_id": coreID(row.CompactionID), "step": row.StepNo, "attempt": row.AttemptNo, "status": row.Status, "model_definition_id": agentcore.ID(row.ModelDefinitionID), "provider_id": agentcore.ID(row.ProviderID), "protocol": row.Protocol, "requested_model": row.RequestedModelID, "returned_model": row.ResponseModelID, "thinking_option_key": thinking.Key, "request_config_hash": hex.EncodeToString(row.RequestHash), "started_at": row.StartedAt, "finished_at": row.FinishedAt, "latency_ms": latency, "error_code": row.ErrorCode, "usage": map[string]any{"input_tokens": coreID(row.InputTokens), "output_tokens": coreID(row.OutputTokens), "cache_read_tokens": coreID(row.CacheReadTokens), "cache_write_tokens": coreID(row.CacheWriteTokens), "normalization_version": row.UsageSemanticsVersion, "raw_numeric_fields": metrics}, "usage_completeness": row.UsageCompleteness}, nil
}
func (s *Service) ModelCalls(ctx context.Context, raw string, q UsageQuery, admin bool) (*Result, error) {
	if e := validateUsage(&q, false); e != nil {
		return nil, e
	}
	if q.Status != "" && q.Status != "preparing" && q.Status != "streaming" && q.Status != "succeeded" && q.Status != "failed" && q.Status != "cancelled" && q.Status != "interrupted" {
		return nil, httpx.Invalid("status", "unsupported")
	}
	return s.access(ctx, raw, admin, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		if !admin {
			if q.RunID == 0 {
				return httpx.Invalid("run_id", "required")
			}
			st, e := StateFor(tx)
			if e != nil {
				return e
			}
			run, e := st.Run(q.RunID, false)
			if e != nil {
				return e
			}
			if run == nil {
				return missing()
			}
			if _, e = s.sessionAccess(st, run.SessionID, a, false, false); e != nil {
				return e
			}
		}
		repo, e := usageFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.ModelCallPage(q)
		if e != nil {
			return e
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			v, e := modelCallMetadata(row)
			if e != nil {
				return e
			}
			items = append(items, v)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) RunMetadata(ctx context.Context, raw string, q UsageQuery) (*Result, error) {
	if e := validateUsage(&q, false); e != nil {
		return nil, e
	}
	test := ObservationQuery{Status: q.Status}
	if e := validateObservation(&test, "run"); e != nil {
		return nil, e
	}
	return s.access(ctx, raw, true, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		repo, e := usageFor(tx)
		if e != nil {
			return e
		}
		obs, e := observationsFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.RunMetadataPage(q)
		if e != nil {
			return e
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			counts, e := obs.RunCounts(row.ID)
			if e != nil {
				return e
			}
			items = append(items, map[string]any{"id": agentcore.ID(row.ID), "session_id": agentcore.ID(row.SessionID), "agent_id": agentcore.ID(row.AgentID), "agent_type": row.Mode, "owner_user_id": coreID(row.OwnerID), "status": row.Status, "reason_code": row.EndReason, "started_at": row.StartedAt, "finished_at": row.FinishedAt, "deadline_at": row.DeadlineAt, "model_call_count": counts.ModelCalls, "tool_call_count": counts.ToolCalls, "unknown_tool_call_count": counts.UnknownTools, "usage_completeness": row.UsageCompleteness, "can_open_content": row.Mode == "service" || row.OwnerID != nil && *row.OwnerID == a.User.ID})
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
