-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE `model_provider` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    icon_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    provider_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    base_url VARCHAR(2048) NOT NULL,
    auth_method VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    identity_config JSON NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSON NOT NULL,
    config_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    secret_ciphertext BLOB NULL,
    secret_format_version INT UNSIGNED NULL,
    secret_key_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    secret_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_model_provider_code (code),
    UNIQUE KEY uq_model_provider_name (name),
    KEY idx_model_provider_enabled (enabled, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 模型条目。provider+protocol+model_id 的路由身份不可原地替换；能力声明与实测分开。
CREATE TABLE `model_definition` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    provider_id BIGINT UNSIGNED NOT NULL,
    model_id VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL COMMENT '供应商模型标识；平台主键为 id',
    name VARCHAR(100) NOT NULL,
    icon_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    protocol VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    capabilities JSON NOT NULL,
    capability_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    generation_defaults JSON NOT NULL,
    thinking_options JSON NOT NULL COMMENT '系统档位解析后的 key/label/parameters；默认行为使用唯一 standard 选项',
    context_window_tokens INT UNSIGNED NULL,
    max_output_tokens INT UNSIGNED NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_model_definition_route (provider_id, protocol, model_id),
    KEY idx_model_definition_enabled (enabled, provider_id, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
