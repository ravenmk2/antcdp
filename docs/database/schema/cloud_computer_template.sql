-- Reading copy of 00013_cloud_computers.sql; execute embedded migrations instead.

CREATE TABLE `cloud_computer_template` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `agent_id` BIGINT UNSIGNED NULL,
    `environment` JSON NOT NULL,
    `config_schema_version` BIGINT UNSIGNED NOT NULL,
    `config_version` BIGINT UNSIGNED NOT NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `updated_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `owner_key` BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(agent_id,0)) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_template_owner (owner_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
