-- Reading copy of 00015_agent_cloud_and_sandbox.sql; execute embedded migrations instead.

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
