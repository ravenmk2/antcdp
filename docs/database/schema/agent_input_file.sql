-- Reading copy of 00014_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_input_file` (
    input_id BIGINT UNSIGNED NOT NULL,
    ordinal INT UNSIGNED NOT NULL,
    reference_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reference_id BIGINT UNSIGNED NOT NULL,
    file_id BIGINT UNSIGNED NOT NULL,
    content_session_id BIGINT UNSIGNED NOT NULL,
    source_sha256 BINARY(32) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (input_id, ordinal),
    UNIQUE KEY uq_agent_input_file_reference (input_id, reference_kind, reference_id),
    KEY idx_agent_input_file_target (file_id, input_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
