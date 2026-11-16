-- Reading copy of 00004_integrations.sql; execute embedded migrations instead.

CREATE TABLE `service_connection_grant` (
    connection_id BIGINT UNSIGNED NOT NULL,
    subject_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (connection_id, subject_kind, subject_id),
    KEY idx_service_connection_grant_subject (subject_kind, subject_id, enabled, connection_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
