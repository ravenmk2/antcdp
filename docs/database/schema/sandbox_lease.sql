-- Reading copy of 00009_sandboxes.sql; execute embedded migrations instead.

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
