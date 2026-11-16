-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_run_context` (
    root_run_id BIGINT UNSIGNED NOT NULL,
    agent_id BIGINT UNSIGNED NOT NULL,
    executor_user_id BIGINT UNSIGNED NOT NULL,
    agent_config_version BIGINT UNSIGNED NOT NULL,
    schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    cloud_computer_id BIGINT UNSIGNED NULL,
    cwd VARCHAR(2048) NOT NULL,
    system_prompt MEDIUMTEXT NOT NULL,
    model_snapshot JSON NOT NULL,
    runtime_policy JSON NOT NULL,
    builtin_tools JSON NOT NULL,
    mcp_bindings JSON NOT NULL,
    resource_grants JSON NOT NULL,
    skill_manifest JSON NOT NULL,
    mcp_surface JSON NULL,
    mcp_prepared_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (root_run_id),
    KEY idx_agent_run_context_agent (agent_id, root_run_id),
    KEY idx_agent_run_context_executor (executor_user_id, root_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
