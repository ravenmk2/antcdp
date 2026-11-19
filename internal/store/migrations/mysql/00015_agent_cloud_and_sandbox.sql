-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE `agent_cloud_computer_lease` (
    sandbox_lease_id BIGINT UNSIGNED NULL,
    `root_run_id` BIGINT UNSIGNED NOT NULL,
    `cloud_computer_id` BIGINT UNSIGNED NOT NULL,
    `mode` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `backend_generation` BIGINT UNSIGNED NOT NULL,
    `sandbox_instance_id` BIGINT UNSIGNED NULL,
    `storage_generation` BIGINT UNSIGNED NOT NULL,
    `skill_set_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `executor_epoch` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `acquired_at` DATETIME(3) NOT NULL,
    `lease_expires_at` DATETIME(3) NOT NULL,
    `released_at` DATETIME(3) NULL,
    `release_reason` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `exclusive_computer_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN mode='exclusive' AND released_at IS NULL THEN cloud_computer_id ELSE NULL END) STORED,
    PRIMARY KEY (root_run_id),
    UNIQUE KEY uq_cloud_lease_exclusive (exclusive_computer_id),
    KEY idx_cloud_lease_computer (cloud_computer_id,released_at,root_run_id),
    KEY idx_cloud_lease_reconcile (state,lease_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_cloud_computer_skill_state` (
    `cloud_computer_id` BIGINT UNSIGNED NOT NULL,
    `agent_id` BIGINT UNSIGNED NOT NULL,
    `backend_generation` BIGINT UNSIGNED NOT NULL,
    `storage_generation` BIGINT UNSIGNED NOT NULL,
    `installed_set_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `installed_manifest` JSON NOT NULL,
    `state` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `sync_token` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (cloud_computer_id,agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_sandbox_execution` (
    sandbox_execution_id BIGINT UNSIGNED NOT NULL,
    root_run_id BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NOT NULL,
    tool_call_id BIGINT UNSIGNED NOT NULL,
    execution_ordinal BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (sandbox_execution_id),
    UNIQUE KEY uq_agent_sandbox_execution_call (tool_call_id,execution_ordinal),
    KEY idx_agent_sandbox_execution_root (root_run_id,sandbox_execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cloud_computer_operation` (
    request_scope_kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_scope_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_command VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_hash BINARY(32) NULL,
    response_status SMALLINT UNSIGNED NULL,
    response_result JSON NULL,
    request_operation_id BIGINT UNSIGNED NULL,
    request_target_kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_target_id BIGINT UNSIGNED NULL,
    sandbox_operation_id BIGINT UNSIGNED NULL,
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `cloud_computer_id` BIGINT UNSIGNED NOT NULL,
    `root_run_id` BIGINT UNSIGNED NULL,
    `kind` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `status` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `operation_token` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `command_receipt_id` BIGINT UNSIGNED NULL,
    `backend_generation` BIGINT UNSIGNED NOT NULL,
    `sandbox_instance_id` BIGINT UNSIGNED NOT NULL,
    `storage_generation` BIGINT UNSIGNED NOT NULL,
    `target_environment` JSON NULL,
    `target_spec_id` BIGINT UNSIGNED NULL,
    `target_spec_version` BIGINT UNSIGNED NULL,
    `intent` JSON NOT NULL,
    `observation` JSON NULL,
    `actor_kind` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `actor_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `executor_epoch` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `error_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `created_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `cancel_requested_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `active_computer_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN finished_at IS NULL AND kind IN ('create','rebuild','pause','resume','delete') THEN cloud_computer_id ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_operation_token (operation_token),
    UNIQUE KEY uq_cloud_operation_receipt (command_receipt_id),
    UNIQUE KEY uq_cloud_operation_active (active_computer_id),
    KEY idx_cloud_operation_computer (cloud_computer_id,status,id),
    KEY idx_cloud_operation_due (status,updated_at,id),
    UNIQUE KEY uq_cloud_request (actor_kind,actor_id,request_scope_kind,request_scope_id,request_command,request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
