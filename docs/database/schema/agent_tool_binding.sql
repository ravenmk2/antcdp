-- Reading copy of 00011_agent_definitions.sql; execute embedded migrations instead.

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
