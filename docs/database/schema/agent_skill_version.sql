-- Reading copy of 00011_agent_definitions.sql; execute embedded migrations instead.

CREATE TABLE `agent_skill_version` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    skill_id BIGINT UNSIGNED NOT NULL,
    version_label VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    upload_operation_id BIGINT UNSIGNED NOT NULL,
    archive_file_id BIGINT UNSIGNED NOT NULL,
    archive_sha256 BINARY(32) NOT NULL,
    content_sha256 BINARY(32) NOT NULL,
    expanded_size_bytes BIGINT UNSIGNED NOT NULL,
    file_count INT UNSIGNED NOT NULL,
    manifest_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    manifest JSON NOT NULL,
    frontmatter JSON NOT NULL,
    validation_report JSON NOT NULL,
    change_note VARCHAR(2000) NOT NULL DEFAULT '',
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    deleted_at DATETIME(3) NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_skill_version_label (skill_id, version_label),
    UNIQUE KEY uq_agent_skill_version_upload (upload_operation_id),
    KEY idx_agent_skill_version_archive (archive_file_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
