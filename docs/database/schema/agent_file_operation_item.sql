-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_file_operation_item` (
    operation_id BIGINT UNSIGNED NOT NULL,
    ordinal INT UNSIGNED NOT NULL,
    source_kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_reference_id BIGINT UNSIGNED NULL,
    source_file_id BIGINT UNSIGNED NULL,
    source_path VARCHAR(1024) COLLATE utf8mb4_0900_bin NULL,
    destination_path VARCHAR(1024) COLLATE utf8mb4_0900_bin NULL,
    publication_token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expected_sha256 BINARY(32) NULL,
    observed_sha256 BINARY(32) NULL,
    observed_size_bytes BIGINT UNSIGNED NULL,
    staged_file_id BIGINT UNSIGNED NULL,
    artifact_id BIGINT UNSIGNED NULL,
    state VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    verified_at DATETIME(3) NULL,
    published_at DATETIME(3) NULL,
    error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (operation_id, ordinal),
    UNIQUE KEY uq_agent_file_item_publication (publication_token),
    KEY idx_agent_file_item_source (source_file_id, state),
    KEY idx_agent_file_item_staged (staged_file_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
