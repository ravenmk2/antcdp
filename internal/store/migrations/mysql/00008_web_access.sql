-- +goose NO TRANSACTION
-- +goose Up

-- 网络检索提供商：名称、类型、端点、专用认证及分能力最近诊断。
CREATE TABLE `web_access_provider` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    provider_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    base_url VARCHAR(2048) NOT NULL,
    auth_method VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    identity_config JSON NOT NULL,
    supported_operations JSON NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    secret_ciphertext BLOB NULL,
    secret_format_version INT UNSIGNED NULL,
    secret_key_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    secret_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    last_diagnostic JSON NULL,
    last_diagnostic_at DATETIME(3) NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_web_access_provider_code (code),
    UNIQUE KEY uq_web_access_provider_name (name),
    KEY idx_web_access_provider_enabled (enabled, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 检索设置：全平台搜索与读取的执行顺序及调用限制。
CREATE TABLE `web_access_setting` (
    id TINYINT UNSIGNED NOT NULL,
    search_routes JSON NOT NULL,
    search_max_results SMALLINT UNSIGNED NOT NULL,
    fetch_routes JSON NOT NULL,
    fetch_max_bytes INT UNSIGNED NOT NULL,
    fetch_timeout_seconds INT UNSIGNED NOT NULL,
    fetch_max_redirects TINYINT UNSIGNED NOT NULL,
    fetch_allowed_internal_hosts JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO web_access_setting(id,search_routes,search_max_results,fetch_routes,fetch_max_bytes,fetch_timeout_seconds,fetch_max_redirects,fetch_allowed_internal_hosts,row_version,updated_by_user_id,created_at,updated_at)
VALUES(1,JSON_ARRAY(),5,JSON_ARRAY(),2097152,20,3,JSON_ARRAY(),1,NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
