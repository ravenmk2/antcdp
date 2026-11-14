package mysql

import (
	"database/sql"
	"errors"
	"strings"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) PendingCandidates(after uint64, limit int) ([]a.PendingCandidate, error) {
	rows := []a.PendingCandidate{}
	e := t.tx.SelectContext(t.ctx, &rows, `SELECT s.id AS session_id,i.id AS input_id FROM agent_session s JOIN agent d ON d.id=s.agent_id JOIN agent_input i ON i.session_id=s.id AND i.status='pending' WHERE s.id>? AND s.session_kind='root' AND s.archived_at IS NULL AND s.queue_paused=0 AND s.active_run_id IS NULL AND s.active_compaction_id IS NULL AND d.enabled=1 AND i.queue_deadline_at>UTC_TIMESTAMP(3) AND NOT EXISTS(SELECT 1 FROM agent_input older WHERE older.session_id=s.id AND older.status='pending' AND older.queue_order<i.queue_order) ORDER BY s.id LIMIT ?`, after, limit)
	return rows, e
}
func (t *agentsTx) ActiveRoots(agent uint64) (int, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM agent_run r JOIN agent_session s ON s.id=r.session_id WHERE s.agent_id=? AND r.root_run_id IS NULL AND r.active_slot=1", agent)
	return n, e
}
func (t *agentsTx) RunTools(id uint64) ([]a.ToolCallRow, error) {
	rows := []a.ToolCallRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentToolCallColumns+" FROM agent_tool_call WHERE run_id=? ORDER BY step_no,call_ordinal", id)
	return rows, e
}
func (t *agentsTx) FamilyRuns(id uint64) ([]a.RunRow, error) {
	rows := []a.RunRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentRunColumns+" FROM agent_run WHERE id=? OR root_run_id=? ORDER BY id", id, id)
	return rows, e
}

func (t *agentsTx) InputFiles(id uint64) ([]a.InputFileRow, error) {
	rows := []a.InputFileRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT input_id,ordinal,reference_kind,reference_id,file_id,content_session_id,source_sha256,created_at FROM agent_input_file WHERE input_id=? ORDER BY ordinal", id)
	return rows, e
}
func (t *agentsTx) ReplaceInputFiles(id uint64, rows []a.InputFileRow) error {
	if _, e := t.tx.ExecContext(t.ctx, "DELETE FROM agent_input_file WHERE input_id=?", id); e != nil {
		return e
	}
	for _, row := range rows {
		_, e := t.named("INSERT INTO agent_input_file(input_id,ordinal,reference_kind,reference_id,file_id,content_session_id,source_sha256,created_at) VALUES(:input_id,:ordinal,:reference_kind,:reference_id,:file_id,:content_session_id,:source_sha256,:created_at)", row)
		if e != nil {
			return e
		}
	}
	return nil
}

