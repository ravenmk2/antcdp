-- +goose Up
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


-- Preserve identities, version stamps and exact encrypted material. Format 1 keeps legacy AAD.
INSERT INTO remote_host(id,code,name,description,host,port,enabled,fallback_credential_id,row_version,config_version,credentials_version,fallback_version,last_connection_check,created_by_user_id,created_at,updated_at)
SELECT id,code,name,description,JSON_UNQUOTE(JSON_EXTRACT(config,'$.host')),COALESCE(JSON_EXTRACT(config,'$.port'),22),enabled,fallback_credential_id,row_version,config_version,credentials_version,fallback_version,last_connection_check,created_by_user_id,created_at,updated_at FROM service_connection WHERE service_type='ssh';
INSERT INTO remote_host_key(host_id,algorithm,public_key,fingerprint_sha256,trusted_by_user_id,trusted_at)
SELECT s.id,SUBSTRING_INDEX(k.public_key,' ',1),k.public_key,CONCAT('SHA256:',TRIM(TRAILING '=' FROM TO_BASE64(UNHEX(SHA2(FROM_BASE64(SUBSTRING_INDEX(SUBSTRING_INDEX(k.public_key,' ',2),' ',-1)),256))))),NULL,NULL
FROM service_connection s JOIN JSON_TABLE(s.config,'$.host_keys[*]' COLUMNS(public_key VARCHAR(8192) PATH '$')) k WHERE s.service_type='ssh';
INSERT INTO remote_host_credential(id,host_id,code,ownership_type,project_id,user_id,name,description,auth_method,username,secret_ciphertext,secret_format_version,secret_key_version,enabled,is_preferred,expires_at,row_version,material_version,last_verification,created_by_user_id,created_at,updated_at)
SELECT id,connection_id,code,ownership_type,project_id,user_id,name,description,auth_method,JSON_UNQUOTE(JSON_EXTRACT(identity_config,'$.username')),secret_ciphertext,secret_format_version,secret_key_version,enabled,is_preferred,expires_at,row_version,material_version,last_verification,created_by_user_id,created_at,updated_at FROM service_credential WHERE service_type='ssh';
DELETE FROM service_credential WHERE service_type='ssh';
DELETE FROM service_connection WHERE service_type='ssh';
-- +goose Down
-- Deliberately irreversible: restore matching database/data backups for recovery.
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Remote host migration requires matching backup recovery';
