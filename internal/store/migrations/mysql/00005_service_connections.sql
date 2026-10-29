-- +goose Up
-- +goose NO TRANSACTION
-- Forward-only redesign. The old integration module is reset (no compatibility).
-- This removes ONLY old integration configurations/credentials; users, projects,
-- teams, audit history and installation identity are preserved. Back up before upgrade.
-- All final business tables retain keys/indexes, but no physical FK/CHECK rules.

CREATE TABLE `service_connection` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) COLLATE utf8mb4_0900_as_ci NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
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
    base_url VARCHAR(2048) NOT NULL,
    custom_ca_pem TEXT NULL,
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

ALTER TABLE `user` DROP CHECK `ck_user_username_length`;
ALTER TABLE `user` DROP CHECK `ck_user_display_name_length`;
ALTER TABLE `user` DROP CHECK `ck_user_role`;
ALTER TABLE `user` DROP CHECK `ck_user_status`;
ALTER TABLE `user` DROP CHECK `ck_user_deleted_status`;
ALTER TABLE `user` DROP CHECK `ck_user_versions`;
ALTER TABLE `user_password` DROP FOREIGN KEY `fk_user_password_user`;
ALTER TABLE `user_password` DROP CHECK `ck_user_password_require_change`;
ALTER TABLE `avatar_file` DROP FOREIGN KEY `fk_avatar_file_uploader`;
ALTER TABLE `avatar_file` DROP CHECK `ck_avatar_file_type`;
ALTER TABLE `avatar_file` DROP CHECK `ck_avatar_file_dimensions`;
ALTER TABLE `avatar_file` DROP CHECK `ck_avatar_file_size`;
ALTER TABLE `avatar_file` DROP CHECK `ck_avatar_file_state`;
ALTER TABLE `avatar_file` DROP CHECK `ck_avatar_file_lifecycle`;
ALTER TABLE `session` DROP FOREIGN KEY `fk_session_user`;
ALTER TABLE `session` DROP CHECK `ck_session_auth_version`;
ALTER TABLE `session` DROP CHECK `ck_session_ttl_days`;
ALTER TABLE `session` DROP CHECK `ck_session_seen`;
ALTER TABLE `session` DROP CHECK `ck_session_expiry`;
ALTER TABLE `system_setting` DROP CHECK `ck_system_setting_name_length`;
ALTER TABLE `system_setting` DROP CHECK `ck_system_setting_version`;
ALTER TABLE `system_instance` DROP FOREIGN KEY `fk_system_instance_founder`;
ALTER TABLE `system_instance` DROP CHECK `ck_system_instance_singleton`;
ALTER TABLE `audit_event` DROP FOREIGN KEY `fk_audit_event_actor`;
ALTER TABLE `audit_event` DROP CHECK `ck_audit_event_actor_type`;
ALTER TABLE `audit_event` DROP CHECK `ck_audit_event_detail`;
ALTER TABLE `icon_file` DROP FOREIGN KEY `fk_icon_file_uploader`;
ALTER TABLE `icon_file` DROP CHECK `ck_icon_file_type`;
ALTER TABLE `icon_file` DROP CHECK `ck_icon_file_dimensions`;
ALTER TABLE `icon_file` DROP CHECK `ck_icon_file_size`;
ALTER TABLE `icon_file` DROP CHECK `ck_icon_file_state`;
ALTER TABLE `icon_file` DROP CHECK `ck_icon_file_lifecycle`;
ALTER TABLE `project` DROP FOREIGN KEY `fk_project_creator`;
ALTER TABLE `project` DROP FOREIGN KEY `fk_project_icon`;
ALTER TABLE `project` DROP CHECK `ck_project_code_length`;
ALTER TABLE `project` DROP CHECK `ck_project_name_length`;
ALTER TABLE `project` DROP CHECK `ck_project_description_size`;
ALTER TABLE `project` DROP CHECK `ck_project_icon_choice`;
ALTER TABLE `project` DROP CHECK `ck_project_icon_key`;
ALTER TABLE `project` DROP CHECK `ck_project_versions`;
ALTER TABLE `team` DROP FOREIGN KEY `fk_team_creator`;
ALTER TABLE `team` DROP FOREIGN KEY `fk_team_icon`;
ALTER TABLE `team` DROP CHECK `ck_team_code_length`;
ALTER TABLE `team` DROP CHECK `ck_team_name_length`;
ALTER TABLE `team` DROP CHECK `ck_team_description_size`;
ALTER TABLE `team` DROP CHECK `ck_team_icon_choice`;
ALTER TABLE `team` DROP CHECK `ck_team_icon_key`;
ALTER TABLE `team` DROP CHECK `ck_team_versions`;
ALTER TABLE `project_member` DROP FOREIGN KEY `fk_project_member_object`;
ALTER TABLE `project_member` DROP FOREIGN KEY `fk_project_member_user`;
ALTER TABLE `project_member` DROP CHECK `ck_project_member_role`;
ALTER TABLE `team_member` DROP FOREIGN KEY `fk_team_member_object`;
ALTER TABLE `team_member` DROP FOREIGN KEY `fk_team_member_user`;
ALTER TABLE `team_member` DROP CHECK `ck_team_member_role`;
ALTER TABLE `project_team` DROP FOREIGN KEY `fk_project_team_project`;
ALTER TABLE `project_team` DROP FOREIGN KEY `fk_project_team_team`;
ALTER TABLE `user_sidebar_preference` DROP FOREIGN KEY `fk_user_sidebar_preference_user`;
ALTER TABLE `user_sidebar_preference` DROP CHECK `ck_user_sidebar_preference_versions`;
ALTER TABLE `user_project_shortcut` DROP FOREIGN KEY `fk_user_project_shortcut_preference`;
ALTER TABLE `user_project_shortcut` DROP FOREIGN KEY `fk_user_project_shortcut_target`;
ALTER TABLE `user_project_shortcut` DROP CHECK `ck_user_project_shortcut_order`;
ALTER TABLE `user_team_shortcut` DROP FOREIGN KEY `fk_user_team_shortcut_preference`;
ALTER TABLE `user_team_shortcut` DROP FOREIGN KEY `fk_user_team_shortcut_target`;
ALTER TABLE `user_team_shortcut` DROP CHECK `ck_user_team_shortcut_order`;
ALTER TABLE `user` DROP FOREIGN KEY `fk_user_avatar`;

DROP TABLE integration_credential;
DROP TABLE integration_gitlab;
DROP TABLE integration;

-- Roll back only by restoring a matched database/data backup.
