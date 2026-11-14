package mysql

import (
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) PendingWorkspaceOperations(epoch string, now time.Time, limit int) ([]a.CloudOperationRow, error) {
	rows := []a.CloudOperationRow{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+cloudOperationColumns+" FROM cloud_computer_operation WHERE kind IN ('workspace_read','workspace_download','workspace_tool','workspace_prepare','workspace_verify','workspace_skill','workspace_mkdir','workspace_remove') AND (status IN ('queued','outcome_unknown') OR (status='running' AND (executor_epoch<>? OR deadline_at<=?)) OR (kind='workspace_download' AND JSON_UNQUOTE(JSON_EXTRACT(observation,'$.local_storage_key'))<>'' AND (executor_epoch<>? OR (status IN ('completed','failed','cancelled') AND JSON_EXTRACT(observation,'$.local_cleanup_pending')=true)))) ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END,updated_at,id LIMIT ?", epoch, now, epoch, limit)
	return rows, err
}

func (t *agentsTx) HolderReferences(kind, id string, lock bool) ([]a.ResourceReferenceRow, error) {
	q := "SELECT " + agentResourceReferenceColumns + " FROM agent_resource_reference WHERE holder_kind=? AND holder_id=? ORDER BY id"
	if lock {
		q += " FOR UPDATE"
	}
	rows := []a.ResourceReferenceRow{}
	e := t.tx.SelectContext(t.ctx, &rows, q, kind, id)
	return rows, e
}
func (t *agentsTx) ActiveResourceReferences(kind string, id uint64) ([]a.ResourceReferenceRow, error) {
	rows := []a.ResourceReferenceRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentResourceReferenceColumns+" FROM agent_resource_reference WHERE resource_kind=? AND resource_id=? AND state IN ('active','unknown') ORDER BY id", kind, id)
	return rows, e
}
