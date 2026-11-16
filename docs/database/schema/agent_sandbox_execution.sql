-- Reading copy of 00014_agent_cloud_and_sandbox.sql; execute embedded migrations instead.

CREATE TABLE `agent_sandbox_execution` (
    sandbox_execution_id BIGINT UNSIGNED NOT NULL,
    root_run_id BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NOT NULL,
    tool_call_id BIGINT UNSIGNED NOT NULL,
    execution_ordinal BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (sandbox_execution_id),
    UNIQUE KEY uq_agent_sandbox_execution_call (tool_call_id,execution_ordinal),
    KEY idx_agent_sandbox_execution_root (root_run_id,sandbox_execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
