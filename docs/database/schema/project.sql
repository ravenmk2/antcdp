-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

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
