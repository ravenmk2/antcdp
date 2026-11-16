-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

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
