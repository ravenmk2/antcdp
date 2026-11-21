package mysql

import (
	"database/sql"
	"errors"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) FileOperationByTool(id uint64, lock bool) (*a.FileOperationRow, error) {
	q := "SELECT " + agentFileOperationColumns + " FROM agent_file_operation WHERE tool_call_id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.FileOperationRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) FileOperationItems(id uint64, lock bool) ([]a.FileOperationItemRow, error) {
	q := "SELECT " + agentFileOperationItemColumns + " FROM agent_file_operation_item WHERE operation_id=? ORDER BY ordinal"
	if lock {
		q += " FOR UPDATE"
	}
	v := []a.FileOperationItemRow{}
	e := t.tx.SelectContext(t.ctx, &v, q, id)
	return v, e
}
func (t *agentsTx) PendingFileOperations(epoch string, now time.Time, limit int) ([]a.FileOperationRow, error) {
	v := []a.FileOperationRow{}
	e := t.tx.SelectContext(t.ctx, &v, "SELECT "+agentFileOperationColumns+" FROM agent_file_operation WHERE finished_at IS NULL AND (executor_epoch<>? OR deadline_at<=? OR status IN ('outcome_unknown','cancelled')) ORDER BY updated_at,id LIMIT ?", epoch, now, limit)
	return v, e
}
