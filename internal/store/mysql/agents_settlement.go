package mysql

import a "github.com/ravenmk2/antcdp/internal/modules/agents"

func (t *agentsTx) UnsettledRoots(limit int) ([]a.RunRow, error) {
	rows := []a.RunRow{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentRunColumns+" FROM agent_run WHERE root_run_id IS NULL AND settled_at IS NULL AND finished_at IS NOT NULL ORDER BY updated_at,id LIMIT ?", limit)
	return rows, err
}

func (t *agentsTx) RootPhysicalPending(root uint64) (bool, error) {
	var pending bool
	err := t.tx.GetContext(t.ctx, &pending, `SELECT
        EXISTS(SELECT 1 FROM agent_run WHERE root_run_id=? AND finished_at IS NULL)
        OR EXISTS(SELECT 1 FROM agent_tool_call WHERE root_run_id=? AND (result_event_seq IS NULL OR (status='outcome_unknown' AND reconciled_outcome IS NULL)))
        OR EXISTS(SELECT 1 FROM agent_file_operation WHERE root_run_id=? AND finished_at IS NULL)
        OR EXISTS(SELECT 1 FROM cloud_computer_lease WHERE root_run_id=? AND released_at IS NULL)
        OR EXISTS(SELECT 1 FROM agent_resource_reference WHERE resource_kind='local_worker' AND resource_id=? AND released_at IS NULL)`, root, root, root, root, root)
	return pending, err
}
