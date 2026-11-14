package mysql

import (
	"database/sql"
	"errors"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

const cloudMaintenanceKinds = "('create','rebuild','pause','resume','delete')"

func (t *agentsTx) ComputerSessions(id uint64) ([]a.SessionRow, error) {
	rows := []a.SessionRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentSessionColumns+" FROM agent_session WHERE cloud_computer_id=? AND session_kind='root' ORDER BY id FOR UPDATE", id)
	return rows, e
}
func (t *agentsTx) CloudRootWorkPending(root uint64) (bool, error) {
	var busy bool
	e := t.tx.GetContext(t.ctx, &busy, `SELECT
 EXISTS(SELECT 1 FROM agent_run WHERE root_run_id=? AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_tool_call WHERE root_run_id=? AND (result_event_seq IS NULL OR (status='outcome_unknown' AND reconciled_outcome IS NULL)))
 OR EXISTS(SELECT 1 FROM agent_file_operation WHERE root_run_id=? AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM cloud_computer_execution WHERE root_run_id=? AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM cloud_computer_operation WHERE root_run_id=? AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_resource_reference WHERE resource_kind IN ('cloud_lease','local_worker') AND resource_id=? AND released_at IS NULL)`, root, root, root, root, root, root)
	return busy, e
}

func (t *agentsTx) CloudResetSessions() ([]a.SessionRow, error) {
	rows := []a.SessionRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentSessionColumns+" FROM agent_session WHERE session_kind='root' AND (EXISTS(SELECT 1 FROM agent_input i WHERE i.session_id=agent_session.id AND i.status='pending') OR EXISTS(SELECT 1 FROM agent_interaction q WHERE q.session_id=agent_session.id AND q.status IN ('pending','waiting','continued','reply_queued','approved_once') AND q.approval_consumed_at IS NULL)) ORDER BY id FOR UPDATE")
	return rows, e
}

