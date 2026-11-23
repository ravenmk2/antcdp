-- +goose NO TRANSACTION
-- +goose Up

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

CREATE TABLE `service_connection_grant` (
    connection_id BIGINT UNSIGNED NOT NULL,
    subject_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (connection_id, subject_kind, subject_id),
    KEY idx_service_connection_grant_subject (subject_kind, subject_id, enabled, connection_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `service_connection_gitlab` (
    connection_id BIGINT UNSIGNED NOT NULL,
    webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_verification_method VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'secret_token',
    webhook_secret_ciphertext BLOB NULL,
    webhook_secret_format_version INT UNSIGNED NULL,
    webhook_secret_key_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    webhook_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    webhook_last_receipt JSON NULL,
    webhook_updated_at DATETIME(3) NULL,
    PRIMARY KEY (connection_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `credential` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scope_kind ENUM('platform','project','user','team') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    identifier VARCHAR(255) NOT NULL DEFAULT '',
    ciphertext MEDIUMBLOB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at DATETIME(3) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    material_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_credential_scope_code (scope_kind,scope_id,code)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `credential_preference` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    resource_kind ENUM('service_connection','remote_host') NOT NULL,
    resource_id BIGINT UNSIGNED NOT NULL,
    scope_kind ENUM('platform','project','user','team') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    credential_id BIGINT UNSIGNED NOT NULL,
    last_verification JSON NULL,
    UNIQUE KEY uq_credential_preference (resource_kind,resource_id,scope_kind,scope_id),
    KEY idx_preferred_credential (credential_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
