package mysql

import (
	"database/sql"
	"errors"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	sb "github.com/ravenmk2/antcdp/internal/modules/sandboxes"
)

func (t *identityTx) CloudState() a.CloudRepository { return &agentsTx{t.ctx, t.tx} }

const computerColumns = "`id`,`owner_user_id`,`pool_agent_id`,`state`,`backend_generation`,COALESCE(sandbox_instance_id,0) AS sandbox_instance_id,`storage_generation`,`volume_id`,`volume_name`,`volume_state`,`volume_cleanup_state`,`applied_spec_id`,`applied_spec_version`,`idle_since`,`last_activity_at`,`error_code`,`fence_version`,`row_version`,`deleted_at`,`created_at`,`updated_at`"

func (t *agentsTx) hydrateComputer(v *a.CloudComputerRow, lock bool) error {
	if v.InstanceID == 0 {
		return nil
	}
	instance, err := t.Sandbox().Instance(v.InstanceID, lock)
	if err != nil {
		return err
	}
	if instance == nil {
		return errors.New("cloud instance missing")
	}
	v.RuntimeID = instance.RemoteID
	v.RuntimeCreationToken = &instance.CreationToken
	v.RuntimeExpiresAt = instance.ExpiresAt
	v.EffectiveEnvironment = instance.EffectiveConfig
	v.Capabilities = instance.Capabilities
	v.LastObservedAt = instance.LastObservedAt
	return nil
}
func (t *agentsTx) Computer(id uint64, lock bool) (*a.CloudComputerRow, error) {
	q := "SELECT " + computerColumns + " FROM cloud_computer WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudComputerRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e == nil {
		e = t.hydrateComputer(v, lock)
	}
	return v, e
}
func (t *agentsTx) InsertComputer(v *a.CloudComputerRow) error {
	r, e := t.named("INSERT INTO cloud_computer(`owner_user_id`,`pool_agent_id`,`state`,`backend_generation`,`sandbox_instance_id`,`storage_generation`,`volume_id`,`volume_name`,`volume_state`,`volume_cleanup_state`,`applied_spec_id`,`applied_spec_version`,`idle_since`,`last_activity_at`,`error_code`,`fence_version`,`row_version`,`deleted_at`,`created_at`,`updated_at`) VALUES(:owner_user_id,:pool_agent_id,:state,:backend_generation,NULLIF(:sandbox_instance_id,0),:storage_generation,:volume_id,:volume_name,:volume_state,:volume_cleanup_state,:applied_spec_id,:applied_spec_version,:idle_since,:last_activity_at,:error_code,:fence_version,:row_version,:deleted_at,:created_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveComputer(v *a.CloudComputerRow) error {
	if v.InstanceID != 0 {
		instance, e := t.Sandbox().Instance(v.InstanceID, true)
		if e != nil {
			return e
		}
		if instance == nil {
			return errors.New("cloud instance missing")
		}
		instance.RemoteID = v.RuntimeID
		instance.ExpiresAt = v.RuntimeExpiresAt
		instance.LastObservedAt = v.LastObservedAt
		if len(v.EffectiveEnvironment) > 0 && string(v.EffectiveEnvironment) != "null" {
			instance.EffectiveConfig = v.EffectiveEnvironment
		}
		if len(v.Capabilities) > 0 && string(v.Capabilities) != "null" {
			instance.Capabilities = v.Capabilities
		}
		switch v.State {
		case "ready", "paused":
			instance.State = v.State
		case "deleted":
			instance.State = "terminated"
			instance.FinishedAt = v.DeletedAt
		}
		instance.UpdatedAt = v.UpdatedAt
		instance.RowVersion++
		if e = t.Sandbox().SaveInstance(instance); e != nil {
			return e
		}
	}
	_, e := t.named("UPDATE cloud_computer SET `owner_user_id`=:owner_user_id,`pool_agent_id`=:pool_agent_id,`state`=:state,`backend_generation`=:backend_generation,`sandbox_instance_id`=NULLIF(:sandbox_instance_id,0),`storage_generation`=:storage_generation,`volume_id`=:volume_id,`volume_name`=:volume_name,`volume_state`=:volume_state,`volume_cleanup_state`=:volume_cleanup_state,`applied_spec_id`=:applied_spec_id,`applied_spec_version`=:applied_spec_version,`idle_since`=:idle_since,`last_activity_at`=:last_activity_at,`error_code`=:error_code,`fence_version`=:fence_version,`row_version`=:row_version,`deleted_at`=:deleted_at,`created_at`=:created_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const leaseColumns = "`sandbox_lease_id`,`root_run_id`,`cloud_computer_id`,`mode`,`state`,`backend_generation`,`sandbox_instance_id`,`storage_generation`,`skill_set_hash`,`executor_epoch`,`fence_version`,`acquired_at`,`lease_expires_at`,`released_at`,`release_reason`,`updated_at`"

func (t *agentsTx) Lease(id uint64, lock bool) (*a.CloudLeaseRow, error) {
	q := "SELECT " + leaseColumns + " FROM agent_cloud_computer_lease WHERE root_run_id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudLeaseRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) InsertLease(v *a.CloudLeaseRow) error {
	if e := t.syncSandboxLease(v); e != nil {
		return e
	}
	_, e := t.named("INSERT INTO agent_cloud_computer_lease(`sandbox_lease_id`,`root_run_id`,`cloud_computer_id`,`mode`,`state`,`backend_generation`,`sandbox_instance_id`,`storage_generation`,`skill_set_hash`,`executor_epoch`,`fence_version`,`acquired_at`,`lease_expires_at`,`released_at`,`release_reason`,`updated_at`) VALUES(:sandbox_lease_id,:root_run_id,:cloud_computer_id,:mode,:state,:backend_generation,:sandbox_instance_id,:storage_generation,:skill_set_hash,:executor_epoch,:fence_version,:acquired_at,:lease_expires_at,:released_at,:release_reason,:updated_at)", v)
	return e
}

func (t *agentsTx) SaveLease(v *a.CloudLeaseRow) error {
	if e := t.syncSandboxLease(v); e != nil {
		return e
	}
	_, e := t.named("UPDATE agent_cloud_computer_lease SET `sandbox_lease_id`=:sandbox_lease_id,`cloud_computer_id`=:cloud_computer_id,`mode`=:mode,`state`=:state,`backend_generation`=:backend_generation,`sandbox_instance_id`=:sandbox_instance_id,`storage_generation`=:storage_generation,`skill_set_hash`=:skill_set_hash,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`acquired_at`=:acquired_at,`lease_expires_at`=:lease_expires_at,`released_at`=:released_at,`release_reason`=:release_reason,`updated_at`=:updated_at WHERE root_run_id=:root_run_id", v)
	return e
}

const skillStateColumns = "`cloud_computer_id`,`agent_id`,`backend_generation`,`storage_generation`,`installed_set_hash`,`installed_manifest`,`state`,`sync_token`,`fence_version`,`row_version`,`updated_at`"

func (t *agentsTx) SkillState(computerID, agentID uint64, lock bool) (*a.CloudSkillStateRow, error) {
	q := "SELECT " + skillStateColumns + " FROM agent_cloud_computer_skill_state WHERE cloud_computer_id=? AND agent_id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudSkillStateRow{}
	e := t.tx.GetContext(t.ctx, v, q, computerID, agentID)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) SaveSkillState(v *a.CloudSkillStateRow) error {
	_, e := t.named("INSERT INTO agent_cloud_computer_skill_state(`cloud_computer_id`,`agent_id`,`backend_generation`,`storage_generation`,`installed_set_hash`,`installed_manifest`,`state`,`sync_token`,`fence_version`,`row_version`,`updated_at`) VALUES(:cloud_computer_id,:agent_id,:backend_generation,:storage_generation,:installed_set_hash,:installed_manifest,:state,:sync_token,:fence_version,:row_version,:updated_at) ON DUPLICATE KEY UPDATE `backend_generation`=:backend_generation,`storage_generation`=:storage_generation,`installed_set_hash`=:installed_set_hash,`installed_manifest`=:installed_manifest,`state`=:state,`sync_token`=:sync_token,`fence_version`=:fence_version,`row_version`=:row_version,`updated_at`=:updated_at", v)
	return e
}

func cloudPhysicalExecution(v *a.CloudExecutionRow) *sb.Execution {
	return &sb.Execution{ID: v.ID, InstanceID: v.InstanceID, LeaseID: v.SandboxLeaseID, Token: v.ExecutionToken, RemoteID: v.RemoteExecutionID, Background: v.IsBackground, Status: v.Status, CWD: v.CWD, SpecHash: v.ExecutionSpecHash, ExecutorEpoch: v.ExecutorEpoch, FenceVersion: v.FenceVersion, ExitCode: v.ExitCode, OutputCursor: v.OutputCursor, Observation: v.LastObservation, ErrorCode: v.ErrorCode, CreatedAt: v.CreatedAt, StartedAt: v.StartedAt, DeadlineAt: v.DeadlineAt, CancelRequestedAt: v.CancelRequestedAt, LastObservedAt: v.LastObservedAt, FinishedAt: v.FinishedAt}
}
func (t *agentsTx) CloudExecution(id uint64, lock bool) (*a.CloudExecutionRow, error) {
	physical, err := t.Sandbox().Execution(id, lock)
	if err != nil || physical == nil {
		return nil, err
	}
	v := &a.CloudExecutionRow{}
	v.ID = physical.ID
	v.InstanceID = physical.InstanceID
	v.SandboxLeaseID = physical.LeaseID
	v.ExecutionToken = physical.Token
	v.RemoteExecutionID = physical.RemoteID
	v.IsBackground = physical.Background
	v.Status = physical.Status
	v.CWD = physical.CWD
	v.ExecutionSpecHash = physical.SpecHash
	v.ExecutorEpoch = physical.ExecutorEpoch
	v.FenceVersion = physical.FenceVersion
	v.ExitCode = physical.ExitCode
	v.OutputCursor = physical.OutputCursor
	v.LastObservation = physical.Observation
	v.ErrorCode = physical.ErrorCode
	v.CreatedAt = physical.CreatedAt
	v.StartedAt = physical.StartedAt
	v.DeadlineAt = physical.DeadlineAt
	v.CancelRequestedAt = physical.CancelRequestedAt
	v.LastObservedAt = physical.LastObservedAt
	v.FinishedAt = physical.FinishedAt
	err = t.tx.GetContext(t.ctx, v, "SELECT root_run_id,run_id,tool_call_id,execution_ordinal FROM agent_sandbox_execution WHERE sandbox_execution_id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	lease, err := t.Lease(v.RootRunID, false)
	if err != nil {
		return nil, err
	}
	if lease == nil {
		return nil, errors.New("execution binding missing")
	}
	v.ComputerID = lease.ComputerID
	v.BackendGeneration = lease.BackendGeneration
	return v, nil
}
func (t *agentsTx) InsertCloudExecution(v *a.CloudExecutionRow) error {
	lease, err := t.Lease(v.RootRunID, true)
	if err != nil {
		return err
	}
	if lease == nil || lease.SandboxLeaseID == nil {
		return errors.New("sandbox lease missing")
	}
	v.SandboxLeaseID = *lease.SandboxLeaseID
	physical := cloudPhysicalExecution(v)
	if err = t.Sandbox().InsertExecution(physical); err != nil {
		return err
	}
	v.ID = physical.ID
	_, err = t.named("INSERT INTO agent_sandbox_execution(sandbox_execution_id,root_run_id,run_id,tool_call_id,execution_ordinal) VALUES(:id,:root_run_id,:run_id,:tool_call_id,:execution_ordinal)", v)
	return err
}
func (t *agentsTx) SaveCloudExecution(v *a.CloudExecutionRow) error {
	return t.Sandbox().SaveExecution(cloudPhysicalExecution(v))
}

const cloudOperationColumns = "`sandbox_operation_id`,`id`,`cloud_computer_id`,`root_run_id`,`kind`,`status`,`operation_token`,`command_receipt_id`,`backend_generation`,`sandbox_instance_id`,`storage_generation`,COALESCE(`target_environment`,CAST('null' AS JSON)) AS `target_environment`,`target_spec_id`,`target_spec_version`,`intent`,COALESCE(`observation`,CAST('null' AS JSON)) AS `observation`,`actor_kind`,`actor_id`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`finished_at`,`updated_at`"

func (t *agentsTx) CloudOperation(id uint64, lock bool) (*a.CloudOperationRow, error) {
	q := "SELECT " + cloudOperationColumns + " FROM cloud_computer_operation WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudOperationRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) InsertCloudOperation(v *a.CloudOperationRow) error {
	r, e := t.named("INSERT INTO cloud_computer_operation(`cloud_computer_id`,`root_run_id`,`kind`,`status`,`operation_token`,`command_receipt_id`,`backend_generation`,`sandbox_instance_id`,`storage_generation`,`target_environment`,`target_spec_id`,`target_spec_version`,`intent`,`observation`,`actor_kind`,`actor_id`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`finished_at`,`updated_at`) VALUES(:cloud_computer_id,:root_run_id,:kind,:status,:operation_token,:command_receipt_id,:backend_generation,:sandbox_instance_id,:storage_generation,:target_environment,:target_spec_id,:target_spec_version,:intent,:observation,:actor_kind,:actor_id,:executor_epoch,:fence_version,:error_code,:created_at,:started_at,:deadline_at,:cancel_requested_at,:finished_at,:updated_at)", v)
	if e = modelID(r, e, &v.ID); e != nil {
		return e
	}
	return t.insertCloudFileHold(v)
}

func (t *agentsTx) SaveCloudOperation(v *a.CloudOperationRow) error {
	if e := t.saveCloudFileHold(v); e != nil {
		return e
	}
	_, e := t.named("UPDATE cloud_computer_operation SET `cloud_computer_id`=:cloud_computer_id,`root_run_id`=:root_run_id,`kind`=:kind,`status`=:status,`operation_token`=:operation_token,`command_receipt_id`=:command_receipt_id,`backend_generation`=:backend_generation,`sandbox_instance_id`=:sandbox_instance_id,`storage_generation`=:storage_generation,`target_environment`=:target_environment,`target_spec_id`=:target_spec_id,`target_spec_version`=:target_spec_version,`intent`=:intent,`observation`=:observation,`actor_kind`=:actor_kind,`actor_id`=:actor_id,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`error_code`=:error_code,`started_at`=:started_at,`deadline_at`=:deadline_at,`cancel_requested_at`=:cancel_requested_at,`finished_at`=:finished_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}
