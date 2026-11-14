package mysql

import (
	"context"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

// These projections and index signatures are the deployed migration contract.
var agentSchemaColumns = map[string]string{
	"agent_session_projection":  "session_id,projection_version,through_seq,payload,payload_sha256,updated_at",
	"agent_skill_binding":       skillBindingColumns,
	"agent_run_context":         "root_run_id,agent_id,executor_user_id,agent_config_version,schema_version,project_context_id,cloud_computer_id,cwd,system_prompt,model_snapshot,runtime_policy,builtin_tools,mcp_bindings,resource_grants,skill_manifest,mcp_surface,mcp_prepared_at,created_at",
	"agent_mcp_binding":         "`id`,`agent_id`,`mcp_server_id`,`enabled`,`sort_order`,`created_at`,`updated_at`,`removed_at`",
	"agent":                     "`id`,`code`,`name`,`description`,`agent_type`,`scope_kind`,`scope_id`,`robot_user_id`,`enabled`,`system_prompt`,`config_schema_version`,`default_model_binding_id`,`runtime_policy`,`pool_capacity`,`config_version`,`row_version`,`created_by_user_id`,`created_at`,`updated_at`,`deleted_at`",
	"agent_model_binding":       "`id`,`agent_id`,`model_definition_id`,`thinking_options`,`default_thinking`,`generation_overrides`,`sort_order`,`created_at`,`updated_at`,`removed_at`",
	"agent_tool_binding":        "`id`,`agent_id`,`tool_kind`,`tool_key`,`policy`,`parameter_constraints`,`config`,`config_schema_version`,`sort_order`,`created_at`,`updated_at`,`removed_at`",
	"agent_skill":               "`id`,`name`,`title`,`description`,`enabled`,`row_version`,`created_by_user_id`,`created_at`,`updated_at`",
	"agent_skill_version":       "`id`,`skill_id`,`version_label`,`state`,`upload_operation_id`,`archive_file_id`,`archive_sha256`,`content_sha256`,`expanded_size_bytes`,`file_count`,`manifest_schema_version`,`manifest`,`frontmatter`,`validation_report`,`change_note`,`row_version`,`created_by_user_id`,`created_at`,`deleted_at`,`deleted_by_user_id`",
	"web_access_provider":       "`id`,`code`,`name`,`description`,`provider_type`,`base_url`,`auth_method`,`identity_config`,`supported_operations`,`enabled`,`config`,`config_schema_version`,`secret_ciphertext`,`secret_format_version`,`secret_key_version`,`secret_revision`,`row_version`,`config_version`,`last_diagnostic`,`last_diagnostic_at`,`created_by_user_id`,`created_at`,`updated_at`",
	"web_access_setting":        "`id`,`search_routes`,`search_max_results`,`fetch_routes`,`fetch_max_bytes`,`fetch_timeout_seconds`,`fetch_max_redirects`,`fetch_allowed_internal_hosts`,`row_version`,`updated_by_user_id`,`created_at`,`updated_at`",
	"agent_mcp_server":          "`id`,`code`,`name`,`description`,`url`,`auth_method`,`auth_header_name`,`identity_config`,`timeout_seconds`,`enabled`,`config`,`config_schema_version`,`secret_ciphertext`,`secret_format_version`,`secret_key_version`,`secret_revision`,`row_version`,`config_version`,`last_diagnostic`,`last_diagnostic_at`,`created_by_user_id`,`created_at`,`updated_at`",
	"agent_operation":           "`id`,`command_receipt_id`,`kind`,`subject_kind`,`subject_id`,`content_domain`,`content_session_id`,`owner_user_id`,`agent_id`,`status`,`config_snapshot`,`result`,`staged_file_id`,`published_skill_version_id`,`error_code`,`actor_user_id`,`executor_epoch`,`fence_version`,`created_at`,`started_at`,`deadline_at`,`finished_at`,`expires_at`,`updated_at`",
	"agent_session":             "`id`,`agent_id`,`agent_type`,`session_kind`,`root_session_id`,`parent_run_id`,`executor_user_id`,`title`,`title_source`,`title_source_event_seq`,`title_generation_status`,`title_model_call_id`,`project_context_id`,`cloud_computer_id`,`selected_model_binding_id`,`selected_thinking_option_key`,`locked_model_config`,`model_selection_hash`,`model_locked_at`,`queue_paused`,`next_input_order`,`last_seq`,`projection_seq`,`active_run_id`,`active_compaction_id`,`surface_revision`,`row_version`,`created_by_actor_kind`,`created_by_actor_id`,`created_at`,`updated_at`,`last_activity_at`,`archived_at`,`archived_by_user_id`",
	"agent_session_preference":  "`user_id`,`session_id`,`pinned`,`pinned_at`,`viewed_through_seq`,`viewed_at`,`row_version`,`created_at`,`updated_at`",
	"agent_input":               "`id`,`session_id`,`command_receipt_id`,`input_kind`,`origin_kind`,`actor_kind`,`actor_id`,`source_kind`,`source_id`,`last_modified_by_kind`,`last_modified_by_id`,`status`,`queue_order`,`claimed_run_id`,`claimed_step_no`,`question_interaction_id`,`pending_question_slot`,`retry_of_run_id`,`continuation_seq`,`accepted_seq`,`current_content_seq`,`message_seq`,`content_revision`,`row_version`,`created_at`,`updated_at`,`queue_deadline_at`,`claimed_at`,`ended_at`,`end_reason`",
	"agent_input_file":          "`input_id`,`ordinal`,`reference_kind`,`reference_id`,`file_id`,`content_session_id`,`source_sha256`,`created_at`",
	"agent_run":                 "`id`,`session_id`,`root_run_id`,`parent_run_id`,`trigger_input_id`,`retry_of_run_id`,`executor_user_id`,`origin_kind`,`actor_kind`,`actor_id`,`source_kind`,`source_id`,`status`,`active_slot`,`agent_config_version`,`resource_config_version`,`execution_policy_snapshot`,`model_selection_hash`,`budget_limit`,`budget_reserved`,`budget_used`,`budget_revision`,`current_step_no`,`executor_epoch`,`fence_version`,`started_seq`,`ended_seq`,`continuation_seq`,`end_reason`,`usage_completeness`,`created_at`,`started_at`,`deadline_at`,`stop_requested_at`,`stop_actor_kind`,`stop_actor_id`,`stop_deadline_at`,`finished_at`,`settled_at`,`updated_at`,`projection_seq`",
	"agent_event":               "`id`,`session_id`,`seq`,`run_id`,`event_type`,`schema_version`,`semantic_key`,`payload`,`payload_sha256`,`payload_size_bytes`,`occurred_at`",
	"agent_model_call":          "`id`,`session_id`,`run_id`,`root_run_id`,`compaction_id`,`step_no`,`attempt_no`,`purpose`,`generation_slot`,`status`,`provider_id`,`model_definition_id`,`protocol`,`requested_model_id`,`response_model_id`,`thinking`,`request_config`,`surface_manifest`,`request_hash`,`capability_snapshot`,`budget_reservation`,`budget_settlement`,`provider_request_id`,`executor_epoch`,`fence_version`,`response_event_seq`,`input_tokens`,`output_tokens`,`cache_read_tokens`,`cache_write_tokens`,`usage_raw`,`usage_semantics_version`,`usage_completeness`,`estimated_cost`,`cost_currency`,`pricing_snapshot`,`error_code`,`created_at`,`started_at`,`deadline_at`,`finished_at`",
	"agent_tool_call":           "`id`,`session_id`,`run_id`,`root_run_id`,`model_call_id`,`step_no`,`call_ordinal`,`provider_call_id`,`tool_key`,`tool_binding_id`,`mcp_binding_id`,`mcp_server_id`,`mcp_tool_name`,`skill_version_id`,`execution_class`,`status`,`arguments_event_seq`,`arguments_hash`,`tool_definition_snapshot`,`budget_reservation`,`budget_settlement`,`authorization_snapshot`,`agent_config_version`,`resource_config_version`,`interaction_id`,`dispatch_token`,`execution_ref`,`remote_identity_ref`,`executor_epoch`,`fence_version`,`result_event_seq`,`error_code`,`executed`,`reconciled_outcome`,`last_reconciled_seq`,`created_at`,`deadline_at`,`dispatch_started_at`,`started_at`,`finished_at`,`updated_at`",
	"agent_interaction":         "`id`,`session_id`,`run_id`,`origin_child_run_id`,`tool_call_id`,`kind`,`status`,`request_event_seq`,`request_hash`,`specification`,`wait_deadline_at`,`pending_reply_input_id`,`answer_event_seq`,`decided_by_kind`,`decided_by_id`,`decided_at`,`approval_consumed_at`,`continue_reason`,`row_version`,`created_at`,`updated_at`,`projection_seq`",
	"agent_command_receipt":     "`id`,`actor_kind`,`actor_id`,`scope_kind`,`scope_id`,`command_kind`,`idempotency_key`,`request_hash`,`status`,`response_status`,`result`,`operation_id`,`target_kind`,`target_id`,`created_at`,`completed_at`,`retention_until`",
	"agent_compaction":          "`id`,`session_id`,`run_id`,`command_receipt_id`,`public_operation_id`,`status`,`from_seq`,`through_seq`,`source_surface_revision`,`source_manifest`,`source_hash`,`start_event_seq`,`summary_event_seq`,`end_event_seq`,`executor_epoch`,`fence_version`,`error_code`,`created_at`,`deadline_at`,`finished_at`",
	"agent_file":                "`id`,`purpose`,`content_domain`,`content_session_id`,`owner_user_id`,`agent_id`,`storage_key`,`writer_token`,`state`,`integrity_state`,`size_bytes`,`sha256`,`media_type`,`media_properties`,`uploaded_by_user_id`,`created_by_tool_call_id`,`upload_operation_id`,`created_at`,`updated_at`,`expires_at`,`bound_at`,`orphaned_at`,`integrity_checked_at`,`deleted_at`,`error_code`",
	"agent_attachment":          "`id`,`content_session_id`,`file_id`,`uploaded_by_user_id`,`filename`,`state`,`bound_input_id`,`command_receipt_id`,`row_version`,`created_at`,`expires_at`,`bound_at`,`deleted_at`",
	"agent_artifact":            "`id`,`content_session_id`,`run_id`,`tool_call_id`,`output_ordinal`,`file_id`,`filename`,`description`,`source_path`,`source_snapshot`,`retained_event_seq`,`row_version`,`created_at`,`deleted_at`,`deleted_by_user_id`,`deleted_event_seq`",
	"agent_file_operation":      "`id`,`tool_call_id`,`content_session_id`,`root_run_id`,`kind`,`operation_token`,`status`,`binding_id`,`cloud_computer_id`,`binding_fence_version`,`backend_generation`,`runtime_generation`,`storage_generation`,`volume_id`,`executor_epoch`,`fence_version`,`request_hash`,`result`,`commit_receipt`,`committed_from_seq`,`committed_through_seq`,`error_code`,`created_at`,`deadline_at`,`finished_at`,`updated_at`",
	"agent_file_operation_item": "`operation_id`,`ordinal`,`source_kind`,`source_reference_id`,`source_file_id`,`source_path`,`destination_path`,`publication_token`,`expected_sha256`,`observed_sha256`,`observed_size_bytes`,`staged_file_id`,`artifact_id`,`state`,`verified_at`,`published_at`,`error_code`",
	"agent_resource_reference":  "`id`,`holder_kind`,`holder_id`,`resource_kind`,`resource_id`,`state`,`executor_epoch`,`fence_version`,`created_at`,`updated_at`,`last_verified_at`,`released_at`,`release_reason`,`release_evidence`",
}

type agentSchemaIndex struct {
	Table     string `db:"table_name"`
	Name      string `db:"index_name"`
	NonUnique int    `db:"non_unique"`
	Columns   string `db:"columns_list"`
}

var agentSchemaIndexes = []agentSchemaIndex{
	{"agent_session", "idx_agent_session_title_pending", 1, "title_generation_status,id"},
	{"agent_session_projection", "PRIMARY", 0, "session_id"},
	{"agent_skill_binding", "PRIMARY", 0, "id"},
	{"agent_skill_binding", "uq_agent_skill_binding", 0, "agent_id,skill_id"},
	{"agent_skill_binding", "idx_agent_skill_binding_version", 1, "skill_version_id,agent_id"},
	{"agent_run_context", "PRIMARY", 0, "root_run_id"},
	{"agent_run_context", "idx_agent_run_context_agent", 1, "agent_id,root_run_id"},
	{"agent_run_context", "idx_agent_run_context_executor", 1, "executor_user_id,root_run_id"},
	{"agent_run", "idx_agent_run_settlement", 1, "root_run_id,settled_at,finished_at,updated_at,id"},
	{"agent_mcp_binding", "PRIMARY", 0, "id"},
	{"agent_mcp_binding", "uq_agent_mcp_binding", 0, "agent_id,mcp_server_id"},
	{"agent_mcp_binding", "idx_agent_mcp_binding_server", 1, "mcp_server_id,agent_id"},
	{"agent_mcp_binding", "idx_agent_mcp_binding_current", 1, "agent_id,removed_at,id"},
	{"agent_tool_call", "idx_agent_tool_mcp_server", 1, "mcp_server_id,id"},
	{"agent", "PRIMARY", 0, "id"},
	{"agent", "uq_agent_code", 0, "code"},
	{"agent", "uq_agent_robot", 0, "robot_user_id"},
	{"agent", "idx_agent_scope", 1, "scope_kind,scope_id,deleted_at,id"},
	{"agent", "idx_agent_catalog", 1, "agent_type,enabled,deleted_at,id"},
	{"agent", "idx_agent_model", 1, "default_model_binding_id"},
	{"agent_model_binding", "PRIMARY", 0, "id"},
	{"agent_model_binding", "uq_agent_model_binding", 0, "agent_id,model_definition_id"},
	{"agent_model_binding", "idx_agent_model_target", 1, "model_definition_id,agent_id"},
	{"agent_model_binding", "idx_agent_model_binding_current", 1, "agent_id,removed_at,id"},
	{"agent_tool_binding", "PRIMARY", 0, "id"},
	{"agent_tool_binding", "uq_agent_tool_binding_key", 0, "agent_id,tool_key"},
	{"agent_tool_binding", "idx_agent_tool_binding_current", 1, "agent_id,removed_at,id"},
	{"agent_skill", "PRIMARY", 0, "id"},
	{"agent_skill", "uq_agent_skill_name", 0, "name"},
	{"agent_skill", "idx_agent_skill_enabled", 1, "enabled,id"},
	{"agent_skill_version", "PRIMARY", 0, "id"},
	{"agent_skill_version", "uq_agent_skill_version_label", 0, "skill_id,version_label"},
	{"agent_skill_version", "uq_agent_skill_version_upload", 0, "upload_operation_id"},
	{"agent_skill_version", "idx_agent_skill_version_archive", 1, "archive_file_id"},
	{"web_access_provider", "PRIMARY", 0, "id"},
	{"web_access_provider", "uq_web_access_provider_code", 0, "code"},
	{"web_access_provider", "uq_web_access_provider_name", 0, "name"},
	{"web_access_provider", "idx_web_access_provider_enabled", 1, "enabled,id"},
	{"web_access_setting", "PRIMARY", 0, "id"},
	{"agent_mcp_server", "PRIMARY", 0, "id"},
	{"agent_mcp_server", "uq_agent_mcp_server_code", 0, "code"},
	{"agent_mcp_server", "uq_agent_mcp_server_name", 0, "name"},
	{"agent_mcp_server", "idx_agent_mcp_server_enabled", 1, "enabled,id"},
	{"agent_operation", "PRIMARY", 0, "id"},
	{"agent_operation", "uq_agent_operation_receipt", 0, "command_receipt_id"},
	{"agent_operation", "idx_agent_operation_subject", 1, "subject_kind,subject_id,created_at,id"},
	{"agent_operation", "idx_agent_operation_due", 1, "status,deadline_at,id"},
	{"agent_operation", "idx_agent_operation_expiry", 1, "published_skill_version_id,expires_at,id"},
	{"agent_operation", "idx_agent_operation_content", 1, "content_domain,owner_user_id,created_at,id"},
	{"agent_operation", "idx_agent_operation_session", 1, "content_session_id,id"},
	{"agent_session", "PRIMARY", 0, "id"},
	{"agent_session", "idx_agent_session_personal", 1, "executor_user_id,session_kind,archived_at,last_activity_at,id"},
	{"agent_session", "idx_agent_session_service", 1, "agent_type,session_kind,archived_at,last_activity_at,id"},
	{"agent_session", "idx_agent_session_agent", 1, "agent_id,created_at,id"},
	{"agent_session", "idx_agent_session_children", 1, "root_session_id,parent_run_id,id"},
	{"agent_session", "idx_agent_session_active", 1, "active_run_id"},
	{"agent_session_preference", "PRIMARY", 0, "user_id,session_id"},
	{"agent_session_preference", "idx_agent_session_preference_order", 1, "user_id,pinned,pinned_at,session_id"},
	{"agent_session_preference", "idx_agent_session_preference_session", 1, "session_id,user_id"},
	{"agent_input", "PRIMARY", 0, "id"},
	{"agent_input", "uq_agent_input_receipt", 0, "command_receipt_id"},
	{"agent_input", "uq_agent_input_order", 0, "session_id,queue_order"},
	{"agent_input", "uq_agent_input_pending_answer", 0, "pending_question_slot"},
	{"agent_input", "idx_agent_input_queue", 1, "session_id,status,queue_order"},
	{"agent_input", "idx_agent_input_deadline", 1, "status,queue_deadline_at,id"},
	{"agent_input", "idx_agent_input_claimed", 1, "claimed_run_id,claimed_step_no,id"},
	{"agent_input", "idx_agent_input_interaction", 1, "question_interaction_id,id"},
	{"agent_input_file", "PRIMARY", 0, "input_id,ordinal"},
	{"agent_input_file", "uq_agent_input_file_reference", 0, "input_id,reference_kind,reference_id"},
	{"agent_input_file", "idx_agent_input_file_target", 1, "file_id,input_id"},
	{"agent_run", "PRIMARY", 0, "id"},
	{"agent_run", "uq_agent_run_active", 0, "session_id,active_slot"},
	{"agent_run", "uq_agent_run_trigger", 0, "trigger_input_id"},
	{"agent_run", "idx_agent_run_family", 1, "root_run_id,parent_run_id,id"},
	{"agent_run", "idx_agent_run_session", 1, "session_id,created_at,id"},
	{"agent_run", "idx_agent_run_result", 1, "session_id,root_run_id,ended_seq"},
	{"agent_run", "idx_agent_run_deadline", 1, "status,deadline_at,id"},
	{"agent_run", "idx_agent_run_executor", 1, "executor_epoch,status,id"},
	{"agent_event", "PRIMARY", 0, "id"},
	{"agent_event", "uq_agent_event_seq", 0, "session_id,seq"},
	{"agent_event", "uq_agent_event_semantic", 0, "session_id,semantic_key"},
	{"agent_event", "idx_agent_event_run", 1, "run_id,seq"},
	{"agent_model_call", "PRIMARY", 0, "id"},
	{"agent_model_call", "uq_agent_model_call_attempt", 0, "run_id,step_no,attempt_no,generation_slot"},
	{"agent_model_call", "uq_agent_model_compaction_attempt", 0, "compaction_id,attempt_no"},
	{"agent_model_call", "idx_agent_model_call_usage", 1, "provider_id,model_definition_id,created_at,id"},
	{"agent_model_call", "idx_agent_model_call_session", 1, "session_id,created_at,id"},
	{"agent_model_call", "idx_agent_model_call_root", 1, "root_run_id,id"},
	{"agent_model_call", "idx_agent_model_call_pending", 1, "status,deadline_at,id"},
	{"agent_tool_call", "PRIMARY", 0, "id"},
	{"agent_tool_call", "uq_agent_tool_provider_call", 0, "model_call_id,provider_call_id"},
	{"agent_tool_call", "uq_agent_tool_call_order", 0, "run_id,step_no,call_ordinal"},
	{"agent_tool_call", "uq_agent_tool_dispatch", 0, "dispatch_token"},
	{"agent_tool_call", "idx_agent_tool_run_status", 1, "run_id,status,id"},
	{"agent_tool_call", "idx_agent_tool_pending", 1, "status,deadline_at,id"},
	{"agent_tool_call", "idx_agent_tool_reconcile", 1, "status,reconciled_outcome,id"},
	{"agent_tool_call", "idx_agent_tool_skill_version", 1, "skill_version_id,id"},
	{"agent_interaction", "PRIMARY", 0, "id"},
	{"agent_interaction", "uq_agent_interaction_call", 0, "tool_call_id"},
	{"agent_interaction", "uq_agent_interaction_reply", 0, "pending_reply_input_id"},
	{"agent_interaction", "idx_agent_interaction_session", 1, "session_id,kind,status,id"},
	{"agent_interaction", "idx_agent_interaction_due", 1, "kind,status,wait_deadline_at,id"},
	{"agent_command_receipt", "PRIMARY", 0, "id"},
	{"agent_command_receipt", "uq_agent_receipt_key", 0, "actor_kind,actor_id,scope_kind,scope_id,command_kind,idempotency_key"},
	{"agent_command_receipt", "idx_agent_receipt_target", 1, "target_kind,target_id,id"},
	{"agent_command_receipt", "idx_agent_receipt_operation", 1, "operation_id"},
	{"agent_compaction", "PRIMARY", 0, "id"},
	{"agent_compaction", "uq_agent_compaction_receipt", 0, "command_receipt_id"},
	{"agent_compaction", "idx_agent_compaction_session", 1, "session_id,created_at,id"},
	{"agent_compaction", "idx_agent_compaction_due", 1, "status,deadline_at,id"},
	{"agent_compaction", "uq_agent_compaction_public_operation", 0, "public_operation_id"},
	{"agent_file", "PRIMARY", 0, "id"},
	{"agent_file", "uq_agent_file_storage", 0, "storage_key"},
	{"agent_file", "uq_agent_file_writer", 0, "writer_token"},
	{"agent_file", "idx_agent_file_session", 1, "content_session_id,state,id"},
	{"agent_file", "idx_agent_file_expiry", 1, "state,expires_at,id"},
	{"agent_file", "idx_agent_file_orphan", 1, "state,orphaned_at,id"},
	{"agent_file", "idx_agent_file_upload_operation", 1, "upload_operation_id"},
	{"agent_attachment", "PRIMARY", 0, "id"},
	{"agent_attachment", "uq_agent_attachment_receipt", 0, "command_receipt_id"},
	{"agent_attachment", "uq_agent_attachment_file", 0, "file_id"},
	{"agent_attachment", "idx_agent_attachment_session", 1, "content_session_id,state,created_at,id"},
	{"agent_attachment", "idx_agent_attachment_expiry", 1, "state,expires_at,id"},
	{"agent_artifact", "PRIMARY", 0, "id"},
	{"agent_artifact", "uq_agent_artifact_output", 0, "tool_call_id,output_ordinal"},
	{"agent_artifact", "idx_agent_artifact_session", 1, "content_session_id,deleted_at,created_at,id"},
	{"agent_artifact", "idx_agent_artifact_run", 1, "run_id,deleted_at,id"},
	{"agent_artifact", "idx_agent_artifact_file", 1, "file_id,deleted_at,id"},
	{"agent_file_operation", "PRIMARY", 0, "id"},
	{"agent_file_operation", "uq_agent_file_operation_call", 0, "tool_call_id"},
	{"agent_file_operation", "uq_agent_file_operation_token", 0, "operation_token"},
	{"agent_file_operation", "idx_agent_file_operation_binding", 1, "binding_id,status,id"},
	{"agent_file_operation", "idx_agent_file_operation_due", 1, "status,deadline_at,id"},
	{"agent_file_operation_item", "PRIMARY", 0, "operation_id,ordinal"},
	{"agent_file_operation_item", "uq_agent_file_item_publication", 0, "publication_token"},
	{"agent_file_operation_item", "idx_agent_file_item_source", 1, "source_file_id,state"},
	{"agent_file_operation_item", "idx_agent_file_item_staged", 1, "staged_file_id"},
	{"agent_resource_reference", "PRIMARY", 0, "id"},
	{"agent_resource_reference", "uq_agent_resource_reference", 0, "holder_kind,holder_id,resource_kind,resource_id"},
	{"agent_resource_reference", "idx_agent_resource_reference_live", 1, "resource_kind,resource_id,state,id"},
	{"agent_resource_reference", "idx_agent_resource_reference_reconcile", 1, "state,executor_epoch,id"},
}

func (s *Store) agentsSchemaReady(ctx context.Context) error {
	for table, columns := range agentSchemaColumns {
		rows, e := s.db.QueryxContext(ctx, "SELECT "+columns+" FROM `"+table+"` LIMIT 0")
		if e != nil {
			return install.ErrIncompleteSchema
		}
		if e = rows.Close(); e != nil {
			return e
		}
	}
	rows := []agentSchemaIndex{}
	if e := s.db.SelectContext(ctx, &rows, "SELECT TABLE_NAME AS table_name,INDEX_NAME AS index_name,NON_UNIQUE AS non_unique,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME='agent' OR TABLE_NAME LIKE 'agent\\_%' OR TABLE_NAME LIKE 'web\\_access\\_%') GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE"); e != nil {
		return e
	}
	actual := map[string]agentSchemaIndex{}
	for _, v := range rows {
		actual[v.Table+"/"+v.Name] = v
	}
	for _, expected := range agentSchemaIndexes {
		v, ok := actual[expected.Table+"/"+expected.Name]
		if !ok || v.NonUnique != expected.NonUnique || !strings.EqualFold(v.Columns, expected.Columns) {
			return install.ErrIncompleteSchema
		}
	}
	var count int
	if e := s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM web_access_setting WHERE id=1 AND JSON_TYPE(search_routes)='ARRAY' AND JSON_TYPE(fetch_routes)='ARRAY' AND JSON_TYPE(fetch_allowed_internal_hosts)='ARRAY' AND row_version>=1"); e != nil {
		return e
	}
	if count != 1 {
		return install.ErrIncompleteSchema
	}
	return nil
}
