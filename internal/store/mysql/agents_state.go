package mysql

import (
	"database/sql"
	"errors"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *identityTx) AgentState() a.StateRepository { return &agentsTx{t.ctx, t.tx} }

const agentSessionColumns = "`id`,`agent_id`,`agent_type`,`session_kind`,`root_session_id`,`parent_run_id`,`executor_user_id`,`title`,`project_context_id`,`cloud_computer_id`,`selected_model_binding_id`,`selected_thinking_option_key`,COALESCE(`locked_model_config`,CAST('null' AS JSON)) AS `locked_model_config`,`model_selection_hash`,`model_locked_at`,`queue_paused`,`next_input_order`,`last_seq`,`projection_seq`,`active_run_id`,`active_compaction_id`,`surface_revision`,`row_version`,`created_by_actor_kind`,`created_by_actor_id`,`created_at`,`updated_at`,`last_activity_at`,`archived_at`,`archived_by_user_id`"

func (t *agentsTx) Session(id uint64, lock bool) (*a.SessionRow, error) {
	q := "SELECT " + agentSessionColumns + " FROM agent_session WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.SessionRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertSession(v *a.SessionRow) error {
	r, e := t.named("INSERT INTO agent_session(`agent_id`,`agent_type`,`session_kind`,`root_session_id`,`parent_run_id`,`executor_user_id`,`title`,`project_context_id`,`cloud_computer_id`,`selected_model_binding_id`,`selected_thinking_option_key`,`locked_model_config`,`model_selection_hash`,`model_locked_at`,`queue_paused`,`next_input_order`,`last_seq`,`projection_seq`,`active_run_id`,`active_compaction_id`,`surface_revision`,`row_version`,`created_by_actor_kind`,`created_by_actor_id`,`created_at`,`updated_at`,`last_activity_at`,`archived_at`,`archived_by_user_id`) VALUES(:agent_id,:agent_type,:session_kind,:root_session_id,:parent_run_id,:executor_user_id,:title,:project_context_id,:cloud_computer_id,:selected_model_binding_id,:selected_thinking_option_key,:locked_model_config,:model_selection_hash,:model_locked_at,:queue_paused,:next_input_order,:last_seq,:projection_seq,:active_run_id,:active_compaction_id,:surface_revision,:row_version,:created_by_actor_kind,:created_by_actor_id,:created_at,:updated_at,:last_activity_at,:archived_at,:archived_by_user_id)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveSession(v *a.SessionRow) error {
	_, e := t.named("UPDATE agent_session SET `agent_id`=:agent_id,`agent_type`=:agent_type,`session_kind`=:session_kind,`root_session_id`=:root_session_id,`parent_run_id`=:parent_run_id,`executor_user_id`=:executor_user_id,`title`=:title,`project_context_id`=:project_context_id,`cloud_computer_id`=:cloud_computer_id,`selected_model_binding_id`=:selected_model_binding_id,`selected_thinking_option_key`=:selected_thinking_option_key,`locked_model_config`=:locked_model_config,`model_selection_hash`=:model_selection_hash,`model_locked_at`=:model_locked_at,`queue_paused`=:queue_paused,`next_input_order`=:next_input_order,`last_seq`=:last_seq,`projection_seq`=:projection_seq,`active_run_id`=:active_run_id,`active_compaction_id`=:active_compaction_id,`surface_revision`=:surface_revision,`row_version`=:row_version,`created_by_actor_kind`=:created_by_actor_kind,`created_by_actor_id`=:created_by_actor_id,`created_at`=:created_at,`updated_at`=:updated_at,`last_activity_at`=:last_activity_at,`archived_at`=:archived_at,`archived_by_user_id`=:archived_by_user_id WHERE id=:id", v)
	return e
}

const agentInputColumns = "`id`,`session_id`,`command_receipt_id`,`input_kind`,`origin_kind`,`actor_kind`,`actor_id`,`source_kind`,`source_id`,`last_modified_by_kind`,`last_modified_by_id`,`status`,`queue_order`,`claimed_run_id`,`claimed_step_no`,`question_interaction_id`,`pending_question_slot`,`retry_of_run_id`,`continuation_seq`,`accepted_seq`,`current_content_seq`,`message_seq`,`content_revision`,`row_version`,`created_at`,`updated_at`,`queue_deadline_at`,`claimed_at`,`ended_at`,`end_reason`"

func (t *agentsTx) Input(id uint64, lock bool) (*a.InputRow, error) {
	q := "SELECT " + agentInputColumns + " FROM agent_input WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.InputRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertInput(v *a.InputRow) error {
	r, e := t.named("INSERT INTO agent_input(`session_id`,`command_receipt_id`,`input_kind`,`origin_kind`,`actor_kind`,`actor_id`,`source_kind`,`source_id`,`last_modified_by_kind`,`last_modified_by_id`,`status`,`queue_order`,`claimed_run_id`,`claimed_step_no`,`question_interaction_id`,`retry_of_run_id`,`continuation_seq`,`accepted_seq`,`current_content_seq`,`message_seq`,`content_revision`,`row_version`,`created_at`,`updated_at`,`queue_deadline_at`,`claimed_at`,`ended_at`,`end_reason`) VALUES(:session_id,:command_receipt_id,:input_kind,:origin_kind,:actor_kind,:actor_id,:source_kind,:source_id,:last_modified_by_kind,:last_modified_by_id,:status,:queue_order,:claimed_run_id,:claimed_step_no,:question_interaction_id,:retry_of_run_id,:continuation_seq,:accepted_seq,:current_content_seq,:message_seq,:content_revision,:row_version,:created_at,:updated_at,:queue_deadline_at,:claimed_at,:ended_at,:end_reason)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveInput(v *a.InputRow) error {
	_, e := t.named("UPDATE agent_input SET `session_id`=:session_id,`command_receipt_id`=:command_receipt_id,`input_kind`=:input_kind,`origin_kind`=:origin_kind,`actor_kind`=:actor_kind,`actor_id`=:actor_id,`source_kind`=:source_kind,`source_id`=:source_id,`last_modified_by_kind`=:last_modified_by_kind,`last_modified_by_id`=:last_modified_by_id,`status`=:status,`queue_order`=:queue_order,`claimed_run_id`=:claimed_run_id,`claimed_step_no`=:claimed_step_no,`question_interaction_id`=:question_interaction_id,`retry_of_run_id`=:retry_of_run_id,`continuation_seq`=:continuation_seq,`accepted_seq`=:accepted_seq,`current_content_seq`=:current_content_seq,`message_seq`=:message_seq,`content_revision`=:content_revision,`row_version`=:row_version,`created_at`=:created_at,`updated_at`=:updated_at,`queue_deadline_at`=:queue_deadline_at,`claimed_at`=:claimed_at,`ended_at`=:ended_at,`end_reason`=:end_reason WHERE id=:id", v)
	return e
}

const agentRunColumns = "`id`,`session_id`,`root_run_id`,`parent_run_id`,`trigger_input_id`,`retry_of_run_id`,`executor_user_id`,`origin_kind`,`actor_kind`,`actor_id`,`source_kind`,`source_id`,`status`,`active_slot`,`agent_config_version`,`resource_config_version`,`execution_policy_snapshot`,`model_selection_hash`,`budget_limit`,`budget_reserved`,`budget_used`,`budget_revision`,`current_step_no`,`executor_epoch`,`fence_version`,`started_seq`,`ended_seq`,`continuation_seq`,`end_reason`,`usage_completeness`,`created_at`,`started_at`,`deadline_at`,`stop_requested_at`,`stop_actor_kind`,`stop_actor_id`,`stop_deadline_at`,`finished_at`,`settled_at`,`updated_at`,`projection_seq`"

func (t *agentsTx) Run(id uint64, lock bool) (*a.RunRow, error) {
	q := "SELECT " + agentRunColumns + " FROM agent_run WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.RunRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertRun(v *a.RunRow) error {
	r, e := t.named("INSERT INTO agent_run(`session_id`,`root_run_id`,`parent_run_id`,`trigger_input_id`,`retry_of_run_id`,`executor_user_id`,`origin_kind`,`actor_kind`,`actor_id`,`source_kind`,`source_id`,`status`,`agent_config_version`,`resource_config_version`,`execution_policy_snapshot`,`model_selection_hash`,`budget_limit`,`budget_reserved`,`budget_used`,`budget_revision`,`current_step_no`,`executor_epoch`,`fence_version`,`started_seq`,`ended_seq`,`continuation_seq`,`end_reason`,`usage_completeness`,`created_at`,`started_at`,`deadline_at`,`stop_requested_at`,`stop_actor_kind`,`stop_actor_id`,`stop_deadline_at`,`finished_at`,`settled_at`,`updated_at`,`projection_seq`) VALUES(:session_id,:root_run_id,:parent_run_id,:trigger_input_id,:retry_of_run_id,:executor_user_id,:origin_kind,:actor_kind,:actor_id,:source_kind,:source_id,:status,:agent_config_version,:resource_config_version,:execution_policy_snapshot,:model_selection_hash,:budget_limit,:budget_reserved,:budget_used,:budget_revision,:current_step_no,:executor_epoch,:fence_version,:started_seq,:ended_seq,:continuation_seq,:end_reason,:usage_completeness,:created_at,:started_at,:deadline_at,:stop_requested_at,:stop_actor_kind,:stop_actor_id,:stop_deadline_at,:finished_at,:settled_at,:updated_at,:projection_seq)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveRun(v *a.RunRow) error {
	_, e := t.named("UPDATE agent_run SET `session_id`=:session_id,`root_run_id`=:root_run_id,`parent_run_id`=:parent_run_id,`trigger_input_id`=:trigger_input_id,`retry_of_run_id`=:retry_of_run_id,`executor_user_id`=:executor_user_id,`origin_kind`=:origin_kind,`actor_kind`=:actor_kind,`actor_id`=:actor_id,`source_kind`=:source_kind,`source_id`=:source_id,`status`=:status,`agent_config_version`=:agent_config_version,`resource_config_version`=:resource_config_version,`execution_policy_snapshot`=:execution_policy_snapshot,`model_selection_hash`=:model_selection_hash,`budget_limit`=:budget_limit,`budget_reserved`=:budget_reserved,`budget_used`=:budget_used,`budget_revision`=:budget_revision,`current_step_no`=:current_step_no,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`started_seq`=:started_seq,`ended_seq`=:ended_seq,`continuation_seq`=:continuation_seq,`end_reason`=:end_reason,`usage_completeness`=:usage_completeness,`created_at`=:created_at,`started_at`=:started_at,`deadline_at`=:deadline_at,`stop_requested_at`=:stop_requested_at,`stop_actor_kind`=:stop_actor_kind,`stop_actor_id`=:stop_actor_id,`stop_deadline_at`=:stop_deadline_at,`finished_at`=:finished_at,`settled_at`=:settled_at,`updated_at`=:updated_at,`projection_seq`=:projection_seq WHERE id=:id", v)
	return e
}

const agentEventColumns = "`id`,`session_id`,`seq`,`run_id`,`event_type`,`schema_version`,`semantic_key`,`payload`,`payload_sha256`,`payload_size_bytes`,`occurred_at`"

func (t *agentsTx) Event(id uint64, lock bool) (*a.EventRow, error) {
	q := "SELECT " + agentEventColumns + " FROM agent_event WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.EventRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertEvent(v *a.EventRow) error {
	r, e := t.named("INSERT INTO agent_event(`session_id`,`seq`,`run_id`,`event_type`,`schema_version`,`semantic_key`,`payload`,`payload_sha256`,`payload_size_bytes`,`occurred_at`) VALUES(:session_id,:seq,:run_id,:event_type,:schema_version,:semantic_key,:payload,:payload_sha256,:payload_size_bytes,:occurred_at)", v)
	return modelID(r, e, &v.ID)
}

const agentModelCallColumns = "`id`,`session_id`,`run_id`,`root_run_id`,`compaction_id`,`step_no`,`attempt_no`,`purpose`,`generation_slot`,`status`,`provider_id`,`model_definition_id`,`protocol`,`requested_model_id`,`response_model_id`,`thinking`,`request_config`,`surface_manifest`,`request_hash`,`capability_snapshot`,COALESCE(`budget_reservation`,CAST('null' AS JSON)) AS `budget_reservation`,COALESCE(`budget_settlement`,CAST('null' AS JSON)) AS `budget_settlement`,`provider_request_id`,`executor_epoch`,`fence_version`,`response_event_seq`,`input_tokens`,`output_tokens`,`cache_read_tokens`,`cache_write_tokens`,COALESCE(`usage_raw`,CAST('null' AS JSON)) AS `usage_raw`,`usage_semantics_version`,`usage_completeness`,`estimated_cost`,`cost_currency`,COALESCE(`pricing_snapshot`,CAST('null' AS JSON)) AS `pricing_snapshot`,`error_code`,`created_at`,`started_at`,`deadline_at`,`finished_at`"

func (t *agentsTx) ModelCall(id uint64, lock bool) (*a.ModelCallRow, error) {
	q := "SELECT " + agentModelCallColumns + " FROM agent_model_call WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.ModelCallRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertModelCall(v *a.ModelCallRow) error {
	r, e := t.named("INSERT INTO agent_model_call(`session_id`,`run_id`,`root_run_id`,`compaction_id`,`step_no`,`attempt_no`,`purpose`,`status`,`provider_id`,`model_definition_id`,`protocol`,`requested_model_id`,`response_model_id`,`thinking`,`request_config`,`surface_manifest`,`request_hash`,`capability_snapshot`,`budget_reservation`,`budget_settlement`,`provider_request_id`,`executor_epoch`,`fence_version`,`response_event_seq`,`input_tokens`,`output_tokens`,`cache_read_tokens`,`cache_write_tokens`,`usage_raw`,`usage_semantics_version`,`usage_completeness`,`estimated_cost`,`cost_currency`,`pricing_snapshot`,`error_code`,`created_at`,`started_at`,`deadline_at`,`finished_at`) VALUES(:session_id,:run_id,:root_run_id,:compaction_id,:step_no,:attempt_no,:purpose,:status,:provider_id,:model_definition_id,:protocol,:requested_model_id,:response_model_id,:thinking,:request_config,:surface_manifest,:request_hash,:capability_snapshot,:budget_reservation,:budget_settlement,:provider_request_id,:executor_epoch,:fence_version,:response_event_seq,:input_tokens,:output_tokens,:cache_read_tokens,:cache_write_tokens,:usage_raw,:usage_semantics_version,:usage_completeness,:estimated_cost,:cost_currency,:pricing_snapshot,:error_code,:created_at,:started_at,:deadline_at,:finished_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveModelCall(v *a.ModelCallRow) error {
	_, e := t.named("UPDATE agent_model_call SET `session_id`=:session_id,`run_id`=:run_id,`root_run_id`=:root_run_id,`compaction_id`=:compaction_id,`step_no`=:step_no,`attempt_no`=:attempt_no,`purpose`=:purpose,`status`=:status,`provider_id`=:provider_id,`model_definition_id`=:model_definition_id,`protocol`=:protocol,`requested_model_id`=:requested_model_id,`response_model_id`=:response_model_id,`thinking`=:thinking,`request_config`=:request_config,`surface_manifest`=:surface_manifest,`request_hash`=:request_hash,`capability_snapshot`=:capability_snapshot,`budget_reservation`=:budget_reservation,`budget_settlement`=:budget_settlement,`provider_request_id`=:provider_request_id,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`response_event_seq`=:response_event_seq,`input_tokens`=:input_tokens,`output_tokens`=:output_tokens,`cache_read_tokens`=:cache_read_tokens,`cache_write_tokens`=:cache_write_tokens,`usage_raw`=:usage_raw,`usage_semantics_version`=:usage_semantics_version,`usage_completeness`=:usage_completeness,`estimated_cost`=:estimated_cost,`cost_currency`=:cost_currency,`pricing_snapshot`=:pricing_snapshot,`error_code`=:error_code,`created_at`=:created_at,`started_at`=:started_at,`deadline_at`=:deadline_at,`finished_at`=:finished_at WHERE id=:id", v)
	return e
}

const agentToolCallColumns = "`id`,`session_id`,`run_id`,`root_run_id`,`model_call_id`,`step_no`,`call_ordinal`,`provider_call_id`,`tool_key`,`tool_binding_id`,`mcp_binding_id`,`mcp_server_id`,`mcp_tool_name`,`skill_version_id`,`execution_class`,`status`,`arguments_event_seq`,`arguments_hash`,`tool_definition_snapshot`,`budget_reservation`,COALESCE(`budget_settlement`,CAST('null' AS JSON)) AS `budget_settlement`,`authorization_snapshot`,`agent_config_version`,`resource_config_version`,`interaction_id`,`dispatch_token`,COALESCE(`execution_ref`,CAST('null' AS JSON)) AS `execution_ref`,COALESCE(`remote_identity_ref`,CAST('null' AS JSON)) AS `remote_identity_ref`,`executor_epoch`,`fence_version`,`result_event_seq`,`error_code`,`executed`,`reconciled_outcome`,`last_reconciled_seq`,`created_at`,`deadline_at`,`dispatch_started_at`,`started_at`,`finished_at`,`updated_at`"

func (t *agentsTx) ToolCall(id uint64, lock bool) (*a.ToolCallRow, error) {
	q := "SELECT " + agentToolCallColumns + " FROM agent_tool_call WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.ToolCallRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertToolCall(v *a.ToolCallRow) error {
	r, e := t.named("INSERT INTO agent_tool_call(`session_id`,`run_id`,`root_run_id`,`model_call_id`,`step_no`,`call_ordinal`,`provider_call_id`,`tool_key`,`tool_binding_id`,`mcp_binding_id`,`mcp_server_id`,`mcp_tool_name`,`skill_version_id`,`execution_class`,`status`,`arguments_event_seq`,`arguments_hash`,`tool_definition_snapshot`,`budget_reservation`,`budget_settlement`,`authorization_snapshot`,`agent_config_version`,`resource_config_version`,`interaction_id`,`dispatch_token`,`execution_ref`,`remote_identity_ref`,`executor_epoch`,`fence_version`,`result_event_seq`,`error_code`,`executed`,`reconciled_outcome`,`last_reconciled_seq`,`created_at`,`deadline_at`,`dispatch_started_at`,`started_at`,`finished_at`,`updated_at`) VALUES(:session_id,:run_id,:root_run_id,:model_call_id,:step_no,:call_ordinal,:provider_call_id,:tool_key,:tool_binding_id,:mcp_binding_id,:mcp_server_id,:mcp_tool_name,:skill_version_id,:execution_class,:status,:arguments_event_seq,:arguments_hash,:tool_definition_snapshot,:budget_reservation,:budget_settlement,:authorization_snapshot,:agent_config_version,:resource_config_version,:interaction_id,:dispatch_token,:execution_ref,:remote_identity_ref,:executor_epoch,:fence_version,:result_event_seq,:error_code,:executed,:reconciled_outcome,:last_reconciled_seq,:created_at,:deadline_at,:dispatch_started_at,:started_at,:finished_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveToolCall(v *a.ToolCallRow) error {
	_, e := t.named("UPDATE agent_tool_call SET `session_id`=:session_id,`run_id`=:run_id,`root_run_id`=:root_run_id,`model_call_id`=:model_call_id,`step_no`=:step_no,`call_ordinal`=:call_ordinal,`provider_call_id`=:provider_call_id,`tool_key`=:tool_key,`tool_binding_id`=:tool_binding_id,`mcp_binding_id`=:mcp_binding_id,`mcp_server_id`=:mcp_server_id,`mcp_tool_name`=:mcp_tool_name,`skill_version_id`=:skill_version_id,`execution_class`=:execution_class,`status`=:status,`arguments_event_seq`=:arguments_event_seq,`arguments_hash`=:arguments_hash,`tool_definition_snapshot`=:tool_definition_snapshot,`budget_reservation`=:budget_reservation,`budget_settlement`=:budget_settlement,`authorization_snapshot`=:authorization_snapshot,`agent_config_version`=:agent_config_version,`resource_config_version`=:resource_config_version,`interaction_id`=:interaction_id,`dispatch_token`=:dispatch_token,`execution_ref`=:execution_ref,`remote_identity_ref`=:remote_identity_ref,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`result_event_seq`=:result_event_seq,`error_code`=:error_code,`executed`=:executed,`reconciled_outcome`=:reconciled_outcome,`last_reconciled_seq`=:last_reconciled_seq,`created_at`=:created_at,`deadline_at`=:deadline_at,`dispatch_started_at`=:dispatch_started_at,`started_at`=:started_at,`finished_at`=:finished_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const agentInteractionColumns = "`id`,`session_id`,`run_id`,`origin_child_run_id`,`tool_call_id`,`kind`,`status`,`request_event_seq`,`request_hash`,`specification`,`wait_deadline_at`,`pending_reply_input_id`,`answer_event_seq`,`decided_by_kind`,`decided_by_id`,`decided_at`,`approval_consumed_at`,`continue_reason`,`row_version`,`created_at`,`updated_at`,`projection_seq`"

func (t *agentsTx) Interaction(id uint64, lock bool) (*a.InteractionRow, error) {
	q := "SELECT " + agentInteractionColumns + " FROM agent_interaction WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.InteractionRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertInteraction(v *a.InteractionRow) error {
	r, e := t.named("INSERT INTO agent_interaction(`session_id`,`run_id`,`origin_child_run_id`,`tool_call_id`,`kind`,`status`,`request_event_seq`,`request_hash`,`specification`,`wait_deadline_at`,`pending_reply_input_id`,`answer_event_seq`,`decided_by_kind`,`decided_by_id`,`decided_at`,`approval_consumed_at`,`continue_reason`,`row_version`,`created_at`,`updated_at`,`projection_seq`) VALUES(:session_id,:run_id,:origin_child_run_id,:tool_call_id,:kind,:status,:request_event_seq,:request_hash,:specification,:wait_deadline_at,:pending_reply_input_id,:answer_event_seq,:decided_by_kind,:decided_by_id,:decided_at,:approval_consumed_at,:continue_reason,:row_version,:created_at,:updated_at,:projection_seq)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveInteraction(v *a.InteractionRow) error {
	_, e := t.named("UPDATE agent_interaction SET `session_id`=:session_id,`run_id`=:run_id,`origin_child_run_id`=:origin_child_run_id,`tool_call_id`=:tool_call_id,`kind`=:kind,`status`=:status,`request_event_seq`=:request_event_seq,`request_hash`=:request_hash,`specification`=:specification,`wait_deadline_at`=:wait_deadline_at,`pending_reply_input_id`=:pending_reply_input_id,`answer_event_seq`=:answer_event_seq,`decided_by_kind`=:decided_by_kind,`decided_by_id`=:decided_by_id,`decided_at`=:decided_at,`approval_consumed_at`=:approval_consumed_at,`continue_reason`=:continue_reason,`row_version`=:row_version,`created_at`=:created_at,`updated_at`=:updated_at,`projection_seq`=:projection_seq WHERE id=:id", v)
	return e
}

const agentCompactionColumns = "`id`,`session_id`,`run_id`,`command_receipt_id`,`public_operation_id`,`status`,`from_seq`,`through_seq`,`source_surface_revision`,`source_manifest`,`source_hash`,`start_event_seq`,`summary_event_seq`,`end_event_seq`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`deadline_at`,`finished_at`"

func (t *agentsTx) Compaction(id uint64, lock bool) (*a.CompactionRow, error) {
	q := "SELECT " + agentCompactionColumns + " FROM agent_compaction WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.CompactionRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertCompaction(v *a.CompactionRow) error {
	r, e := t.named("INSERT INTO agent_compaction(`session_id`,`run_id`,`command_receipt_id`,`public_operation_id`,`status`,`from_seq`,`through_seq`,`source_surface_revision`,`source_manifest`,`source_hash`,`start_event_seq`,`summary_event_seq`,`end_event_seq`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`deadline_at`,`finished_at`) VALUES(:session_id,:run_id,:command_receipt_id,:public_operation_id,:status,:from_seq,:through_seq,:source_surface_revision,:source_manifest,:source_hash,:start_event_seq,:summary_event_seq,:end_event_seq,:executor_epoch,:fence_version,:error_code,:created_at,:deadline_at,:finished_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveCompaction(v *a.CompactionRow) error {
	_, e := t.named("UPDATE agent_compaction SET `session_id`=:session_id,`run_id`=:run_id,`command_receipt_id`=:command_receipt_id,`public_operation_id`=:public_operation_id,`status`=:status,`from_seq`=:from_seq,`through_seq`=:through_seq,`source_surface_revision`=:source_surface_revision,`source_manifest`=:source_manifest,`source_hash`=:source_hash,`start_event_seq`=:start_event_seq,`summary_event_seq`=:summary_event_seq,`end_event_seq`=:end_event_seq,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`error_code`=:error_code,`created_at`=:created_at,`deadline_at`=:deadline_at,`finished_at`=:finished_at WHERE id=:id", v)
	return e
}

const agentFileColumns = "`id`,`purpose`,`content_domain`,`content_session_id`,`owner_user_id`,`agent_id`,`storage_key`,`writer_token`,`state`,`integrity_state`,`size_bytes`,`sha256`,`media_type`,COALESCE(`media_properties`,CAST('null' AS JSON)) AS `media_properties`,`uploaded_by_user_id`,`created_by_tool_call_id`,`upload_operation_id`,`created_at`,`updated_at`,`expires_at`,`bound_at`,`orphaned_at`,`integrity_checked_at`,`deleted_at`,`error_code`"

func (t *agentsTx) File(id uint64, lock bool) (*a.FileRow, error) {
	q := "SELECT " + agentFileColumns + " FROM agent_file WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.FileRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertFile(v *a.FileRow) error {
	r, e := t.named("INSERT INTO agent_file(`purpose`,`content_domain`,`content_session_id`,`owner_user_id`,`agent_id`,`storage_key`,`writer_token`,`state`,`integrity_state`,`size_bytes`,`sha256`,`media_type`,`media_properties`,`uploaded_by_user_id`,`created_by_tool_call_id`,`upload_operation_id`,`created_at`,`updated_at`,`expires_at`,`bound_at`,`orphaned_at`,`integrity_checked_at`,`deleted_at`,`error_code`) VALUES(:purpose,:content_domain,:content_session_id,:owner_user_id,:agent_id,:storage_key,:writer_token,:state,:integrity_state,:size_bytes,:sha256,:media_type,:media_properties,:uploaded_by_user_id,:created_by_tool_call_id,:upload_operation_id,:created_at,:updated_at,:expires_at,:bound_at,:orphaned_at,:integrity_checked_at,:deleted_at,:error_code)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveFile(v *a.FileRow) error {
	_, e := t.named("UPDATE agent_file SET `purpose`=:purpose,`content_domain`=:content_domain,`content_session_id`=:content_session_id,`owner_user_id`=:owner_user_id,`agent_id`=:agent_id,`storage_key`=:storage_key,`writer_token`=:writer_token,`state`=:state,`integrity_state`=:integrity_state,`size_bytes`=:size_bytes,`sha256`=:sha256,`media_type`=:media_type,`media_properties`=:media_properties,`uploaded_by_user_id`=:uploaded_by_user_id,`created_by_tool_call_id`=:created_by_tool_call_id,`upload_operation_id`=:upload_operation_id,`created_at`=:created_at,`updated_at`=:updated_at,`expires_at`=:expires_at,`bound_at`=:bound_at,`orphaned_at`=:orphaned_at,`integrity_checked_at`=:integrity_checked_at,`deleted_at`=:deleted_at,`error_code`=:error_code WHERE id=:id", v)
	return e
}

const agentAttachmentColumns = "`id`,`content_session_id`,`file_id`,`uploaded_by_user_id`,`filename`,`state`,`bound_input_id`,`command_receipt_id`,`row_version`,`created_at`,`expires_at`,`bound_at`,`deleted_at`"

func (t *agentsTx) Attachment(id uint64, lock bool) (*a.AttachmentRow, error) {
	q := "SELECT " + agentAttachmentColumns + " FROM agent_attachment WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.AttachmentRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertAttachment(v *a.AttachmentRow) error {
	r, e := t.named("INSERT INTO agent_attachment(`content_session_id`,`file_id`,`uploaded_by_user_id`,`filename`,`state`,`bound_input_id`,`command_receipt_id`,`row_version`,`created_at`,`expires_at`,`bound_at`,`deleted_at`) VALUES(:content_session_id,:file_id,:uploaded_by_user_id,:filename,:state,:bound_input_id,:command_receipt_id,:row_version,:created_at,:expires_at,:bound_at,:deleted_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveAttachment(v *a.AttachmentRow) error {
	_, e := t.named("UPDATE agent_attachment SET `content_session_id`=:content_session_id,`file_id`=:file_id,`uploaded_by_user_id`=:uploaded_by_user_id,`filename`=:filename,`state`=:state,`bound_input_id`=:bound_input_id,`command_receipt_id`=:command_receipt_id,`row_version`=:row_version,`created_at`=:created_at,`expires_at`=:expires_at,`bound_at`=:bound_at,`deleted_at`=:deleted_at WHERE id=:id", v)
	return e
}

const agentArtifactColumns = "`id`,`content_session_id`,`run_id`,`tool_call_id`,`output_ordinal`,`file_id`,`filename`,`description`,`source_path`,`source_snapshot`,`retained_event_seq`,`row_version`,`created_at`,`deleted_at`,`deleted_by_user_id`,`deleted_event_seq`"

func (t *agentsTx) Artifact(id uint64, lock bool) (*a.ArtifactRow, error) {
	q := "SELECT " + agentArtifactColumns + " FROM agent_artifact WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.ArtifactRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertArtifact(v *a.ArtifactRow) error {
	r, e := t.named("INSERT INTO agent_artifact(`content_session_id`,`run_id`,`tool_call_id`,`output_ordinal`,`file_id`,`filename`,`description`,`source_path`,`source_snapshot`,`retained_event_seq`,`row_version`,`created_at`,`deleted_at`,`deleted_by_user_id`,`deleted_event_seq`) VALUES(:content_session_id,:run_id,:tool_call_id,:output_ordinal,:file_id,:filename,:description,:source_path,:source_snapshot,:retained_event_seq,:row_version,:created_at,:deleted_at,:deleted_by_user_id,:deleted_event_seq)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveArtifact(v *a.ArtifactRow) error {
	_, e := t.named("UPDATE agent_artifact SET `content_session_id`=:content_session_id,`run_id`=:run_id,`tool_call_id`=:tool_call_id,`output_ordinal`=:output_ordinal,`file_id`=:file_id,`filename`=:filename,`description`=:description,`source_path`=:source_path,`source_snapshot`=:source_snapshot,`retained_event_seq`=:retained_event_seq,`row_version`=:row_version,`created_at`=:created_at,`deleted_at`=:deleted_at,`deleted_by_user_id`=:deleted_by_user_id,`deleted_event_seq`=:deleted_event_seq WHERE id=:id", v)
	return e
}

const agentFileOperationColumns = "`id`,`tool_call_id`,`content_session_id`,`root_run_id`,`kind`,`operation_token`,`status`,`binding_id`,`cloud_computer_id`,`binding_fence_version`,`backend_generation`,`runtime_generation`,`storage_generation`,`volume_id`,`executor_epoch`,`fence_version`,`request_hash`,COALESCE(`result`,CAST('null' AS JSON)) AS `result`,COALESCE(`commit_receipt`,CAST('null' AS JSON)) AS `commit_receipt`,`committed_from_seq`,`committed_through_seq`,`error_code`,`created_at`,`deadline_at`,`finished_at`,`updated_at`"

func (t *agentsTx) FileOperation(id uint64, lock bool) (*a.FileOperationRow, error) {
	q := "SELECT " + agentFileOperationColumns + " FROM agent_file_operation WHERE id=?"
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
func (t *agentsTx) InsertFileOperation(v *a.FileOperationRow) error {
	r, e := t.named("INSERT INTO agent_file_operation(`tool_call_id`,`content_session_id`,`root_run_id`,`kind`,`operation_token`,`status`,`binding_id`,`cloud_computer_id`,`binding_fence_version`,`backend_generation`,`runtime_generation`,`storage_generation`,`volume_id`,`executor_epoch`,`fence_version`,`request_hash`,`result`,`commit_receipt`,`committed_from_seq`,`committed_through_seq`,`error_code`,`created_at`,`deadline_at`,`finished_at`,`updated_at`) VALUES(:tool_call_id,:content_session_id,:root_run_id,:kind,:operation_token,:status,:binding_id,:cloud_computer_id,:binding_fence_version,:backend_generation,:runtime_generation,:storage_generation,:volume_id,:executor_epoch,:fence_version,:request_hash,:result,:commit_receipt,:committed_from_seq,:committed_through_seq,:error_code,:created_at,:deadline_at,:finished_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveFileOperation(v *a.FileOperationRow) error {
	_, e := t.named("UPDATE agent_file_operation SET `tool_call_id`=:tool_call_id,`content_session_id`=:content_session_id,`root_run_id`=:root_run_id,`kind`=:kind,`operation_token`=:operation_token,`status`=:status,`binding_id`=:binding_id,`cloud_computer_id`=:cloud_computer_id,`binding_fence_version`=:binding_fence_version,`backend_generation`=:backend_generation,`runtime_generation`=:runtime_generation,`storage_generation`=:storage_generation,`volume_id`=:volume_id,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`request_hash`=:request_hash,`result`=:result,`commit_receipt`=:commit_receipt,`committed_from_seq`=:committed_from_seq,`committed_through_seq`=:committed_through_seq,`error_code`=:error_code,`created_at`=:created_at,`deadline_at`=:deadline_at,`finished_at`=:finished_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}

const agentFileOperationItemColumns = "`operation_id`,`ordinal`,`source_kind`,`source_reference_id`,`source_file_id`,`source_path`,`destination_path`,`publication_token`,`expected_sha256`,`observed_sha256`,`observed_size_bytes`,`staged_file_id`,`artifact_id`,`state`,`verified_at`,`published_at`,`error_code`"

func (t *agentsTx) FileOperationItem(id, ordinal uint64, lock bool) (*a.FileOperationItemRow, error) {
	q := "SELECT " + agentFileOperationItemColumns + " FROM agent_file_operation_item WHERE operation_id=? AND ordinal=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.FileOperationItemRow{}
	e := t.tx.GetContext(t.ctx, v, q, id, ordinal)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertFileOperationItem(v *a.FileOperationItemRow) error {
	_, e := t.named("INSERT INTO agent_file_operation_item(`operation_id`,`ordinal`,`source_kind`,`source_reference_id`,`source_file_id`,`source_path`,`destination_path`,`publication_token`,`expected_sha256`,`observed_sha256`,`observed_size_bytes`,`staged_file_id`,`artifact_id`,`state`,`verified_at`,`published_at`,`error_code`) VALUES(:operation_id,:ordinal,:source_kind,:source_reference_id,:source_file_id,:source_path,:destination_path,:publication_token,:expected_sha256,:observed_sha256,:observed_size_bytes,:staged_file_id,:artifact_id,:state,:verified_at,:published_at,:error_code)", v)
	return e
}
func (t *agentsTx) SaveFileOperationItem(v *a.FileOperationItemRow) error {
	_, e := t.named("UPDATE agent_file_operation_item SET `operation_id`=:operation_id,`ordinal`=:ordinal,`source_kind`=:source_kind,`source_reference_id`=:source_reference_id,`source_file_id`=:source_file_id,`source_path`=:source_path,`destination_path`=:destination_path,`publication_token`=:publication_token,`expected_sha256`=:expected_sha256,`observed_sha256`=:observed_sha256,`observed_size_bytes`=:observed_size_bytes,`staged_file_id`=:staged_file_id,`artifact_id`=:artifact_id,`state`=:state,`verified_at`=:verified_at,`published_at`=:published_at,`error_code`=:error_code WHERE operation_id=:operation_id AND ordinal=:ordinal", v)
	return e
}

const agentResourceReferenceColumns = "`id`,`holder_kind`,`holder_id`,`resource_kind`,`resource_id`,`state`,`executor_epoch`,`fence_version`,`created_at`,`updated_at`,`last_verified_at`,`released_at`,`release_reason`,COALESCE(`release_evidence`,CAST('null' AS JSON)) AS `release_evidence`"

func (t *agentsTx) ResourceReference(id uint64, lock bool) (*a.ResourceReferenceRow, error) {
	q := "SELECT " + agentResourceReferenceColumns + " FROM agent_resource_reference WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.ResourceReferenceRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertResourceReference(v *a.ResourceReferenceRow) error {
	r, e := t.named("INSERT INTO agent_resource_reference(`holder_kind`,`holder_id`,`resource_kind`,`resource_id`,`state`,`executor_epoch`,`fence_version`,`created_at`,`updated_at`,`last_verified_at`,`released_at`,`release_reason`,`release_evidence`) VALUES(:holder_kind,:holder_id,:resource_kind,:resource_id,:state,:executor_epoch,:fence_version,:created_at,:updated_at,:last_verified_at,:released_at,:release_reason,:release_evidence)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveResourceReference(v *a.ResourceReferenceRow) error {
	_, e := t.named("UPDATE agent_resource_reference SET `holder_kind`=:holder_kind,`holder_id`=:holder_id,`resource_kind`=:resource_kind,`resource_id`=:resource_id,`state`=:state,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`created_at`=:created_at,`updated_at`=:updated_at,`last_verified_at`=:last_verified_at,`released_at`=:released_at,`release_reason`=:release_reason,`release_evidence`=:release_evidence WHERE id=:id", v)
	return e
}

const agentPublicOperationColumns = "`id`,`command_receipt_id`,`kind`,`subject_kind`,`subject_id`,`content_domain`,`content_session_id`,`owner_user_id`,`agent_id`,`status`,`config_snapshot`,COALESCE(`result`,CAST('null' AS JSON)) AS `result`,`staged_file_id`,`published_skill_version_id`,`error_code`,`actor_user_id`,`executor_epoch`,`fence_version`,`created_at`,`started_at`,`deadline_at`,`finished_at`,`expires_at`,`updated_at`"

func (t *agentsTx) PublicOperation(id uint64, lock bool) (*a.PublicOperationRow, error) {
	q := "SELECT " + agentPublicOperationColumns + " FROM agent_operation WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.PublicOperationRow{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertPublicOperation(v *a.PublicOperationRow) error {
	r, e := t.named("INSERT INTO agent_operation(`command_receipt_id`,`kind`,`subject_kind`,`subject_id`,`content_domain`,`content_session_id`,`owner_user_id`,`agent_id`,`status`,`config_snapshot`,`result`,`staged_file_id`,`published_skill_version_id`,`error_code`,`actor_user_id`,`executor_epoch`,`fence_version`,`created_at`,`started_at`,`deadline_at`,`finished_at`,`expires_at`,`updated_at`) VALUES(:command_receipt_id,:kind,:subject_kind,:subject_id,:content_domain,:content_session_id,:owner_user_id,:agent_id,:status,:config_snapshot,:result,:staged_file_id,:published_skill_version_id,:error_code,:actor_user_id,:executor_epoch,:fence_version,:created_at,:started_at,:deadline_at,:finished_at,:expires_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SavePublicOperation(v *a.PublicOperationRow) error {
	_, e := t.named("UPDATE agent_operation SET `command_receipt_id`=:command_receipt_id,`kind`=:kind,`subject_kind`=:subject_kind,`subject_id`=:subject_id,`content_domain`=:content_domain,`content_session_id`=:content_session_id,`owner_user_id`=:owner_user_id,`agent_id`=:agent_id,`status`=:status,`config_snapshot`=:config_snapshot,`result`=:result,`staged_file_id`=:staged_file_id,`published_skill_version_id`=:published_skill_version_id,`error_code`=:error_code,`actor_user_id`=:actor_user_id,`executor_epoch`=:executor_epoch,`fence_version`=:fence_version,`created_at`=:created_at,`started_at`=:started_at,`deadline_at`=:deadline_at,`finished_at`=:finished_at,`expires_at`=:expires_at,`updated_at`=:updated_at WHERE id=:id", v)
	return e
}
