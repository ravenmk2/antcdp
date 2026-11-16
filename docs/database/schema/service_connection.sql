-- Reading copy of 00004_integrations.sql; execute embedded migrations instead.

CREATE TABLE `service_connection` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ownership_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    owner_key BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE ownership_type WHEN 'platform' THEN 0 WHEN 'project' THEN project_id ELSE NULL END
    ) STORED,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    credentials_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    grants_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_connection_check JSON NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_service_connection_owner_code (ownership_type, owner_key, code),
    UNIQUE KEY uq_service_connection_owner_type_name (ownership_type, owner_key, service_type, name),
    KEY idx_service_connection_owner_type_enabled (ownership_type, owner_key, service_type, enabled, id),
    KEY idx_service_connection_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
