package mysql

import (
	"database/sql"
	"errors"
	"strings"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (t *agentsTx) SessionUsageMetrics(id uint64) (a.CacheUsage, *a.ModelCallRow, uint64, error) {
	var cache a.CacheUsage
	const paired = "input_tokens IS NOT NULL AND cache_read_tokens IS NOT NULL AND cache_read_tokens<=input_tokens"
	err := t.tx.GetContext(t.ctx, &cache, `SELECT COUNT(*) AS calls,
COALESCE(SUM(`+paired+`),0) AS covered,
CAST(SUM(CASE WHEN `+paired+` THEN input_tokens END) AS CHAR) AS input_tokens,
CAST(SUM(CASE WHEN `+paired+` THEN cache_read_tokens END) AS CHAR) AS cache_read_tokens,
CAST(SUM(cache_write_tokens) AS CHAR) AS cache_write_tokens
FROM agent_model_call WHERE session_id=? AND purpose='generation' AND status NOT IN ('preparing','running')`, id)
	if err != nil {
		return cache, nil, 0, err
	}
	var latest a.ModelCallRow
	err = t.tx.GetContext(t.ctx, &latest, "SELECT "+agentModelCallColumns+" FROM agent_model_call WHERE session_id=? AND purpose='generation' AND status NOT IN ('preparing','running') ORDER BY id DESC LIMIT 1", id)
	if errors.Is(err, sql.ErrNoRows) {
		return cache, nil, 0, nil
	}
	if err != nil {
		return cache, nil, 0, err
	}
	var summarySeq uint64
	err = t.tx.GetContext(t.ctx, &summarySeq, "SELECT COALESCE(MAX(seq),0) FROM agent_event WHERE session_id=? AND event_type='compaction/summary'", id)
	return cache, &latest, summarySeq, err
}

func agentUsageWhere(q a.UsageQuery, call bool) (string, []any) {
	parts := []string{"1=1"}
	args := []any{}
	for _, filter := range []struct {
		col   string
		value uint64
	}{{"s.agent_id", q.AgentID}, {"s.executor_user_id", q.OwnerID}, {"s.id", q.SessionID}} {
		if filter.value > 0 {
			parts = append(parts, filter.col+"=?")
			args = append(args, filter.value)
		}
	}
	if q.Mode != "" {
		parts = append(parts, "s.agent_type=?")
		args = append(args, q.Mode)
	}
	alias := "r"
	if call {
		alias = "c"
		for _, filter := range []struct {
			col   string
			value uint64
		}{{"c.model_definition_id", q.ModelID}, {"c.provider_id", q.ProviderID}, {"c.run_id", q.RunID}} {
			if filter.value > 0 {
				parts = append(parts, filter.col+"=?")
				args = append(args, filter.value)
			}
		}
	} else if q.ModelID > 0 || q.ProviderID > 0 {
		parts = append(parts, "EXISTS(SELECT 1 FROM agent_model_call cm WHERE cm.run_id=r.id")
		n := len(parts) - 1
		if q.ModelID > 0 {
			parts[n] += " AND cm.model_definition_id=?"
			args = append(args, q.ModelID)
		}
		if q.ProviderID > 0 {
			parts[n] += " AND cm.provider_id=?"
			args = append(args, q.ProviderID)
		}
		parts[n] += ")"
	}
	if q.Status != "" {
		parts = append(parts, alias+".status=?")
		status := q.Status
		if call {
			switch status {
			case "streaming":
				status = "running"
			case "succeeded":
				status = "completed"
			}
		}
		args = append(args, status)
	}
	if q.From != nil {
		parts = append(parts, alias+".created_at>=?")
		args = append(args, *q.From)
	}
	if q.To != nil {
		parts = append(parts, alias+".created_at<?")
		args = append(args, *q.To)
	}
	return strings.Join(parts, " AND "), args
}

const agentUsageFields = `COUNT(*) AS calls,COALESCE(SUM(c.status='completed'),0) AS completed,COALESCE(SUM(c.status IN ('failed','cancelled','interrupted')),0) AS failed,CAST(SUM(c.input_tokens) AS CHAR) AS input_tokens,CAST(SUM(c.output_tokens) AS CHAR) AS output_tokens,CAST(SUM(c.cache_read_tokens) AS CHAR) AS cache_read_tokens,CAST(SUM(c.cache_write_tokens) AS CHAR) AS cache_write_tokens,COALESCE(SUM(c.input_tokens IS NOT NULL OR c.output_tokens IS NOT NULL OR c.cache_read_tokens IS NOT NULL OR c.cache_write_tokens IS NOT NULL),0) AS known_calls,COALESCE(SUM(c.input_tokens IS NULL AND c.output_tokens IS NULL AND c.cache_read_tokens IS NULL AND c.cache_write_tokens IS NULL),0) AS unknown_calls,COALESCE(SUM(c.usage_completeness='complete'),0) AS complete_calls`

func (t *agentsTx) Usage(q a.UsageQuery) (a.UsageTotals, []a.UsageBucket, error) {
	where, args := agentUsageWhere(q, true)
	from := " FROM (SELECT " + agentModelCallColumns + " FROM agent_model_call) c JOIN agent_session s ON s.id=c.session_id WHERE " + where
	var totals a.UsageTotals
	if e := t.tx.GetContext(t.ctx, &totals, "SELECT "+agentUsageFields+from, args...); e != nil {
		return totals, nil, e
	}
	buckets := []a.UsageBucket{}
	if q.GroupBy == "" {
		return totals, buckets, nil
	}
	group := map[string]string{"day": "DATE_FORMAT(c.created_at,'%Y-%m-%d')", "agent": "CAST(s.agent_id AS CHAR)", "model": "CAST(c.model_definition_id AS CHAR)", "provider": "CAST(c.provider_id AS CHAR)", "agent_type": "s.agent_type"}[q.GroupBy]
	if group == "" {
		return totals, nil, httpx.Invalid("group_by", "unsupported")
	}
	// sqlx nested dotted aliases keep aggregate fields reusable as one DTO.
	fields := agentUsageFields
	for _, name := range []string{"calls", "completed", "failed", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "known_calls", "unknown_calls", "complete_calls"} {
		fields = strings.ReplaceAll(fields, " AS "+name, " AS `totals."+name+"`")
	}
	e := t.tx.SelectContext(t.ctx, &buckets, "SELECT "+group+" AS bucket_key,"+fields+from+" GROUP BY "+group+" ORDER BY bucket_key LIMIT 501", args...)
	if e != nil {
		return totals, nil, e
	}
	if len(buckets) > 500 || q.GroupBy == "day" && len(buckets) > 90 {
		return totals, nil, httpx.Invalid("from", "too_many_groups")
	}
	return totals, buckets, nil
}
func (t *agentsTx) ModelCallPage(q a.UsageQuery) ([]a.ModelCallRow, int, error) {
	where, args := agentUsageWhere(q, true)
	from := " FROM (SELECT " + agentModelCallColumns + " FROM agent_model_call) c JOIN agent_session s ON s.id=c.session_id WHERE " + where
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*)"+from, args...); e != nil {
		return nil, 0, e
	}
	rows := []a.ModelCallRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT c.*"+from+" ORDER BY c.id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *agentsTx) RunMetadataPage(q a.UsageQuery) ([]a.RunMetadataRow, int, error) {
	where, args := agentUsageWhere(q, false)
	from := " FROM agent_run r JOIN agent_session s ON s.id=r.session_id WHERE " + where
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*)"+from, args...); e != nil {
		return nil, 0, e
	}
	rows := []a.RunMetadataRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT r.*,s.agent_id,s.agent_type,IF(s.agent_type='interactive',s.executor_user_id,NULL) AS owner_user_id"+from+" ORDER BY r.id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
