-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE `sandbox_spec` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    image VARCHAR(512) NOT NULL,
    cpu_millicores INT UNSIGNED NOT NULL,
    memory_mib INT UNSIGNED NOT NULL,
    network_policy JSON NOT NULL,
    config_version BIGINT UNSIGNED NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_spec_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sandbox_admin_command_receipt` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_id BIGINT UNSIGNED NOT NULL,
    scope_kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    command_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash BINARY(32) NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    result JSON NULL,
    created_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_admin_command (actor_id,scope_kind,scope_id,command_kind,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sandbox_instance` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `backend_generation` BIGINT UNSIGNED NOT NULL,
    `remote_id` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `creation_token` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `effective_config` JSON NOT NULL,
    `verified_capabilities` JSON NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `last_observed_at` DATETIME(3) NULL,
    `error_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `executor_epoch` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_instance_creation (creation_token),
    UNIQUE KEY uq_sandbox_instance_remote (backend_generation,remote_id),
    KEY idx_sandbox_instance_state (state,updated_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sandbox_lease` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sandbox_instance_id` BIGINT UNSIGNED NOT NULL,
    `consumer_kind` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `consumer_id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `mode` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `executor_epoch` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `acquired_at` DATETIME(3) NOT NULL,
    `lease_expires_at` DATETIME(3) NOT NULL,
    `released_at` DATETIME(3) NULL,
    `release_reason` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `active_consumer` VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN released_at IS NULL THEN CONCAT(consumer_kind,':',consumer_id) ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_lease_consumer (sandbox_instance_id,active_consumer),
    KEY idx_sandbox_lease_instance (sandbox_instance_id,released_at,id),
    KEY idx_sandbox_lease_expiry (state,lease_expires_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sandbox_execution` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sandbox_instance_id` BIGINT UNSIGNED NOT NULL,
    `lease_id` BIGINT UNSIGNED NOT NULL,
    `execution_token` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `remote_execution_id` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `is_background` BOOLEAN NOT NULL,
    `status` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `cwd` VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `execution_spec_hash` BINARY(32) NOT NULL,
    `executor_epoch` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `exit_code` INT NULL,
    `output_cursor` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `last_observation` JSON NOT NULL,
    `error_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `created_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `cancel_requested_at` DATETIME(3) NULL,
    `last_observed_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_execution_token (execution_token),
    KEY idx_sandbox_execution_instance (sandbox_instance_id,finished_at,id),
    KEY idx_sandbox_execution_lease (lease_id,finished_at,id),
    KEY idx_sandbox_execution_due (status,deadline_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sandbox_operation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sandbox_instance_id` BIGINT UNSIGNED NOT NULL,
    `lease_id` BIGINT UNSIGNED NULL,
    `operation_token` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `kind` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `status` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `request_hash` BINARY(32) NOT NULL,
    `intent` JSON NOT NULL,
    `observation` JSON NOT NULL,
    `executor_epoch` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `error_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `created_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `cancel_requested_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `active_instance_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN finished_at IS NULL AND kind IN ('create','pause','resume','delete') THEN sandbox_instance_id ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_operation_token (operation_token),
    UNIQUE KEY uq_sandbox_operation_active (active_instance_id),
    KEY idx_sandbox_operation_instance (sandbox_instance_id,finished_at,id),
    KEY idx_sandbox_operation_lease (lease_id,finished_at,id),
    KEY idx_sandbox_operation_due (status,updated_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
