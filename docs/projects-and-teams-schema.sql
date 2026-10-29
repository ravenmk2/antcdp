-- Project/team and sidebar: nine-table REVIEW COPY. Not a runtime migration.
-- These definitions are also included verbatim in the complete docs/schema.sql.
-- Assumes phase A tables already exist; do not import into production.
-- Draft defaults and verification boundaries: projects-and-teams-detail.md.
-- MySQL 8.0.16+, InnoDB, UTC DATETIME(3). Application supplies timestamps.
-- Final structure after migration 5: keys/indexes only, no physical FK/CHECK rules. No seed data.

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
