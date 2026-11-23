-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE `agent` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    greeting VARCHAR(1000) NOT NULL DEFAULT '',
    agent_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'chat | service',
    executor_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    use_policy VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_id BIGINT UNSIGNED NULL,
    robot_user_id BIGINT UNSIGNED NULL,
    scope_key BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(scope_id,0)) STORED,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    system_prompt MEDIUMTEXT NOT NULL,
    config_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    default_model_binding_id BIGINT UNSIGNED NULL,
    runtime_policy JSON NOT NULL,
    config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_scope_code (scope_kind,scope_key,code),
    UNIQUE KEY uq_agent_robot (robot_user_id),
    KEY idx_agent_catalog (agent_type, enabled, deleted_at, id),
    KEY idx_agent_scope (scope_kind, scope_id, deleted_at, id),
    KEY idx_agent_model (default_model_binding_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agent_use_grant (
    agent_id BIGINT UNSIGNED NOT NULL,
    subject_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id BIGINT UNSIGNED NOT NULL,
    granted_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (agent_id,subject_kind,subject_id),
    KEY idx_agent_use_subject (subject_kind,subject_id,agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_favorite` (
    user_id BIGINT UNSIGNED NOT NULL,
    agent_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, agent_id),
    KEY idx_agent_favorite_order (user_id, created_at, agent_id),
    KEY idx_agent_favorite_agent (agent_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_model_binding` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id BIGINT UNSIGNED NOT NULL,
    model_definition_id BIGINT UNSIGNED NOT NULL,
    thinking_options JSON NOT NULL,
    default_thinking VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    generation_parameters JSON NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    removed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_model_binding (agent_id, model_definition_id),
    KEY idx_agent_model_target (model_definition_id, agent_id),
    KEY idx_agent_model_binding_current (agent_id, removed_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_mcp_binding` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id BIGINT UNSIGNED NOT NULL,
    mcp_server_id BIGINT UNSIGNED NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    removed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_mcp_binding (agent_id, mcp_server_id),
    KEY idx_agent_mcp_binding_server (mcp_server_id, agent_id),
    KEY idx_agent_mcp_binding_current (agent_id, removed_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_tool_binding` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id BIGINT UNSIGNED NOT NULL,
    tool_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tool_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    policy VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    parameter_constraints JSON NOT NULL,
    config JSON NOT NULL,
    config_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    removed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_tool_binding_key (agent_id, tool_key),
    KEY idx_agent_tool_binding_current (agent_id, removed_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_papi_grant` (
    agent_id BIGINT UNSIGNED NOT NULL,
    api_code VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    parameter_constraints JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (agent_id, api_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_skill_binding` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id BIGINT UNSIGNED NOT NULL,
    skill_id BIGINT UNSIGNED NOT NULL,
    skill_version_id BIGINT UNSIGNED NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_skill_binding (agent_id, skill_id),
    KEY idx_agent_skill_binding_version (skill_version_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agent_skill` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(1024) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_skill_name (name),
    KEY idx_agent_skill_enabled (enabled, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

CREATE TABLE `agent_mcp_server` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    url VARCHAR(2048) NOT NULL,
    auth_method VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    auth_header_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    identity_config JSON NOT NULL,
    timeout_seconds INT UNSIGNED NOT NULL,
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
    UNIQUE KEY uq_agent_mcp_server_code (code),
    UNIQUE KEY uq_agent_mcp_server_name (name),
    KEY idx_agent_mcp_server_enabled (enabled, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
