-- Reading copy of 00014_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_command_receipt` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    command_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash BINARY(32) NOT NULL,
    status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    result JSON NULL,
    operation_id BIGINT UNSIGNED NULL,
    target_kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    target_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    retention_until DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_receipt_key (actor_kind, actor_id, scope_kind, scope_id, command_kind, idempotency_key),
    KEY idx_agent_receipt_target (target_kind, target_id, id),
    KEY idx_agent_receipt_operation (operation_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
