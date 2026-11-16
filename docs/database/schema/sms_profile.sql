-- Reading copy of 00006_messaging.sql; execute embedded migrations instead.

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
