package mysql

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"
	s "github.com/ravenmk2/antcdp/internal/modules/sandboxes"
)

type sandboxTx struct {
	ctx context.Context
	tx  *sqlx.Tx
}

func (t *sandboxTx) ExpiredLeases(now time.Time, after uint64, limit int) ([]s.Lease, error) {
	rows := []s.Lease{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+sandboxLeaseColumns+" FROM sandbox_lease WHERE released_at IS NULL AND lease_expires_at<=? ORDER BY (id>?) DESC,id LIMIT ?", now, after, limit)
	return rows, err
}

func (t *identityTx) SandboxState() s.Repository { return &sandboxTx{t.ctx, t.tx} }
func (t *agentsTx) Sandbox() s.Repository        { return &sandboxTx{t.ctx, t.tx} }
func (t *sandboxTx) named(q string, v any) (sql.Result, error) {
	return t.tx.NamedExecContext(t.ctx, q, v)
}

const sandboxInstanceColumns = "`id`,`backend_generation`,`remote_id`,`creation_token`,`state`,`effective_config`,`verified_capabilities`,`expires_at`,`last_observed_at`,`error_code`,`executor_epoch`,`fence_version`,`row_version`,`created_at`,`updated_at`,`finished_at`"

func (t *sandboxTx) Instance(id uint64, lock bool) (*s.Instance, error) {
	q := "SELECT " + sandboxInstanceColumns + " FROM sandbox_instance WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &s.Instance{}
	err := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) InstanceByToken(token string) (*s.Instance, error) {
	v := &s.Instance{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+sandboxInstanceColumns+" FROM sandbox_instance WHERE creation_token=? FOR UPDATE", token)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) InsertInstance(v *s.Instance) error {
	r, e := t.named("INSERT INTO sandbox_instance(`backend_generation`,`remote_id`,`creation_token`,`state`,`effective_config`,`verified_capabilities`,`expires_at`,`last_observed_at`,`error_code`,`executor_epoch`,`fence_version`,`row_version`,`created_at`,`updated_at`,`finished_at`) VALUES(:backend_generation,:remote_id,:creation_token,:state,:effective_config,:verified_capabilities,:expires_at,:last_observed_at,:error_code,:executor_epoch,:fence_version,:row_version,:created_at,:updated_at,:finished_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *sandboxTx) SaveInstance(v *s.Instance) error {
	_, e := t.named("UPDATE sandbox_instance SET `backend_generation`=:backend_generation,`remote_id`=:remote_id,`creation_token`=:creation_token,`state`=:state,`effective_config`=:effective_config,`verified_capabilities`=:verified_capabilities,`expires_at`=:expires_at,`last_observed_at`=:last_observed_at,`error_code`=:error_code,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`row_version`=:row_version,`created_at`=:created_at,`updated_at`=:updated_at,`finished_at`=:finished_at WHERE id=:id", v)
	return e
}

const sandboxLeaseColumns = "`id`,`sandbox_instance_id`,`consumer_kind`,`consumer_id`,`mode`,`state`,`executor_epoch`,`fence_version`,`acquired_at`,`lease_expires_at`,`released_at`,`release_reason`,`updated_at`"

func (t *sandboxTx) Lease(id uint64, lock bool) (*s.Lease, error) {
	q := "SELECT " + sandboxLeaseColumns + " FROM sandbox_lease WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &s.Lease{}
	err := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) InsertLease(v *s.Lease) error {
	r, e := t.named("INSERT INTO sandbox_lease(`sandbox_instance_id`,`consumer_kind`,`consumer_id`,`mode`,`state`,`executor_epoch`,`fence_version`,`acquired_at`,`lease_expires_at`,`released_at`,`release_reason`,`updated_at`) VALUES(:sandbox_instance_id,:consumer_kind,:consumer_id,:mode,:state,:executor_epoch,:fence_version,:acquired_at,:lease_expires_at,:released_at,:release_reason,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *sandboxTx) SaveLease(v *s.Lease) error {
	_, e := t.named("UPDATE sandbox_lease SET `sandbox_instance_id`=:sandbox_instance_id,`consumer_kind`=:consumer_kind,`consumer_id`=:consumer_id,`mode`=:mode,`state`=:state,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`acquired_at`=:acquired_at,`lease_expires_at`=:lease_expires_at,`released_at`=:released_at,`release_reason`=:release_reason,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const sandboxExecutionColumns = "`id`,`sandbox_instance_id`,`lease_id`,`execution_token`,`remote_execution_id`,`is_background`,`status`,`cwd`,`execution_spec_hash`,`executor_epoch`,`fence_version`,`exit_code`,`output_cursor`,`last_observation`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`last_observed_at`,`finished_at`"

func (t *sandboxTx) Execution(id uint64, lock bool) (*s.Execution, error) {
	q := "SELECT " + sandboxExecutionColumns + " FROM sandbox_execution WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &s.Execution{}
	err := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) ExecutionByToken(token string) (*s.Execution, error) {
	v := &s.Execution{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+sandboxExecutionColumns+" FROM sandbox_execution WHERE execution_token=? FOR UPDATE", token)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) InsertExecution(v *s.Execution) error {
	r, e := t.named("INSERT INTO sandbox_execution(`sandbox_instance_id`,`lease_id`,`execution_token`,`remote_execution_id`,`is_background`,`status`,`cwd`,`execution_spec_hash`,`executor_epoch`,`fence_version`,`exit_code`,`output_cursor`,`last_observation`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`last_observed_at`,`finished_at`) VALUES(:sandbox_instance_id,:lease_id,:execution_token,:remote_execution_id,:is_background,:status,:cwd,:execution_spec_hash,:executor_epoch,:fence_version,:exit_code,:output_cursor,:last_observation,:error_code,:created_at,:started_at,:deadline_at,:cancel_requested_at,:last_observed_at,:finished_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *sandboxTx) SaveExecution(v *s.Execution) error {
	_, e := t.named("UPDATE sandbox_execution SET `sandbox_instance_id`=:sandbox_instance_id,`lease_id`=:lease_id,`execution_token`=:execution_token,`remote_execution_id`=:remote_execution_id,`is_background`=:is_background,`status`=:status,`cwd`=:cwd,`execution_spec_hash`=:execution_spec_hash,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`exit_code`=:exit_code,`output_cursor`=:output_cursor,`last_observation`=:last_observation,`error_code`=:error_code,`created_at`=:created_at,`started_at`=:started_at,`deadline_at`=:deadline_at,`cancel_requested_at`=:cancel_requested_at,`last_observed_at`=:last_observed_at,`finished_at`=:finished_at WHERE id=:id", v)
	return e
}

const sandboxOperationColumns = "`id`,`sandbox_instance_id`,`lease_id`,`operation_token`,`kind`,`status`,`request_hash`,`intent`,`observation`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`finished_at`,`updated_at`"

func (t *sandboxTx) Operation(id uint64, lock bool) (*s.Operation, error) {
	q := "SELECT " + sandboxOperationColumns + " FROM sandbox_operation WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &s.Operation{}
	err := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) OperationByToken(token string) (*s.Operation, error) {
	v := &s.Operation{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+sandboxOperationColumns+" FROM sandbox_operation WHERE operation_token=? FOR UPDATE", token)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *sandboxTx) InsertOperation(v *s.Operation) error {
	r, e := t.named("INSERT INTO sandbox_operation(`sandbox_instance_id`,`lease_id`,`operation_token`,`kind`,`status`,`request_hash`,`intent`,`observation`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`finished_at`,`updated_at`) VALUES(:sandbox_instance_id,:lease_id,:operation_token,:kind,:status,:request_hash,:intent,:observation,:executor_epoch,:fence_version,:error_code,:created_at,:started_at,:deadline_at,:cancel_requested_at,:finished_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *sandboxTx) SaveOperation(v *s.Operation) error {
	_, e := t.named("UPDATE sandbox_operation SET `sandbox_instance_id`=:sandbox_instance_id,`lease_id`=:lease_id,`operation_token`=:operation_token,`kind`=:kind,`status`=:status,`request_hash`=:request_hash,`intent`=:intent,`observation`=:observation,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`error_code`=:error_code,`created_at`=:created_at,`started_at`=:started_at,`deadline_at`=:deadline_at,`cancel_requested_at`=:cancel_requested_at,`finished_at`=:finished_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

func (t *sandboxTx) Leases(id uint64) ([]s.Lease, error) {
	out := []s.Lease{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+sandboxLeaseColumns+" FROM sandbox_lease WHERE sandbox_instance_id=? AND released_at IS NULL ORDER BY id FOR UPDATE", id)
	return out, e
}
func (t *sandboxTx) Busy(id uint64, lease *uint64) (bool, error) {
	var busy bool
	q := "SELECT EXISTS(SELECT 1 FROM sandbox_execution WHERE sandbox_instance_id=? AND finished_at IS NULL) OR EXISTS(SELECT 1 FROM sandbox_operation WHERE sandbox_instance_id=? AND finished_at IS NULL)"
	args := []any{id, id}
	if lease != nil {
		q = "SELECT EXISTS(SELECT 1 FROM sandbox_execution WHERE sandbox_instance_id=? AND lease_id=? AND finished_at IS NULL) OR EXISTS(SELECT 1 FROM sandbox_operation WHERE sandbox_instance_id=? AND lease_id=? AND finished_at IS NULL)"
		args = []any{id, *lease, id, *lease}
	}
	e := t.tx.GetContext(t.ctx, &busy, q, args...)
	return busy, e
}
func (t *sandboxTx) PendingExecutions(after uint64, limit int) ([]s.Execution, error) {
	out := []s.Execution{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+sandboxExecutionColumns+" FROM sandbox_execution WHERE finished_at IS NULL ORDER BY (id>?) DESC,id LIMIT ?", after, limit)
	return out, e
}
func (t *sandboxTx) PendingOperations(after uint64, limit int) ([]s.Operation, error) {
	out := []s.Operation{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+sandboxOperationColumns+" FROM sandbox_operation WHERE finished_at IS NULL ORDER BY (id>?) DESC,id LIMIT ?", after, limit)
	return out, e
}
