-- Reading copy of 00009_sandboxes.sql; execute embedded migrations instead.

CREATE TABLE `sandbox_admin_command_receipt` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_id BIGINT UNSIGNED NOT NULL,
    scope_kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    command_kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash BINARY(32) NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    result JSON NULL,
    created_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sandbox_admin_command (actor_id,scope_kind,scope_id,command_kind,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
