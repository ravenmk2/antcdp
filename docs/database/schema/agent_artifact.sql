-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_artifact` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    content_session_id BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NOT NULL,
    tool_call_id BIGINT UNSIGNED NOT NULL,
    output_ordinal INT UNSIGNED NOT NULL,
    file_id BIGINT UNSIGNED NOT NULL,
    filename VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL,
    description TEXT NOT NULL,
    source_path VARCHAR(1024) COLLATE utf8mb4_0900_bin NOT NULL,
    source_snapshot JSON NOT NULL,
    retained_event_seq BIGINT UNSIGNED NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    deleted_at DATETIME(3) NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    deleted_event_seq BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_artifact_output (tool_call_id, output_ordinal),
    KEY idx_agent_artifact_session (content_session_id, deleted_at, created_at, id),
    KEY idx_agent_artifact_run (run_id, deleted_at, id),
    KEY idx_agent_artifact_file (file_id, deleted_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
