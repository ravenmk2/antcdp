-- Reading copy of 00009_sandboxes.sql; execute embedded migrations instead.

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
