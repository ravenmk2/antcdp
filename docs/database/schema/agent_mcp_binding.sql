-- Reading copy of 00012_agent_definitions.sql; execute embedded migrations instead.

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
