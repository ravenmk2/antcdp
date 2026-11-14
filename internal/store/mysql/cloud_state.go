package mysql

import (
	"database/sql"
	"errors"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *identityTx) CloudState() a.CloudRepository { return &agentsTx{t.ctx, t.tx} }

const cloudConnectionColumns = "`id`,`endpoint`,`access_mode`,`connect_timeout_seconds`,`operation_timeout_seconds`,`secret_ciphertext`,`secret_format_version`,`secret_key_version`,`secret_revision`,`config_version`,`row_version`,`backend_generation`,`topology_version`,`maintenance_state`,COALESCE(`verified_capabilities`,CAST('null' AS JSON)) AS `verified_capabilities`,COALESCE(`last_diagnostic`,CAST('null' AS JSON)) AS `last_diagnostic`,`last_diagnostic_at`,`updated_by_user_id`,`created_at`,`updated_at`"

func (t *agentsTx) Connection(lock bool) (*a.SandboxConnectionRow, error) {
	q := "SELECT " + cloudConnectionColumns + " FROM sandbox_connection WHERE id=1"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.SandboxConnectionRow{}
	e := t.tx.GetContext(t.ctx, v, q)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) SaveConnection(v *a.SandboxConnectionRow) error {
	_, e := t.named("UPDATE sandbox_connection SET `endpoint`=:endpoint,`access_mode`=:access_mode,`connect_timeout_seconds`=:connect_timeout_seconds,`operation_timeout_seconds`=:operation_timeout_seconds,`secret_ciphertext`=:secret_ciphertext,`secret_format_version`=:secret_format_version,`secret_key_version`=:secret_key_version,`secret_revision`=:secret_revision,`config_version`=:config_version,`row_version`=:row_version,`backend_generation`=:backend_generation,`topology_version`=:topology_version,`maintenance_state`=:maintenance_state,`verified_capabilities`=:verified_capabilities,`last_diagnostic`=:last_diagnostic,`last_diagnostic_at`=:last_diagnostic_at,`updated_by_user_id`=:updated_by_user_id,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const cloudTemplateColumns = "`id`,`agent_id`,`environment`,`config_schema_version`,`config_version`,`row_version`,`updated_by_user_id`,`created_at`,`updated_at`"

func (t *agentsTx) CloudTemplate(agentID *uint64, lock bool) (*a.CloudTemplateRow, error) {
	q := "SELECT " + cloudTemplateColumns + " FROM cloud_computer_template WHERE owner_key=COALESCE(?,0)"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudTemplateRow{}
	e := t.tx.GetContext(t.ctx, v, q, agentID)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) InsertCloudTemplate(v *a.CloudTemplateRow) error {
	r, e := t.named("INSERT INTO cloud_computer_template(`agent_id`,`environment`,`config_schema_version`,`config_version`,`row_version`,`updated_by_user_id`,`created_at`,`updated_at`) VALUES(:agent_id,:environment,:config_schema_version,:config_version,:row_version,:updated_by_user_id,:created_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}

func (t *agentsTx) SaveCloudTemplate(v *a.CloudTemplateRow) error {
	_, e := t.named("UPDATE cloud_computer_template SET `agent_id`=:agent_id,`environment`=:environment,`config_schema_version`=:config_schema_version,`config_version`=:config_version,`row_version`=:row_version,`updated_by_user_id`=:updated_by_user_id,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const computerColumns = "`id`,`owner_user_id`,`pool_agent_id`,`state`,`backend_generation`,`runtime_generation`,`storage_generation`,`runtime_id`,`runtime_creation_token`,`runtime_expires_at`,`volume_id`,`volume_name`,`volume_state`,`volume_cleanup_state`,`applied_template_version`,COALESCE(`effective_environment`,CAST('null' AS JSON)) AS `effective_environment`,COALESCE(`verified_capabilities`,CAST('null' AS JSON)) AS `verified_capabilities`,`idle_since`,`last_activity_at`,`last_observed_at`,`error_code`,`fence_version`,`row_version`,`deleted_at`,`created_at`,`updated_at`"

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
	return v, e
}

func (t *agentsTx) InsertComputer(v *a.CloudComputerRow) error {
	r, e := t.named("INSERT INTO cloud_computer(`owner_user_id`,`pool_agent_id`,`state`,`backend_generation`,`runtime_generation`,`storage_generation`,`runtime_id`,`runtime_creation_token`,`runtime_expires_at`,`volume_id`,`volume_name`,`volume_state`,`volume_cleanup_state`,`applied_template_version`,`effective_environment`,`verified_capabilities`,`idle_since`,`last_activity_at`,`last_observed_at`,`error_code`,`fence_version`,`row_version`,`deleted_at`,`created_at`,`updated_at`) VALUES(:owner_user_id,:pool_agent_id,:state,:backend_generation,:runtime_generation,:storage_generation,:runtime_id,:runtime_creation_token,:runtime_expires_at,:volume_id,:volume_name,:volume_state,:volume_cleanup_state,:applied_template_version,:effective_environment,:verified_capabilities,:idle_since,:last_activity_at,:last_observed_at,:error_code,:fence_version,:row_version,:deleted_at,:created_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}

func (t *agentsTx) SaveComputer(v *a.CloudComputerRow) error {
	_, e := t.named("UPDATE cloud_computer SET `owner_user_id`=:owner_user_id,`pool_agent_id`=:pool_agent_id,`state`=:state,`backend_generation`=:backend_generation,`runtime_generation`=:runtime_generation,`storage_generation`=:storage_generation,`runtime_id`=:runtime_id,`runtime_creation_token`=:runtime_creation_token,`runtime_expires_at`=:runtime_expires_at,`volume_id`=:volume_id,`volume_name`=:volume_name,`volume_state`=:volume_state,`volume_cleanup_state`=:volume_cleanup_state,`applied_template_version`=:applied_template_version,`effective_environment`=:effective_environment,`verified_capabilities`=:verified_capabilities,`idle_since`=:idle_since,`last_activity_at`=:last_activity_at,`last_observed_at`=:last_observed_at,`error_code`=:error_code,`fence_version`=:fence_version,`row_version`=:row_version,`deleted_at`=:deleted_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const leaseColumns = "`root_run_id`,`cloud_computer_id`,`mode`,`state`,`backend_generation`,`runtime_generation`,`storage_generation`,`skill_set_hash`,`executor_epoch`,`fence_version`,`acquired_at`,`lease_expires_at`,`released_at`,`release_reason`,`updated_at`"

func (t *agentsTx) Lease(id uint64, lock bool) (*a.CloudLeaseRow, error) {
	q := "SELECT " + leaseColumns + " FROM cloud_computer_lease WHERE root_run_id=?"
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
	_, e := t.named("INSERT INTO cloud_computer_lease(`root_run_id`,`cloud_computer_id`,`mode`,`state`,`backend_generation`,`runtime_generation`,`storage_generation`,`skill_set_hash`,`executor_epoch`,`fence_version`,`acquired_at`,`lease_expires_at`,`released_at`,`release_reason`,`updated_at`) VALUES(:root_run_id,:cloud_computer_id,:mode,:state,:backend_generation,:runtime_generation,:storage_generation,:skill_set_hash,:executor_epoch,:fence_version,:acquired_at,:lease_expires_at,:released_at,:release_reason,:updated_at)", v)
	return e
}

func (t *agentsTx) SaveLease(v *a.CloudLeaseRow) error {
	_, e := t.named("UPDATE cloud_computer_lease SET `cloud_computer_id`=:cloud_computer_id,`mode`=:mode,`state`=:state,`backend_generation`=:backend_generation,`runtime_generation`=:runtime_generation,`storage_generation`=:storage_generation,`skill_set_hash`=:skill_set_hash,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`acquired_at`=:acquired_at,`lease_expires_at`=:lease_expires_at,`released_at`=:released_at,`release_reason`=:release_reason,`updated_at`=:updated_at WHERE root_run_id=:root_run_id", v)
	return e
}

const skillStateColumns = "`cloud_computer_id`,`agent_id`,`backend_generation`,`storage_generation`,`installed_set_hash`,`installed_manifest`,`state`,`sync_token`,`fence_version`,`row_version`,`updated_at`"

func (t *agentsTx) SkillState(computerID, agentID uint64, lock bool) (*a.CloudSkillStateRow, error) {
	q := "SELECT " + skillStateColumns + " FROM cloud_computer_skill_state WHERE cloud_computer_id=? AND agent_id=?"
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
	_, e := t.named("INSERT INTO cloud_computer_skill_state(`cloud_computer_id`,`agent_id`,`backend_generation`,`storage_generation`,`installed_set_hash`,`installed_manifest`,`state`,`sync_token`,`fence_version`,`row_version`,`updated_at`) VALUES(:cloud_computer_id,:agent_id,:backend_generation,:storage_generation,:installed_set_hash,:installed_manifest,:state,:sync_token,:fence_version,:row_version,:updated_at) ON DUPLICATE KEY UPDATE `backend_generation`=:backend_generation,`storage_generation`=:storage_generation,`installed_set_hash`=:installed_set_hash,`installed_manifest`=:installed_manifest,`state`=:state,`sync_token`=:sync_token,`fence_version`=:fence_version,`row_version`=:row_version,`updated_at`=:updated_at", v)
	return e
}

const cloudExecutionColumns = "`id`,`cloud_computer_id`,`backend_generation`,`runtime_generation`,`root_run_id`,`run_id`,`tool_call_id`,`execution_ordinal`,`execution_token`,`remote_execution_id`,`is_background`,`status`,`command_event_seq`,`cwd`,`execution_spec_hash`,`executor_epoch`,`fence_version`,`exit_code`,`output_cursor`,COALESCE(`last_observation`,CAST('null' AS JSON)) AS `last_observation`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`last_observed_at`,`finished_at`"

func (t *agentsTx) CloudExecution(id uint64, lock bool) (*a.CloudExecutionRow, error) {
	q := "SELECT " + cloudExecutionColumns + " FROM cloud_computer_execution WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CloudExecutionRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}

func (t *agentsTx) InsertCloudExecution(v *a.CloudExecutionRow) error {
	r, e := t.named("INSERT INTO cloud_computer_execution(`cloud_computer_id`,`backend_generation`,`runtime_generation`,`root_run_id`,`run_id`,`tool_call_id`,`execution_ordinal`,`execution_token`,`remote_execution_id`,`is_background`,`status`,`command_event_seq`,`cwd`,`execution_spec_hash`,`executor_epoch`,`fence_version`,`exit_code`,`output_cursor`,`last_observation`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`last_observed_at`,`finished_at`) VALUES(:cloud_computer_id,:backend_generation,:runtime_generation,:root_run_id,:run_id,:tool_call_id,:execution_ordinal,:execution_token,:remote_execution_id,:is_background,:status,:command_event_seq,:cwd,:execution_spec_hash,:executor_epoch,:fence_version,:exit_code,:output_cursor,:last_observation,:error_code,:created_at,:started_at,:deadline_at,:cancel_requested_at,:last_observed_at,:finished_at)", v)
	return modelID(r, e, &v.ID)
}

func (t *agentsTx) SaveCloudExecution(v *a.CloudExecutionRow) error {
	_, e := t.named("UPDATE cloud_computer_execution SET `cloud_computer_id`=:cloud_computer_id,`backend_generation`=:backend_generation,`runtime_generation`=:runtime_generation,`root_run_id`=:root_run_id,`run_id`=:run_id,`tool_call_id`=:tool_call_id,`execution_ordinal`=:execution_ordinal,`execution_token`=:execution_token,`remote_execution_id`=:remote_execution_id,`is_background`=:is_background,`status`=:status,`command_event_seq`=:command_event_seq,`cwd`=:cwd,`execution_spec_hash`=:execution_spec_hash,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`exit_code`=:exit_code,`output_cursor`=:output_cursor,`last_observation`=:last_observation,`error_code`=:error_code,`started_at`=:started_at,`deadline_at`=:deadline_at,`cancel_requested_at`=:cancel_requested_at,`last_observed_at`=:last_observed_at,`finished_at`=:finished_at WHERE id=:id", v)
	return e
}

const cloudOperationColumns = "`id`,`cloud_computer_id`,`root_run_id`,`kind`,`status`,`operation_token`,`command_receipt_id`,`public_operation_id`,`backend_generation`,`runtime_generation`,`storage_generation`,COALESCE(`target_environment`,CAST('null' AS JSON)) AS `target_environment`,`target_template_version`,`intent`,COALESCE(`observation`,CAST('null' AS JSON)) AS `observation`,`actor_kind`,`actor_id`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`finished_at`,`updated_at`"

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
	r, e := t.named("INSERT INTO cloud_computer_operation(`cloud_computer_id`,`root_run_id`,`kind`,`status`,`operation_token`,`command_receipt_id`,`public_operation_id`,`backend_generation`,`runtime_generation`,`storage_generation`,`target_environment`,`target_template_version`,`intent`,`observation`,`actor_kind`,`actor_id`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`started_at`,`deadline_at`,`cancel_requested_at`,`finished_at`,`updated_at`) VALUES(:cloud_computer_id,:root_run_id,:kind,:status,:operation_token,:command_receipt_id,:public_operation_id,:backend_generation,:runtime_generation,:storage_generation,:target_environment,:target_template_version,:intent,:observation,:actor_kind,:actor_id,:executor_epoch,:fence_version,:error_code,:created_at,:started_at,:deadline_at,:cancel_requested_at,:finished_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}

func (t *agentsTx) SaveCloudOperation(v *a.CloudOperationRow) error {
	_, e := t.named("UPDATE cloud_computer_operation SET `cloud_computer_id`=:cloud_computer_id,`root_run_id`=:root_run_id,`kind`=:kind,`status`=:status,`operation_token`=:operation_token,`command_receipt_id`=:command_receipt_id,`public_operation_id`=:public_operation_id,`backend_generation`=:backend_generation,`runtime_generation`=:runtime_generation,`storage_generation`=:storage_generation,`target_environment`=:target_environment,`target_template_version`=:target_template_version,`intent`=:intent,`observation`=:observation,`actor_kind`=:actor_kind,`actor_id`=:actor_id,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`error_code`=:error_code,`started_at`=:started_at,`deadline_at`=:deadline_at,`cancel_requested_at`=:cancel_requested_at,`finished_at`=:finished_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}
