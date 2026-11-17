-- Reading copy of 00014_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_model_file` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cache_key BINARY(32) NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload JSON NOT NULL,
    lease_token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    lease_until DATETIME(3) NULL,
    last_used_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_model_file_key (cache_key),
    KEY idx_agent_model_file_expiry (last_used_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
