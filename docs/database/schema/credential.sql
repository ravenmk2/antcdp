-- Reading copy of 00004_integrations.sql; execute embedded migrations instead.

CREATE TABLE `credential` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scope_kind ENUM('platform','project','user','team') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    identifier VARCHAR(255) NOT NULL DEFAULT '',
    ciphertext MEDIUMBLOB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at DATETIME(3) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    material_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_credential_scope_code (scope_kind,scope_id,code)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