func (t *agentsTx) PersonalComputer(owner uint64, lock bool) (*a.CloudComputerRow, error) {
	q := "SELECT " + computerColumns + " FROM cloud_computer WHERE personal_owner_id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudComputerRow{}
	e := t.tx.GetContext(t.ctx, v, q, owner)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) PoolComputers(agent uint64, lock bool) ([]a.CloudComputerRow, error) {
	q := "SELECT " + computerColumns + " FROM cloud_computer WHERE pool_agent_id=? AND deleted_at IS NULL ORDER BY idle_since,id"
	if lock {
		q += " FOR UPDATE"
	}
	v := []a.CloudComputerRow{}
	e := t.tx.SelectContext(t.ctx, &v, q, agent)
	return v, e
}
func (t *agentsTx) Computers(q a.CloudQuery) ([]a.CloudComputerRow, int, error) {
	where, args := " WHERE 1=1", []any{}
	if q.OwnerUserID != 0 {
		where += " AND owner_user_id=?"
		args = append(args, q.OwnerUserID)
	}
	if q.PoolAgentID != 0 {
		where += " AND pool_agent_id=?"
		args = append(args, q.PoolAgentID)
	}
	if q.State != "" {
		where += " AND state=?"
		args = append(args, q.State)
	}
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM cloud_computer"+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []a.CloudComputerRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+computerColumns+" FROM cloud_computer"+where+" ORDER BY id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *agentsTx) ComputerLeases(id uint64) ([]a.CloudLeaseRow, error) {
	rows := []a.CloudLeaseRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+leaseColumns+" FROM cloud_computer_lease WHERE cloud_computer_id=? AND released_at IS NULL ORDER BY root_run_id", id)
	return rows, e
}
func (t *agentsTx) PendingLeases(limit int) ([]a.CloudLeaseRow, error) {
	rows := []a.CloudLeaseRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+leaseColumns+" FROM cloud_computer_lease WHERE released_at IS NULL ORDER BY updated_at,root_run_id LIMIT ?", limit)
	return rows, e
}
func (t *agentsTx) LeaseExecutions(root uint64) ([]a.CloudExecutionRow, error) {
	rows := []a.CloudExecutionRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+cloudExecutionColumns+" FROM cloud_computer_execution WHERE root_run_id=? ORDER BY id", root)
	return rows, e
}
func (t *agentsTx) CloudActivity(id uint64) (a.CloudActivity, error) {
	var v a.CloudActivity
	e := t.tx.GetContext(t.ctx, &v, `SELECT
 (SELECT COUNT(*) FROM cloud_computer_lease WHERE cloud_computer_id=? AND released_at IS NULL) AS leases,
 (SELECT COUNT(*) FROM agent_file_operation WHERE cloud_computer_id=? AND finished_at IS NULL) AS transfers,
 (SELECT COUNT(*) FROM cloud_computer_execution WHERE cloud_computer_id=? AND finished_at IS NULL AND status='outcome_unknown') AS unknown,
 (SELECT COUNT(*) FROM agent_resource_reference WHERE resource_kind='cloud_computer' AND resource_id=? AND released_at IS NULL) AS refs,
 (SELECT COUNT(*) FROM cloud_computer_operation WHERE cloud_computer_id=? AND finished_at IS NULL) AS operations`, id, id, id, id, id)
	return v, e
}
func (t *agentsTx) CloudTopology() (int, int, error) {
	var v struct {
		Count int `db:"count"`
		Busy  int `db:"busy"`
	}
	e := t.tx.GetContext(t.ctx, &v, `SELECT
 (SELECT COUNT(*) FROM cloud_computer WHERE deleted_at IS NULL) AS count,
 (SELECT COUNT(*) FROM cloud_computer_lease WHERE released_at IS NULL)
 +(SELECT COUNT(*) FROM cloud_computer_operation WHERE finished_at IS NULL)
 +(SELECT COUNT(*) FROM cloud_computer_execution WHERE finished_at IS NULL)
 +(SELECT COUNT(*) FROM agent_resource_reference WHERE resource_kind IN ('cloud_computer','cloud_lease') AND released_at IS NULL)
 +(SELECT COUNT(*) FROM agent_run WHERE settled_at IS NULL)
 +(SELECT COUNT(*) FROM agent_file_operation WHERE finished_at IS NULL) AS busy`)
	return v.Count, v.Busy, e
}
func (t *agentsTx) ResetCloudResources(generation uint64, now time.Time) error {
	_, e := t.tx.ExecContext(t.ctx, `UPDATE cloud_computer SET state='uninitialized',backend_generation=?,runtime_generation=runtime_generation+1,storage_generation=storage_generation+1,runtime_id=NULL,runtime_creation_token=NULL,runtime_expires_at=NULL,volume_id=NULL,volume_name=NULL,volume_state='absent',volume_cleanup_state='not_requested',applied_template_version=NULL,effective_environment=NULL,verified_capabilities=NULL,last_observed_at=NULL,error_code=NULL,fence_version=fence_version+1,row_version=row_version+1,idle_since=?,updated_at=? WHERE deleted_at IS NULL`, generation, now, now)
	if e != nil {
		return e
	}
	_, e = t.tx.ExecContext(t.ctx, "DELETE FROM cloud_computer_skill_state")
	return e
}
func (t *agentsTx) cloudOperationQuery(where string, args ...any) (*a.CloudOperationRow, error) {
	v := &a.CloudOperationRow{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+cloudOperationColumns+" FROM cloud_computer_operation WHERE "+where, args...)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) ActiveCloudOperation(id uint64) (*a.CloudOperationRow, error) {
	return t.cloudOperationQuery("active_computer_id=?", id)
}
func (t *agentsTx) LatestCloudOperation(id uint64) (*a.CloudOperationRow, error) {
	return t.cloudOperationQuery("cloud_computer_id=? AND kind IN "+cloudMaintenanceKinds+" ORDER BY id DESC LIMIT 1", id)
}
func (t *agentsTx) CloudOperationByToken(token string, lock bool) (*a.CloudOperationRow, error) {
	where := "operation_token=?"
	if lock {
		where += " FOR UPDATE"
	}
	return t.cloudOperationQuery(where, token)
}
func (t *agentsTx) CloudOperationByPublic(id uint64) (*a.CloudOperationRow, error) {
	return t.cloudOperationQuery("public_operation_id=?", id)
}
func (t *agentsTx) PendingCloudOperations(epoch string, now time.Time, limit int) ([]a.CloudOperationRow, error) {
	rows := []a.CloudOperationRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+cloudOperationColumns+" FROM cloud_computer_operation WHERE kind IN "+cloudMaintenanceKinds+" AND finished_at IS NULL AND (status IN ('queued','outcome_unknown') OR executor_epoch<>? OR deadline_at<=?) ORDER BY updated_at,id LIMIT ?", epoch, now, limit)
	return rows, e
}
