-- 身份与系统结构阅读副本；实际安装与升级执行嵌入式 Goose 迁移。
-- 仅用于结构评审或隔离空库验证，不导入现有安装。
-- 不含种子或升级数据修正；通用约定见 ../README.md。

-- 身份与系统

CREATE TABLE `user` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'human',
    username VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'user',
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
    avatar_file_id BIGINT UNSIGNED NULL,
    auth_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_login_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_username (username),
    UNIQUE KEY uq_user_avatar_file_id (avatar_file_id),
    KEY idx_user_account_type (account_type, deleted_at, created_at, id),
    KEY idx_user_deleted_created (deleted_at, created_at, id),
    KEY idx_user_deleted_status (deleted_at, status, created_at, id),
    KEY idx_user_deleted_role (deleted_at, role, created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_password` (
    user_id BIGINT UNSIGNED NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    require_password_change BOOLEAN NOT NULL DEFAULT FALSE,
    password_changed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `avatar_file` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    storage_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    width SMALLINT UNSIGNED NOT NULL,
    height SMALLINT UNSIGNED NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    sha256 BINARY(32) NOT NULL,
    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'staged',
    expires_at DATETIME(3) NULL,
    orphaned_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_avatar_file_storage_key (storage_key),
    KEY idx_avatar_file_staged_expiry (state, expires_at, id),
    KEY idx_avatar_file_orphaned_time (state, orphaned_at, id),
    KEY idx_avatar_file_uploader (uploaded_by_user_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `session` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    auth_version BIGINT UNSIGNED NOT NULL,
    ttl_days SMALLINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    ip_address VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
    user_agent VARCHAR(512) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_session_token_hash (token_hash),
    KEY idx_session_user_validity (user_id, revoked_at, expires_at),
    KEY idx_session_expiry (expires_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `system_setting` (
    `name` VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `value` JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `system_instance` (
    id TINYINT UNSIGNED NOT NULL,
    installation_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    founder_user_id BIGINT UNSIGNED NOT NULL,
    key_fingerprint BINARY(32) NOT NULL,
    installed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_system_instance_installation (installation_id),
    KEY idx_system_instance_founder (founder_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit_event` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT UNSIGNED NULL,
    actor_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_name VARCHAR(64) NOT NULL,
    actor_username VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
    action VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    target_label VARCHAR(160) NOT NULL,
    occurred_at DATETIME(3) NOT NULL,
    request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ip_address VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
    detail JSON NULL,
    PRIMARY KEY (id),
    KEY idx_audit_event_time (occurred_at, id),
    KEY idx_audit_event_actor_time (actor_user_id, occurred_at, id),
    KEY idx_audit_event_action_time (action, occurred_at, id),
    KEY idx_audit_event_target_time (target_type, target_id, occurred_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
