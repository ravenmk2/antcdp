-- Reading copy of 00006_messaging.sql; execute embedded migrations instead.

CREATE TABLE dingtalk_robot (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'platform',
    scope_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    material_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    last_test JSON NULL,
    secret_ciphertext TEXT NULL,
    secret_format_version BIGINT UNSIGNED NULL,
    secret_key_version VARCHAR(16) NULL,
    PRIMARY KEY(id),
    UNIQUE KEY uq_dingtalk_robot_code(scope_kind,scope_id,code),
    UNIQUE KEY uq_dingtalk_robot_name(scope_kind,scope_id,name),
    KEY idx_dingtalk_robot_scope(scope_kind,scope_id,enabled,id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
