-- 服务连接与远程主机结构阅读副本；实际安装与升级执行嵌入式 Goose 迁移。
-- 仅用于结构评审或隔离空库验证，不导入现有安装。
-- 不含种子或升级数据修正；通用约定见 ../README.md。

-- 服务连接与凭证

CREATE TABLE `service_connection` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    fallback_credential_id BIGINT UNSIGNED NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    credentials_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    fallback_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_connection_check JSON NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_service_connection_code (code),
    UNIQUE KEY uq_service_connection_type_name (service_type, name),
    KEY idx_service_connection_type_enabled (service_type, enabled, id),
    KEY idx_service_connection_creator (created_by_user_id),
    KEY idx_service_connection_fallback (fallback_credential_id)
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

CREATE TABLE `service_credential` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    connection_id BIGINT UNSIGNED NOT NULL,
    service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ownership_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    owner_key BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE ownership_type WHEN 'system' THEN 0 WHEN 'project' THEN project_id WHEN 'personal' THEN user_id ELSE NULL END
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
    UNIQUE KEY uq_service_credential_code (service_type, code),
    UNIQUE KEY uq_service_credential_name (connection_id, ownership_type, owner_key, name),
    UNIQUE KEY uq_service_credential_preferred (connection_id, ownership_type, owner_key, preferred_slot),
    KEY idx_service_credential_ownership (connection_id, ownership_type, owner_key, enabled, id),
    KEY idx_service_credential_project (project_id, connection_id),
    KEY idx_service_credential_user (user_id, connection_id),
    KEY idx_service_credential_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SSH 主机与凭证

CREATE TABLE `remote_host` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    host VARCHAR(253) NOT NULL,
    port SMALLINT UNSIGNED NOT NULL DEFAULT 22,
    fallback_credential_id BIGINT UNSIGNED NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    credentials_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    fallback_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_connection_check JSON NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_remote_host_code (code),
    UNIQUE KEY uq_remote_host_name (name),
    KEY idx_remote_host_enabled (enabled, id),
    KEY idx_remote_host_creator (created_by_user_id),
    KEY idx_remote_host_fallback (fallback_credential_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE remote_host_key (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 host_id BIGINT UNSIGNED NOT NULL,
 algorithm VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 public_key TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 fingerprint_sha256 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 trusted_by_user_id BIGINT UNSIGNED NULL,
 trusted_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_remote_host_key_fingerprint(host_id,fingerprint_sha256)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `remote_host_credential` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    host_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ownership_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    owner_key BIGINT UNSIGNED GENERATED ALWAYS AS (
        CASE ownership_type WHEN 'system' THEN 0 WHEN 'project' THEN project_id WHEN 'personal' THEN user_id ELSE NULL END
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
