-- AntCDP complete target schema: 19 business tables, MySQL 8.0.16+ / InnoDB.
-- Phase A: 7 existing tables. Collaboration/sidebar: 9 migrated; feature implementation in progress.
-- Integrations: 3 proposed tables, NOT migrated or runtime-validated.
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
    KEY idx_user_deleted_role (deleted_at, role, created_at, id),
    CONSTRAINT ck_user_username_length CHECK (CHAR_LENGTH(username) BETWEEN 3 AND 30),
    CONSTRAINT ck_user_display_name_length CHECK (CHAR_LENGTH(display_name) BETWEEN 1 AND 30),
    CONSTRAINT ck_user_role CHECK (role IN ('admin', 'user')),
    CONSTRAINT ck_user_status CHECK (status IN ('active', 'disabled')),
    CONSTRAINT ck_user_deleted_status CHECK (deleted_at IS NULL OR status = 'disabled'),
    CONSTRAINT ck_user_versions CHECK (auth_version >= 1 AND row_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_password` (
    user_id BIGINT UNSIGNED NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    require_password_change BOOLEAN NOT NULL DEFAULT FALSE,
    password_changed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_password_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
    CONSTRAINT ck_user_password_require_change CHECK (require_password_change IN (0, 1))
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
    KEY idx_avatar_file_uploader (uploaded_by_user_id, created_at, id),
    CONSTRAINT fk_avatar_file_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_avatar_file_type CHECK (content_type = 'image/png'),
    CONSTRAINT ck_avatar_file_dimensions CHECK (width = 256 AND height = 256),
    CONSTRAINT ck_avatar_file_size CHECK (size_bytes BETWEEN 1 AND 524288),
    CONSTRAINT ck_avatar_file_state CHECK (state IN ('staged', 'attached', 'orphaned')),
    CONSTRAINT ck_avatar_file_lifecycle CHECK (
        (state = 'staged' AND expires_at IS NOT NULL AND orphaned_at IS NULL)
        OR (state = 'attached' AND expires_at IS NULL AND orphaned_at IS NULL)
        OR (state = 'orphaned' AND expires_at IS NULL AND orphaned_at IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `user`
    ADD CONSTRAINT fk_user_avatar FOREIGN KEY (avatar_file_id) REFERENCES `avatar_file` (id) ON DELETE RESTRICT;

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
    KEY idx_session_expiry (expires_at, id),
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
    CONSTRAINT ck_session_auth_version CHECK (auth_version >= 1),
    CONSTRAINT ck_session_ttl_days CHECK (ttl_days BETWEEN 1 AND 30),
    CONSTRAINT ck_session_seen CHECK (last_seen_at >= created_at),
    CONSTRAINT ck_session_expiry CHECK (expires_at > last_seen_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `system_setting` (
    `name` VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `value` JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (`name`),
    CONSTRAINT ck_system_setting_name_length CHECK (CHAR_LENGTH(`name`) BETWEEN 3 AND 96),
    CONSTRAINT ck_system_setting_version CHECK (row_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `system_instance` (
    id TINYINT UNSIGNED NOT NULL,
    installation_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    founder_user_id BIGINT UNSIGNED NOT NULL,
    key_fingerprint BINARY(32) NOT NULL,
    installed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_system_instance_installation (installation_id),
    KEY idx_system_instance_founder (founder_user_id),
    CONSTRAINT fk_system_instance_founder FOREIGN KEY (founder_user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_system_instance_singleton CHECK (id = 1)
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
    KEY idx_audit_event_target_time (target_type, target_id, occurred_at, id),
    CONSTRAINT fk_audit_event_actor FOREIGN KEY (actor_user_id) REFERENCES `user` (id) ON DELETE SET NULL,
    CONSTRAINT ck_audit_event_actor_type CHECK (actor_type IN ('user', 'system')),
    CONSTRAINT ck_audit_event_detail CHECK (detail IS NULL OR JSON_TYPE(detail) = 'OBJECT')
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
    KEY idx_icon_file_uploader (uploaded_by_user_id, created_at, id),
    CONSTRAINT fk_icon_file_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_icon_file_type CHECK (content_type = 'image/png'),
    CONSTRAINT ck_icon_file_dimensions CHECK (width = 256 AND height = 256),
    CONSTRAINT ck_icon_file_size CHECK (size_bytes BETWEEN 1 AND 524288),
    CONSTRAINT ck_icon_file_state CHECK (state IN ('staged', 'attached', 'orphaned')),
    CONSTRAINT ck_icon_file_lifecycle CHECK (
        (state = 'staged' AND expires_at IS NOT NULL AND orphaned_at IS NULL)
        OR (state = 'attached' AND expires_at IS NULL AND orphaned_at IS NULL)
        OR (state = 'orphaned' AND expires_at IS NULL AND orphaned_at IS NOT NULL)
    )
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
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_code (code),
    UNIQUE KEY uq_project_name (name),
    UNIQUE KEY uq_project_icon (icon_file_id),
    KEY idx_project_status_created (archived_at, created_at, id),
    KEY idx_project_creator (created_by_user_id),
    CONSTRAINT fk_project_creator FOREIGN KEY (created_by_user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT fk_project_icon FOREIGN KEY (icon_file_id) REFERENCES icon_file (id) ON DELETE RESTRICT,
    CONSTRAINT ck_project_code_length CHECK (CHAR_LENGTH(code) BETWEEN 2 AND 64),
    CONSTRAINT ck_project_name_length CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 100),
    CONSTRAINT ck_project_description_size CHECK (OCTET_LENGTH(description) <= 102400),
    CONSTRAINT ck_project_icon_choice CHECK (icon_key IS NULL OR icon_file_id IS NULL),
    CONSTRAINT ck_project_icon_key CHECK (icon_key IS NULL OR CHAR_LENGTH(icon_key) BETWEEN 1 AND 64),
    CONSTRAINT ck_project_versions CHECK (row_version >= 1 AND membership_version >= 1)
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
    KEY idx_team_creator (created_by_user_id),
    CONSTRAINT fk_team_creator FOREIGN KEY (created_by_user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT fk_team_icon FOREIGN KEY (icon_file_id) REFERENCES icon_file (id) ON DELETE RESTRICT,
    CONSTRAINT ck_team_code_length CHECK (CHAR_LENGTH(code) BETWEEN 2 AND 64),
    CONSTRAINT ck_team_name_length CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 100),
    CONSTRAINT ck_team_description_size CHECK (OCTET_LENGTH(description) <= 102400),
    CONSTRAINT ck_team_icon_choice CHECK (icon_key IS NULL OR icon_file_id IS NULL),
    CONSTRAINT ck_team_icon_key CHECK (icon_key IS NULL OR CHAR_LENGTH(icon_key) BETWEEN 1 AND 64),
    CONSTRAINT ck_team_versions CHECK (row_version >= 1 AND membership_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project_member` (
    project_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'member',
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, user_id),
    KEY idx_project_member_user (user_id, project_id),
    CONSTRAINT fk_project_member_object FOREIGN KEY (project_id) REFERENCES `project` (id) ON DELETE RESTRICT,
    CONSTRAINT fk_project_member_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_project_member_role CHECK (role IN ('admin', 'member'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `team_member` (
    team_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'member',
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (team_id, user_id),
    KEY idx_team_member_user (user_id, team_id),
    CONSTRAINT fk_team_member_object FOREIGN KEY (team_id) REFERENCES `team` (id) ON DELETE RESTRICT,
    CONSTRAINT fk_team_member_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_team_member_role CHECK (role IN ('admin', 'member'))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project_team` (
    project_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, team_id),
    KEY idx_project_team_team (team_id, project_id),
    CONSTRAINT fk_project_team_project FOREIGN KEY (project_id) REFERENCES `project` (id) ON DELETE RESTRICT,
    CONSTRAINT fk_project_team_team FOREIGN KEY (team_id) REFERENCES `team` (id) ON DELETE RESTRICT
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
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_sidebar_preference_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_user_sidebar_preference_versions CHECK (project_version >= 1 AND team_version >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_project_shortcut` (
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, project_id),
    KEY idx_user_project_shortcut_order (user_id, sort_order, project_id),
    KEY idx_user_project_shortcut_target (project_id, user_id),
    CONSTRAINT fk_user_project_shortcut_preference FOREIGN KEY (user_id) REFERENCES user_sidebar_preference (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_project_shortcut_target FOREIGN KEY (project_id) REFERENCES `project` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_user_project_shortcut_order CHECK (sort_order >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_team_shortcut` (
    user_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, team_id),
    KEY idx_user_team_shortcut_order (user_id, sort_order, team_id),
    KEY idx_user_team_shortcut_target (team_id, user_id),
    CONSTRAINT fk_user_team_shortcut_preference FOREIGN KEY (user_id) REFERENCES user_sidebar_preference (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_team_shortcut_target FOREIGN KEY (team_id) REFERENCES `team` (id) ON DELETE RESTRICT,
    CONSTRAINT ck_user_team_shortcut_order CHECK (sort_order >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- sort_order is deliberately not UNIQUE: transactionally reorder a group,
-- with target ID as deterministic tie-breaker. No membership role is stored.
-- Lock preference row and validate the matching group version on every write.
-- Foreign keys do not prove membership; service checks all effective sources.
-- Backfill preference rows for non-deleted users in the future upgrade migration;
-- create a row in each new-account transaction. No data seeds in this reference.

-- External integrations: review-only target, see docs/service-integrations.md.
-- No credential-set or separate secret table. Encrypted envelopes belong to
-- their service extension (inbound verification) or credential (outbound identity).
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
