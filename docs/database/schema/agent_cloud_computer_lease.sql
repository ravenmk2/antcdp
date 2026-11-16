-- Reading copy of 00014_agent_cloud_and_sandbox.sql; execute embedded migrations instead.

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
