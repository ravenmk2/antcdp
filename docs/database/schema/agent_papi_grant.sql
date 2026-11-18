-- Reading copy of 00012_agent_definitions.sql; execute embedded migrations instead.

CREATE TABLE `agent_papi_grant` (
    agent_id BIGINT UNSIGNED NOT NULL,
    api_code VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    parameter_constraints JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (agent_id, api_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
