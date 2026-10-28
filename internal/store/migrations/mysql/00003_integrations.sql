-- +goose Up
CREATE TABLE `integration` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_credential_id BIGINT UNSIGNED NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    credentials_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    default_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_integration_type_name (service_type, name),
    KEY idx_integration_type_enabled (service_type, enabled, id),
    KEY idx_integration_creator (created_by_user_id),
    KEY idx_integration_default (default_credential_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One GitLab extension per gitlab integration. Application validates type and
-- atomically creates/deletes both records; no physical foreign key is added.
CREATE TABLE `integration_gitlab` (
    integration_id BIGINT UNSIGNED NOT NULL,
    base_url VARCHAR(2048) NOT NULL,
    custom_ca_pem TEXT NULL,
    webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_verification_method VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'secret_token',
    webhook_secret_ciphertext BLOB NULL,
    secret_format_version INT UNSIGNED NULL,
    secret_key_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    connection_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    webhook_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_connection_check JSON NULL,
    last_webhook_receipt JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (integration_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `integration_credential` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    integration_id BIGINT UNSIGNED NOT NULL,
    scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    owner_key BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE scope_type WHEN 'system' THEN 0 WHEN 'project' THEN project_id WHEN 'personal' THEN user_id ELSE NULL END
    ) STORED,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    auth_method VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    auth_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    identity_config JSON NOT NULL,
    secret_ciphertext BLOB NULL,
    secret_format_version INT UNSIGNED NULL,
    secret_key_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    preferred_slot TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN is_preferred = 1 THEN 1 ELSE NULL END) STORED,
    expires_at DATETIME(3) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    material_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_verification JSON NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_integration_credential_name (integration_id, scope_type, owner_key, name),
    UNIQUE KEY uq_integration_credential_preferred (integration_id, scope_type, owner_key, preferred_slot),
    KEY idx_integration_credential_scope (integration_id, scope_type, owner_key, enabled, id),
    KEY idx_integration_credential_project (project_id, integration_id),
    KEY idx_integration_credential_user (user_id, integration_id),
    KEY idx_integration_credential_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Logical references only: no physical foreign keys or CHECK constraints.
-- Service transactions validate existence, ownership, flags, versions, JSON
-- shape and secret envelope completeness, and maintain deletion dependencies.

-- Application must serialize credential maintenance on the integration row,
-- check scoped collection ETags, and clear references before disabling/deleting.
-- A NULL preferred_slot permits multiple non-preferred credentials; owner_key
-- plus scope_type keeps system/project/personal uniqueness domains separate.
-- Service adapters validate JSON fields, sizes, authentication methods and
-- required secrets. No generated field or ciphertext accepts public API input.
-- Webhook receipts are diagnostic summaries, never a durable event inbox.

-- Forward-only migration; restore a matched backup to roll back.
