-- Reading copy of 00009_sandboxes.sql; execute embedded migrations instead.

CREATE TABLE `sandbox_connection` (
    backend_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'opensandbox',
    `id` BIGINT UNSIGNED NOT NULL,
    `endpoint` VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `access_mode` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `connect_timeout_seconds` INT UNSIGNED NOT NULL,
    `operation_timeout_seconds` INT UNSIGNED NOT NULL,
    `secret_ciphertext` MEDIUMBLOB NULL,
    `secret_format_version` BIGINT UNSIGNED NULL,
    `secret_key_version` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `secret_revision` BIGINT UNSIGNED NOT NULL,
    `config_version` BIGINT UNSIGNED NOT NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `backend_generation` BIGINT UNSIGNED NOT NULL,
    `topology_version` BIGINT UNSIGNED NOT NULL,
    `maintenance_state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `verified_capabilities` JSON NULL,
    `last_diagnostic` JSON NULL,
    `last_diagnostic_at` DATETIME(3) NULL,
    `updated_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
