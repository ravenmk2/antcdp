-- Reading copy of 00014_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_compaction` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id BIGINT UNSIGNED NOT NULL,
    run_id BIGINT UNSIGNED NULL,
    command_receipt_id BIGINT UNSIGNED NULL,
    public_operation_id BIGINT UNSIGNED NULL,
    status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    from_seq BIGINT UNSIGNED NOT NULL,
    through_seq BIGINT UNSIGNED NOT NULL,
    source_surface_revision BIGINT UNSIGNED NOT NULL,
    source_manifest JSON NOT NULL,
    source_hash BINARY(32) NOT NULL,
    start_event_seq BIGINT UNSIGNED NOT NULL,
    summary_event_seq BIGINT UNSIGNED NULL,
    end_event_seq BIGINT UNSIGNED NULL,
    executor_epoch VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fence_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(3) NOT NULL,
    deadline_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_compaction_receipt (command_receipt_id),
    KEY idx_agent_compaction_session (session_id, created_at, id),
    KEY idx_agent_compaction_due (status, deadline_at, id),
    UNIQUE KEY uq_agent_compaction_public_operation (public_operation_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