func (t *agentsTx) Sessions(user uint64, q a.SessionQuery) ([]a.SessionSummary, int, error) {
	where := []string{"s.session_kind='root'", "s.agent_type=?"}
	args := []any{user, q.Mode}
	if q.Mode == "interactive" {
		where = append(where, "s.executor_user_id=?")
		args = append(args, user)
	}
	if q.Archived == "true" {
		where = append(where, "s.archived_at IS NOT NULL")
	} else if q.Archived != "all" {
		where = append(where, "s.archived_at IS NULL")
	}
	if q.AgentID != 0 {
		where = append(where, "s.agent_id=?")
		args = append(args, q.AgentID)
	}
	if q.Q != "" {
		where = append(where, "s.title LIKE ? ESCAPE '!'")
		args = append(args, "%"+strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q)+"%")
	}
	if q.Attention == "result_unviewed" {
		where = append(where, "EXISTS(SELECT 1 FROM agent_run ar WHERE ar.session_id=s.id AND ar.root_run_id IS NULL AND ar.ended_seq>COALESCE(p.viewed_through_seq,0) AND ar.status IN ('succeeded','waiting_input','failed','cancelled','interrupted'))")
	}
	if q.Attention == "response_required" {
		where = append(where, agentLocalAdmission+" AND ("+agentQuestionCount+"+"+agentApprovalCount+">0)")
	}
	from := " FROM agent_session s LEFT JOIN agent_session_preference p ON p.session_id=s.id AND p.user_id=? LEFT JOIN agent_run r ON r.id=s.active_run_id WHERE " + strings.Join(where, " AND ")
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*)"+from, args...); e != nil {
		return nil, 0, e
	}
	rows := []a.SessionSummary{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT s.id,s.agent_id,s.agent_type,s.title,s.archived_at,COALESCE(p.pinned,0) AS pinned,s.last_activity_at,r.status AS active_run_status"+from+" ORDER BY pinned DESC,s.last_activity_at DESC,s.id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *agentsTx) Preference(user, session uint64, lock bool) (*a.PreferenceRow, error) {
	q := "SELECT user_id,session_id,pinned,pinned_at,viewed_through_seq,viewed_at,row_version,created_at,updated_at FROM agent_session_preference WHERE user_id=? AND session_id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.PreferenceRow{}
	e := t.tx.GetContext(t.ctx, v, q, user, session)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) SavePin(v *a.PreferenceRow) error {
	_, e := t.named("INSERT INTO agent_session_preference(user_id,session_id,pinned,pinned_at,viewed_through_seq,viewed_at,row_version,created_at,updated_at) VALUES(:user_id,:session_id,:pinned,:pinned_at,0,NULL,:row_version,:created_at,:updated_at) ON DUPLICATE KEY UPDATE pinned=VALUES(pinned),pinned_at=VALUES(pinned_at),row_version=VALUES(row_version),updated_at=VALUES(updated_at)", v)
	return e
}
func (t *agentsTx) AdvanceView(v *a.PreferenceRow) error {
	_, e := t.named("INSERT INTO agent_session_preference(user_id,session_id,pinned,pinned_at,viewed_through_seq,viewed_at,row_version,created_at,updated_at) VALUES(:user_id,:session_id,FALSE,NULL,:viewed_through_seq,:viewed_at,1,:created_at,:updated_at) ON DUPLICATE KEY UPDATE viewed_at=IF(viewed_through_seq<VALUES(viewed_through_seq),VALUES(viewed_at),viewed_at),viewed_through_seq=GREATEST(viewed_through_seq,VALUES(viewed_through_seq))", v)
	return e
}
func (t *agentsTx) SessionCounts(id uint64) (a.SessionCounts, error) {
	var v a.SessionCounts
	e := t.tx.GetContext(t.ctx, &v.Inputs, "SELECT COUNT(*) FROM agent_input WHERE session_id=? AND status='pending'", id)
	if e != nil {
		return v, e
	}
	e = t.tx.GetContext(t.ctx, &v.Interactions, "SELECT COUNT(*) FROM agent_interaction WHERE session_id=? AND ((kind='question' AND status IN ('waiting','continued')) OR (kind='approval' AND status='pending' AND wait_deadline_at>UTC_TIMESTAMP(3)))", id)
	return v, e
}
func (t *agentsTx) LatestResult(id uint64) (*a.RunResultRef, error) {
	v := &a.RunResultRef{}
	e := t.tx.GetContext(t.ctx, v, "SELECT id,status,end_reason,finished_at,ended_seq FROM agent_run WHERE session_id=? AND root_run_id IS NULL AND ended_seq IS NOT NULL AND status IN ('succeeded','waiting_input','failed','cancelled','interrupted') ORDER BY ended_seq DESC LIMIT 1", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) UnviewedResults(id, seq uint64) (int, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM agent_run WHERE session_id=? AND root_run_id IS NULL AND ended_seq>? AND status IN ('succeeded','waiting_input','failed','cancelled','interrupted')", id, seq)
	return n, e
}
func (t *agentsTx) ResultAt(id, seq uint64) (*a.RunResultRef, error) {
	v := &a.RunResultRef{}
	e := t.tx.GetContext(t.ctx, v, "SELECT id,status,end_reason,finished_at,ended_seq FROM agent_run WHERE session_id=? AND root_run_id IS NULL AND ended_seq=? AND status IN ('succeeded','waiting_input','failed','cancelled','interrupted')", id, seq)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) Inputs(id uint64, q a.InputQuery) ([]a.InputRow, int, error) {
	where := "session_id=?"
	args := []any{id}
	if q.State != "" {
		where += " AND status=?"
		args = append(args, q.State)
	}
	var n int
	if e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM agent_input WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	rows := []a.InputRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentInputColumns+" FROM agent_input WHERE "+where+" ORDER BY queue_order,id LIMIT ? OFFSET ?", args...)
	return rows, n, e
}
func (t *agentsTx) SessionInteractions(id uint64) ([]a.InteractionRow, error) {
	rows := []a.InteractionRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentInteractionColumns+" FROM agent_interaction WHERE session_id=? AND status IN ('waiting','continued','reply_queued','pending','approved_once') ORDER BY id", id)
	return rows, e
}
func (t *agentsTx) Events(id, after, through uint64, limit int, desc bool) ([]a.EventRow, error) {
	order := "ASC"
	if desc {
		order = "DESC"
	}
	rows := []a.EventRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentEventColumns+" FROM agent_event WHERE session_id=? AND seq>? AND seq<=? ORDER BY seq "+order+" LIMIT ?", id, after, through, limit)
	return rows, e
}
func (t *agentsTx) EventAt(id, seq uint64) (*a.EventRow, error) {
	v := &a.EventRow{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+agentEventColumns+" FROM agent_event WHERE session_id=? AND seq=?", id, seq)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
