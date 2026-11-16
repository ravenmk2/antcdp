-- Reading copy of 00009_sandboxes.sql; execute embedded migrations instead.

CREATE TABLE `sandbox_instance` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `connection_id` BIGINT UNSIGNED NOT NULL,
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
    UNIQUE KEY uq_sandbox_instance_remote (connection_id,backend_generation,remote_id),
    KEY idx_sandbox_instance_state (state,updated_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
