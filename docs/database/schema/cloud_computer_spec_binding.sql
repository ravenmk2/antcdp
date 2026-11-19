-- Reading copy of 00013_cloud_computers.sql; execute embedded migrations instead.

CREATE TABLE `cloud_computer_spec_binding` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `agent_id` BIGINT UNSIGNED NULL,
    `spec_id` BIGINT UNSIGNED NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `updated_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `owner_key` BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(agent_id,0)) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_spec_binding_owner (owner_key),
    KEY idx_cloud_binding_spec (spec_id,owner_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
