-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_event` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id BIGINT UNSIGNED NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    schema_version INT UNSIGNED NOT NULL,
    semantic_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
    payload JSON NOT NULL,
    payload_sha256 BINARY(32) NOT NULL,
    payload_size_bytes INT UNSIGNED NOT NULL,
    occurred_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_event_seq (session_id, seq),
    UNIQUE KEY uq_agent_event_semantic (session_id, semantic_key),
    KEY idx_agent_event_run (run_id, seq)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
