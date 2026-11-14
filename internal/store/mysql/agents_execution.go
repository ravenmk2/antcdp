package mysql

import (
	"database/sql"
	"errors"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) PendingCompactions(epoch string, now time.Time, limit int) ([]a.CompactionRow, error) {
	rows := []a.CompactionRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentCompactionColumns+" FROM agent_compaction WHERE status='queued' OR (status='running' AND (executor_epoch<>? OR deadline_at<=?)) ORDER BY id LIMIT ?", epoch, now, limit)
	return rows, e
}
func (t *agentsTx) CompactionModelCall(id uint64) (*a.ModelCallRow, error) {
	v := &a.ModelCallRow{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+agentModelCallColumns+" FROM agent_model_call WHERE compaction_id=? AND purpose='compaction' ORDER BY id LIMIT 1", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) RecoverableRoots(epoch string, limit int) ([]a.RunRow, error) {
	rows := []a.RunRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentRunColumns+" FROM agent_run WHERE root_run_id IS NULL AND finished_at IS NULL AND executor_epoch<>? ORDER BY id LIMIT ?", epoch, limit)
	return rows, e
}
func (t *agentsTx) DueRoots(now time.Time, limit int) ([]a.RunRow, error) {
	rows := []a.RunRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentRunColumns+" FROM agent_run WHERE root_run_id IS NULL AND finished_at IS NULL AND (deadline_at<=? OR stop_deadline_at<=? OR EXISTS(SELECT 1 FROM agent_model_call c WHERE c.root_run_id=agent_run.id AND c.status='running' AND c.deadline_at<=?)) ORDER BY id LIMIT ?", now, now, now.Add(-15*time.Second), limit)
	return rows, e
}
func (t *agentsTx) DueInputs(now time.Time, limit int) ([]a.InputRow, error) {
	rows := []a.InputRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentInputColumns+" FROM agent_input WHERE status='pending' AND queue_deadline_at<=? ORDER BY queue_deadline_at,id LIMIT ?", now, limit)
	return rows, e
}
func (t *agentsTx) DueInteractions(now time.Time, limit int) ([]a.InteractionRow, error) {
	rows := []a.InteractionRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentInteractionColumns+" FROM agent_interaction WHERE ((kind='question' AND status='waiting') OR (kind='approval' AND status='pending')) AND wait_deadline_at<=? ORDER BY wait_deadline_at,id LIMIT ?", now, limit)
	return rows, e
}

func (t *agentsTx) FileByHash(session uint64, hash []byte) (*a.FileRow, error) {
	v := &a.FileRow{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+agentFileColumns+" FROM agent_file WHERE content_session_id=? AND sha256=? AND state='bound' AND integrity_state='verified' AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE", session, hash)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) SurfaceEvents(session, after, through uint64, limit int) ([]a.EventRow, error) {
	rows := []a.EventRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentEventColumns+" FROM agent_event WHERE session_id=? AND seq>? AND seq<=? AND event_type IN ('input/message','assistant/message','assistant/attempt','tool/result','context/runtime','context/skills','context/authorization','compaction/summary') ORDER BY seq LIMIT ?", session, after, through, limit)
	return rows, e
}
func (t *agentsTx) AttemptForStep(run, step, attempt uint64) (*a.ModelCallRow, error) {
	v := &a.ModelCallRow{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+agentModelCallColumns+" FROM agent_model_call WHERE run_id=? AND purpose='generation' AND step_no=? AND attempt_no=?", run, step, attempt)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) RunModelCalls(run uint64) ([]a.ModelCallRow, error) {
	rows := []a.ModelCallRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentModelCallColumns+" FROM agent_model_call WHERE run_id=? ORDER BY id", run)
	return rows, e
}
