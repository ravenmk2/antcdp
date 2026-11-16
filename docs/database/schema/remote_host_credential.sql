-- Reading copy of 00005_remote_hosts.sql; execute embedded migrations instead.

CREATE TABLE `remote_host_credential` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    host_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ownership_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    owner_key BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE ownership_type WHEN 'platform' THEN 0 WHEN 'project' THEN project_id WHEN 'personal' THEN user_id ELSE NULL END
    ) STORED,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    auth_method VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    username VARCHAR(255) NOT NULL,
    secret_ciphertext MEDIUMBLOB NULL,
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
    UNIQUE KEY uq_remote_host_credential_code (code),
    UNIQUE KEY uq_remote_host_credential_name (host_id, ownership_type, owner_key, name),
    UNIQUE KEY uq_remote_host_credential_preferred (host_id, ownership_type, owner_key, preferred_slot),
    KEY idx_remote_host_credential_ownership (host_id, ownership_type, owner_key, enabled, id),
    KEY idx_remote_host_credential_project (project_id, host_id),
    KEY idx_remote_host_credential_user (user_id, host_id),
    KEY idx_remote_host_credential_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
