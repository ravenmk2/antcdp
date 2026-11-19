-- Reading copy of 00009_sandboxes.sql; execute embedded migrations instead.

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
