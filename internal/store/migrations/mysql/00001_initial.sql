-- +goose NO TRANSACTION
-- +goose Up
-- Baseline 1: 48 business tables, MySQL 8.0.16+ / InnoDB.
-- Empty schema only. Installation seeds are written separately by the installer.

CREATE TABLE `user` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    display_name VARCHAR(64) NOT NULL,
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

CREATE TABLE `icon_file` (
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
    UNIQUE KEY uq_icon_file_storage_key (storage_key),
    KEY idx_icon_file_expiry (state, expires_at, id),
    KEY idx_icon_file_orphaned (state, orphaned_at, id),
    KEY idx_icon_file_uploader (uploaded_by_user_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
    summary VARCHAR(300) NOT NULL DEFAULT '',
    description MEDIUMTEXT NOT NULL,
    icon_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    icon_file_id BIGINT UNSIGNED NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    membership_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    archived_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    repositories_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_code (code),
    UNIQUE KEY uq_project_name (name),
    UNIQUE KEY uq_project_icon (icon_file_id),
    KEY idx_project_status_created (archived_at, created_at, id),
    KEY idx_project_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
    summary VARCHAR(300) NOT NULL DEFAULT '',
    description MEDIUMTEXT NOT NULL,
    icon_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    icon_file_id BIGINT UNSIGNED NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    membership_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    dissolved_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_team_code (code),
    UNIQUE KEY uq_team_name (name),
    UNIQUE KEY uq_team_icon (icon_file_id),
    KEY idx_team_status_created (dissolved_at, created_at, id),
    KEY idx_team_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project_member` (
    project_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'member',
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, user_id),
    KEY idx_project_member_user (user_id, project_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_member` (
    team_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'member',
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (team_id, user_id),
    KEY idx_team_member_user (user_id, team_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project_team` (
    project_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, team_id),
    KEY idx_project_team_team (team_id, project_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_sidebar_preference` (
    user_id BIGINT UNSIGNED NOT NULL,
    project_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    team_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_project_shortcut` (
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, project_id),
    KEY idx_user_project_shortcut_order (user_id, sort_order, project_id),
    KEY idx_user_project_shortcut_target (project_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_team_shortcut` (
    user_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, team_id),
    KEY idx_user_team_shortcut_order (user_id, sort_order, team_id),
    KEY idx_user_team_shortcut_target (team_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

CREATE TABLE `project_repository` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    connection_id BIGINT UNSIGNED NOT NULL,
    repo_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    name VARCHAR(255) NOT NULL,
    namespace_path VARCHAR(2048) NOT NULL DEFAULT '',
    full_path VARCHAR(2048) NOT NULL,
    web_url VARCHAR(2048) NULL,
    http_clone_url VARCHAR(2048) NULL,
    ssh_clone_url VARCHAR(2048) NULL,
    default_branch VARCHAR(1024) NULL,
    remote_archived BOOLEAN NULL,
    last_synced_at DATETIME(3) NOT NULL,
    last_sync_check JSON NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_repository_target (project_id, connection_id, repo_id),
    KEY idx_project_repository_project (project_id, id),
    KEY idx_project_repository_project_connection (project_id, connection_id, id),
    KEY idx_project_repository_connection (connection_id, id),
    KEY idx_project_repository_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_profile (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    secret_ciphertext TEXT NULL,
    secret_format_version BIGINT UNSIGNED NULL,
    secret_key_version VARCHAR(16) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_email_profile_code(code), UNIQUE KEY uq_email_profile_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE email_sender_name (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(id), UNIQUE KEY uq_email_sender_name(profile_id,name), KEY idx_email_sender_profile(profile_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE email_template (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_email_template_code(code), UNIQUE KEY uq_email_template_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE email_send_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    test_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    snapshot JSON NOT NULL,
    started_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_email_test(test_id),
    KEY idx_email_log_started(started_at,id),
    KEY idx_email_log_profile(profile_id,started_at,id),
    KEY idx_email_log_template(template_id,started_at,id),
    KEY idx_email_log_actor(actor_user_id,started_at,id),
    KEY idx_email_log_status(status,started_at,id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sms_profile (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    secret_ciphertext TEXT NULL,
    secret_format_version BIGINT UNSIGNED NULL,
    secret_key_version VARCHAR(16) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_sms_profile_code(code), UNIQUE KEY uq_sms_profile_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE sms_template (
    profile_id BIGINT UNSIGNED NULL,
    KEY idx_sms_template_profile(profile_id),
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_sms_template_code(code), UNIQUE KEY uq_sms_template_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE sms_send_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    test_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    profile_id BIGINT UNSIGNED NOT NULL,
    template_id BIGINT UNSIGNED NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    snapshot JSON NOT NULL,
    started_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY(id), UNIQUE KEY uq_sms_test(test_id),
    KEY idx_sms_log_started(started_at,id),
    KEY idx_sms_log_profile(profile_id,started_at,id),
    KEY idx_sms_log_template(template_id,started_at,id),
    KEY idx_sms_log_actor(actor_user_id,started_at,id),
    KEY idx_sms_log_status(status,started_at,id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE dingtalk_robot (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
    PRIMARY KEY(id), UNIQUE KEY uq_dingtalk_robot_code(code), UNIQUE KEY uq_dingtalk_robot_name(name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_branch_model (
    project_id BIGINT UNSIGNED NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    variants_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_branch_rule (
    project_id BIGINT UNSIGNED NOT NULL,
    branch_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    rule_mode VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
    rule_pattern VARCHAR(1024) COLLATE utf8mb4_0900_bin NULL,
    PRIMARY KEY (project_id, branch_type)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_variant (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    summary VARCHAR(300) NOT NULL DEFAULT '',
    kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    standard_slot TINYINT UNSIGNED NULL,
    main_branch VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    repository_scope JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    environments_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    archived_at DATETIME(3) NULL,
    release_tag_prefix VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_variant_code (project_id, code),
    UNIQUE KEY uq_project_variant_name (project_id, name),
    UNIQUE KEY uq_project_variant_standard (project_id, standard_slot),
    KEY idx_project_variant_archived (project_id, archived_at, id),
    KEY idx_project_variant_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_environment (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    summary VARCHAR(300) NOT NULL DEFAULT '',
    branch_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    branch_name VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    repository_scope JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_environment_code (variant_id, code),
    UNIQUE KEY uq_project_environment_name (variant_id, name),
    KEY idx_project_environment_project (project_id, variant_id, id),
    KEY idx_project_environment_type (project_id, branch_type, id),
    KEY idx_project_environment_creator (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_branch_check (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    subject_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    project_repository_id BIGINT UNSIGNED NOT NULL,
    branch_name VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    check_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    commit_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    is_protected BOOLEAN NULL,
    is_default BOOLEAN NULL,
    snapshot JSON NOT NULL,
    checked_by_user_id BIGINT UNSIGNED NOT NULL,
    started_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_branch_check_subject (subject_kind, subject_id, project_repository_id),
    KEY idx_project_branch_check_project (project_id, subject_kind, subject_id),
    KEY idx_project_branch_check_repository (project_repository_id, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_branch_creation (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NOT NULL,
    retry_of_id BIGINT UNSIGNED NULL,
    target_branch VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    default_source_branch VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    config_snapshot JSON NOT NULL,
    idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash BINARY(32) NOT NULL,
    execution_hash BINARY(32) NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_slot TINYINT UNSIGNED NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    lease_expires_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_branch_creation_request (project_id, created_by_user_id, idempotency_key),
    UNIQUE KEY uq_project_branch_creation_active (variant_id, active_slot),
    KEY idx_project_branch_creation_project (project_id, created_at, id),
    KEY idx_project_branch_creation_variant (variant_id, created_at, id),
    KEY idx_project_branch_creation_lease (status, lease_expires_at, id),
    KEY idx_project_branch_creation_expiry (status, expires_at, id),
    KEY idx_project_branch_creation_retry (retry_of_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_branch_creation_item (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    creation_id BIGINT UNSIGNED NOT NULL,
    project_repository_id BIGINT UNSIGNED NOT NULL,
    repository_version BIGINT UNSIGNED NOT NULL,
    connection_id BIGINT UNSIGNED NOT NULL,
    repo_id VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL,
    repository_path VARCHAR(2048) COLLATE utf8mb4_0900_bin NOT NULL,
    source_branch VARCHAR(1024) COLLATE utf8mb4_0900_bin NULL,
    source_commit_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    preview_target_commit_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    preview_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    preview_reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    remote_snapshot JSON NOT NULL,
    action VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
    reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    result_commit_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reconciliation JSON NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_branch_creation_item_repo (creation_id, project_repository_id),
    KEY idx_project_branch_creation_item_status (creation_id, status, id),
    KEY idx_project_branch_creation_item_repository (project_repository_id, creation_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL DEFAULT '',
    version_label VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tag_name VARCHAR(192) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    variant_snapshot JSON NOT NULL,
    description_md MEDIUMTEXT NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_slot TINYINT UNSIGNED NULL,
    current_manifest_id BIGINT UNSIGNED NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    end_reason TEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_version (variant_id, version_label),
    UNIQUE KEY uq_release_tag (variant_id, tag_name),
    UNIQUE KEY uq_release_active (variant_id, active_slot),
    KEY idx_release_list (project_id, variant_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_repository (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    release_id BIGINT UNSIGNED NOT NULL,
    project_repository_id BIGINT UNSIGNED NOT NULL,
    connection_id BIGINT UNSIGNED NOT NULL,
    repo_id VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL,
    repository_path VARCHAR(2048) COLLATE utf8mb4_0900_bin NOT NULL,
    branch_name VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    remote_key BINARY(32) NOT NULL,
    active_remote_key BINARY(32) NULL,
    in_scope BOOLEAN NOT NULL,
    baseline_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    baseline_ref VARCHAR(1024) COLLATE utf8mb4_0900_bin NULL,
    baseline_sha VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    baseline_at DATETIME(3) NULL,
    baseline_actor_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_repository (release_id, project_repository_id),
    UNIQUE KEY uq_release_remote_lock (active_remote_key),
    KEY idx_release_repo_history (remote_key, release_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_change (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    release_id BIGINT UNSIGNED NOT NULL,
    release_repository_id BIGINT UNSIGNED NOT NULL,
    change_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    remote_ref VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    disposition VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reverted_by_change_id BIGINT UNSIGNED NULL,
    evidence JSON NOT NULL,
    note TEXT NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_change (release_repository_id, change_kind, remote_ref),
    KEY idx_release_changes (release_id, id),
    KEY idx_release_reverts (reverted_by_change_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_item (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    release_id BIGINT UNSIGNED NOT NULL,
    kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    current_revision_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    sql_position INT UNSIGNED NULL,
    removed_at DATETIME(3) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_release_item_list (release_id, kind, removed_at, sql_position, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_file (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    release_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    origin_revision_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    storage_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    sha256 BINARY(32) NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_file_key (storage_key),
    KEY idx_release_file_cleanup (state, created_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_revision (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    revision_no INT UNSIGNED NOT NULL,
    file_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    release_repository_id BIGINT UNSIGNED NULL,
    filename VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL,
    description_md MEDIUMTEXT NOT NULL,
    database_name VARCHAR(255) COLLATE utf8mb4_0900_bin NULL,
    bucket_name VARCHAR(255) COLLATE utf8mb4_0900_bin NULL,
    target_path VARCHAR(1024) COLLATE utf8mb4_0900_bin NULL,
    config_format VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
    config_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_revision_no (item_id, revision_no),
    KEY idx_release_revision_file (file_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_manifest (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    release_id BIGINT UNSIGNED NOT NULL,
    sequence_no INT UNSIGNED NOT NULL,
    format_version SMALLINT UNSIGNED NOT NULL,
    header JSON NOT NULL,
    digest BINARY(32) NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    decision VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reviewer_id BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(3) NULL,
    review_note TEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_manifest_version (release_id, sequence_no)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_manifest_entry (
    manifest_id BIGINT UNSIGNED NOT NULL,
    kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    revision_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    sort_order INT UNSIGNED NOT NULL,
    snapshot JSON NOT NULL,
    PRIMARY KEY (manifest_id, kind, subject_id),
    KEY idx_release_manifest_order (manifest_id, kind, sort_order, subject_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_operation (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    release_id BIGINT UNSIGNED NOT NULL,
    manifest_id BIGINT UNSIGNED NULL,
    kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_slot TINYINT UNSIGNED NULL,
    idempotency_key VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_digest BINARY(32) NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_op_request (release_id, actor_user_id, idempotency_key),
    UNIQUE KEY uq_release_op_active (release_id, active_slot)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_release_operation_step (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operation_id BIGINT UNSIGNED NOT NULL,
    release_repository_id BIGINT UNSIGNED NOT NULL,
    step_no INT UNSIGNED NOT NULL,
    kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    intent JSON NOT NULL,
    observed JSON NULL,
    reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    attempt_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_release_op_step (operation_id, step_no),
    KEY idx_release_step_lease (status, lease_until, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
