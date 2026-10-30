-- AntCDP complete target schema: 23 business tables, MySQL 8.0.16+ / InnoDB.
-- Phase A: 7 tables. Collaboration/sidebar: 9 tables. Integrations: 3 tables. Remote hosts: 3 tables.
-- Runtime migration 8 includes project repositories.
-- Includes project.repositories_version and project_repository. No physical FK/CHECK rules.
-- This file is a review snapshot, NOT an upgrade migration or proof of deployment.
-- Review reference only. Runtime migrations live in internal/store/migrations/mysql/.
-- Designed for an empty schema; do not import into an existing installation.
-- No default accounts, seed data or secrets. Actual execution uses goose migrations.
-- MySQL DDL implicitly commits; this file is not an atomic installation transaction.
-- Application timestamps are UTC. Configure each connection with time_zone = '+00:00'.

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

-- Collaboration schema: implemented by goose migration 00002_collaboration.sql.
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
    repositories_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    archived_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
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

-- Application rules: full code regex, trim/name validation, icon-key allowlist,
-- actor permissions, lifecycle write restrictions and initial administrator(s).
-- Lock icon_file before staged -> attached to enforce single binding across
-- project and team. The two per-table UNIQUE indexes alone are insufficient.
-- Zero members/admins are legal after creation; do not add count constraints.

-- Account-scoped sidebar state; versions exist even when both groups are empty.
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

-- sort_order is deliberately not UNIQUE: transactionally reorder a group,
-- with target ID as deterministic tie-breaker. No membership role is stored.
-- Lock preference row and validate the matching group version on every write.
-- Foreign keys do not prove membership; service checks all effective sources.
-- Backfill preference rows for non-deleted users in the future upgrade migration;
-- create a row in each new-account transaction. No data seeds in this reference.

-- Service integrations target design (2026-10-29), see docs/service-integrations.md.
-- Final runtime migration 6 reference; this file is not an executable migration.
-- ServiceType/ServiceAdapter are code registrations; notification channels,
-- workflow definitions, execution records and event inboxes are out of scope.
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

-- Exactly one extension for a GitLab connection. The parent owns the aggregate
-- row_version and config_version; webhook_version is independent. Create/delete atomically.
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

-- The three integration tables have logical references only: no FK or CHECK constraints.
-- Service transactions validate existence, immutable type/ownership, flags,
-- positive versions, JSON structure/bounds and complete secret envelopes.
-- Credentials and webhook settings maintenance serialize on the connection parent row.
-- A connection can be deleted only after ALL credentials are gone; webhook settings are removed with it.
-- Disabling/deleting a credential clears preferred and fallback atomically;
-- changing preferred increments the row_version of every affected credential.
-- A NULL preferred_slot allows multiple non-preferred credentials per owner.
-- Diagnostic writes do not change edit versions, collection versions or updated_at.
-- Outbound credentials and inbound webhook secrets have distinct encryption
-- purposes and resource-bound AAD. Plaintext never belongs in configuration JSON.
-- No automatic event dispatch, durable inbox, replay or notification delivery.

-- Independent remote hosts, migration 7. Logical references only; no FK/CHECK.
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

-- Migration 8: multi-platform project Git repository associations.
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
