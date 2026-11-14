package mysql

import (
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *identityTx) AgentObservations() a.ObservationRepository { return &agentsTx{t.ctx, t.tx} }
func (t *agentsTx) HistoryGroups(session, from, through uint64) ([]a.SequenceRange, error) {
	rows := []a.SequenceRange{}
	// The observation boundary is the atomically committed assistant + call
	// declarations. Later results and human inputs page independently by seq.
	// Model surface/compaction grouping remains stricter and is built elsewhere.
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT m.response_event_seq AS from_seq,GREATEST(m.response_event_seq,COALESCE(MAX(t.arguments_event_seq),0)) AS through_seq FROM agent_model_call m LEFT JOIN agent_tool_call t ON t.model_call_id=m.id WHERE m.session_id=? AND m.response_event_seq IS NOT NULL AND m.response_event_seq<=? GROUP BY m.id,m.response_event_seq HAVING through_seq>=? ORDER BY from_seq`, session, through, from)
	return rows, err
}
func (t *agentsTx) RunPage(id uint64, children bool, q a.ObservationQuery) ([]a.RunRow, int, error) {
	where := "session_id=?"
	if children {
		where = "parent_run_id=?"
	}
	args := []any{id}
	if q.Status != "" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	var total int
	if err := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_run WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []a.RunRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentRunColumns+" FROM agent_run WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, err
}
func (t *agentsTx) ToolPage(id uint64, q a.ObservationQuery) ([]a.ToolCallRow, int, error) {
	where := "run_id=?"
	args := []any{id}
	if q.Status != "" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	var total int
	if err := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_tool_call WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []a.ToolCallRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentToolCallColumns+" FROM agent_tool_call WHERE "+where+" ORDER BY step_no,call_ordinal,id LIMIT ? OFFSET ?", args...)
	return rows, total, err
}
func (t *agentsTx) InteractionPage(id uint64, q a.ObservationQuery) ([]a.InteractionRow, int, error) {
	where := "session_id=?"
	args := []any{id}
	if q.Kind != "" {
		where += " AND kind=?"
		args = append(args, q.Kind)
	}
	if q.Status == "unresolved" {
		where += " AND status IN ('waiting','continued','reply_queued','pending','approved_once')"
	} else if q.Status != "" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	var total int
	if err := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_interaction WHERE "+where, args...); err != nil {
		return nil, 0, err
	}
	rows := []a.InteractionRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentInteractionColumns+" FROM agent_interaction WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, err
}
func (t *agentsTx) RunCounts(id uint64) (a.RunCounts, error) {
	var out a.RunCounts
	err := t.tx.GetContext(t.ctx, &out, `SELECT (SELECT COUNT(*) FROM agent_model_call WHERE run_id=?) AS model_calls, (SELECT COUNT(*) FROM agent_tool_call WHERE run_id=?) AS tool_calls,(SELECT COUNT(*) FROM agent_tool_call WHERE run_id=? AND status='outcome_unknown' AND reconciled_outcome IS NULL) AS unknown_tools,(SELECT COUNT(*) FROM agent_tool_call WHERE run_id=? AND status IN ('dispatching','running')) AS active_tools,(SELECT COUNT(*) FROM agent_file_operation WHERE root_run_id=? AND status IN ('preparing','transferring','committing','outcome_unknown')) AS pending_transfers`, id, id, id, id, id)
	return out, err
}
