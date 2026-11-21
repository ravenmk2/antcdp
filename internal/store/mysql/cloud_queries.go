package mysql

import (
	"context"
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
 OR EXISTS(SELECT 1 FROM sandbox_execution e JOIN agent_sandbox_execution a ON a.sandbox_execution_id=e.id WHERE a.root_run_id=? AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM cloud_computer_operation WHERE root_run_id=? AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_resource_reference WHERE resource_kind IN ('cloud_lease','local_worker') AND resource_id=? AND released_at IS NULL)`, root, root, root, root, root, root)
	return busy, e
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
	if e == nil {
		e = t.hydrateComputer(v, lock)
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
	if e == nil {
		for i := range v {
			if e = t.hydrateComputer(&v[i], lock); e != nil {
				break
			}
		}
	}
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
	if e == nil {
		for i := range rows {
			if e = t.hydrateComputer(&rows[i], false); e != nil {
				break
			}
		}
	}
	return rows, total, e
}
func (t *agentsTx) ComputerLeases(id uint64) ([]a.CloudLeaseRow, error) {
	rows := []a.CloudLeaseRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+leaseColumns+" FROM agent_cloud_computer_lease WHERE cloud_computer_id=? AND released_at IS NULL ORDER BY root_run_id", id)
	return rows, e
}
func (t *agentsTx) PendingLeases(limit int) ([]a.CloudLeaseRow, error) {
	rows := []a.CloudLeaseRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+leaseColumns+" FROM agent_cloud_computer_lease WHERE released_at IS NULL ORDER BY updated_at,root_run_id LIMIT ?", limit)
	return rows, e
}
func (t *agentsTx) CommandDeclared(call uint64) (bool, error) {
	var found bool
	err := t.tx.GetContext(t.ctx, &found, "SELECT EXISTS(SELECT 1 FROM agent_sandbox_execution WHERE tool_call_id=?)", call)
	return found, err
}
func (t *agentsTx) ListedCommandRows(root uint64) ([]a.CloudExecutionRow, error) {
	const base = "SELECT e.id,e.status,e.is_background,e.exit_code,e.last_observation,e.finished_at FROM agent_sandbox_execution a JOIN sandbox_execution e ON e.id=a.sandbox_execution_id WHERE a.root_run_id=? AND e.is_background=1"
	rows := []a.CloudExecutionRow{}
	query := "(" + base + " AND e.finished_at IS NULL) UNION ALL (" + base + " AND e.finished_at IS NOT NULL ORDER BY e.finished_at DESC,e.id DESC LIMIT 10) ORDER BY finished_at IS NOT NULL,id DESC"
	err := t.tx.SelectContext(t.ctx, &rows, query, root, root)
	return rows, err
}
func (t *agentsTx) LeaseExecutions(root uint64) ([]a.CloudExecutionRow, error) {
	ids := []uint64{}
	if err := t.tx.SelectContext(t.ctx, &ids, "SELECT sandbox_execution_id FROM agent_sandbox_execution WHERE root_run_id=? ORDER BY sandbox_execution_id", root); err != nil {
		return nil, err
	}
	rows := []a.CloudExecutionRow{}
	for _, id := range ids {
		v, err := t.CloudExecution(id, false)
		if err != nil {
			return nil, err
		}
		if v != nil {
			rows = append(rows, *v)
		}
	}
	return rows, nil
}
func (t *agentsTx) CloudActivity(id uint64) (a.CloudActivity, error) {
	var v a.CloudActivity
	e := t.tx.GetContext(t.ctx, &v, `SELECT
 (SELECT COUNT(*) FROM agent_cloud_computer_lease WHERE cloud_computer_id=? AND released_at IS NULL) AS leases,
 (SELECT COUNT(*) FROM agent_file_operation WHERE cloud_computer_id=? AND finished_at IS NULL) AS transfers,
 (SELECT COUNT(*) FROM sandbox_execution e JOIN agent_sandbox_execution a ON a.sandbox_execution_id=e.id JOIN agent_cloud_computer_lease l ON l.root_run_id=a.root_run_id WHERE l.cloud_computer_id=? AND finished_at IS NULL AND status='outcome_unknown') AS unknown,
 (SELECT COUNT(*) FROM agent_resource_reference WHERE resource_kind='cloud_computer' AND resource_id=? AND released_at IS NULL) AS refs,
 (SELECT COUNT(*) FROM cloud_computer_operation WHERE cloud_computer_id=? AND finished_at IS NULL) AS operations`, id, id, id, id, id)
	return v, e
}

// The computer row is locked by the caller. Ordinary runs and tool operations
// may coexist with a session upload, but competing user mutations cannot.
func (t *agentsTx) SessionUploadBlocked(computerID, sessionID uint64) (bool, error) {
	var blocked bool
	err := t.tx.GetContext(t.ctx, &blocked, `SELECT
 EXISTS(SELECT 1 FROM cloud_computer_operation WHERE cloud_computer_id=? AND finished_at IS NULL AND (kind IN ('create','rebuild','pause','resume','delete','workspace_remove','workspace_upload') OR status='outcome_unknown'))
 OR EXISTS(SELECT 1 FROM agent_resource_reference WHERE resource_kind='cloud_computer' AND resource_id=? AND state='unknown' AND released_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_file_operation WHERE cloud_computer_id=? AND status='outcome_unknown' AND finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_cloud_computer_lease l JOIN agent_sandbox_execution a ON a.root_run_id=l.root_run_id JOIN sandbox_execution e ON e.id=a.sandbox_execution_id WHERE l.cloud_computer_id=? AND l.released_at IS NULL AND e.status='outcome_unknown' AND e.finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_cloud_computer_lease l JOIN agent_run r ON r.id=l.root_run_id WHERE l.cloud_computer_id=? AND l.released_at IS NULL AND l.mode='exclusive' AND r.session_id<>?)`, computerID, computerID, computerID, computerID, computerID, sessionID)
	return blocked, err
}
func (s *Store) SandboxInUse(ctx context.Context) (bool, error) {
	var busy bool
	err := s.db.GetContext(ctx, &busy, `SELECT EXISTS(SELECT 1 FROM cloud_computer WHERE deleted_at IS NULL)
 OR EXISTS(SELECT 1 FROM sandbox_instance WHERE finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM sandbox_lease WHERE released_at IS NULL)
 OR EXISTS(SELECT 1 FROM sandbox_operation WHERE finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM sandbox_execution WHERE finished_at IS NULL)
 OR EXISTS(SELECT 1 FROM agent_cloud_computer_lease WHERE released_at IS NULL)
 OR EXISTS(SELECT 1 FROM cloud_computer_operation WHERE finished_at IS NULL AND kind<>'command')
 OR EXISTS(SELECT 1 FROM agent_file_operation WHERE finished_at IS NULL)`)
	return busy, err
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

func (t *agentsTx) PendingCloudOperations(epoch string, now time.Time, limit int) ([]a.CloudOperationRow, error) {
	rows := []a.CloudOperationRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+cloudOperationColumns+" FROM cloud_computer_operation WHERE kind IN "+cloudMaintenanceKinds+" AND finished_at IS NULL AND (status IN ('queued','outcome_unknown') OR executor_epoch<>? OR deadline_at<=?) ORDER BY updated_at,id LIMIT ?", epoch, now, limit)
	return rows, e
}
