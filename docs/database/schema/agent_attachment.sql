-- Reading copy of 00013_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_attachment` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    content_session_id BIGINT UNSIGNED NOT NULL,
    file_id BIGINT UNSIGNED NOT NULL,
    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
    filename VARCHAR(255) COLLATE utf8mb4_0900_bin NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    bound_input_id BIGINT UNSIGNED NULL,
    command_receipt_id BIGINT UNSIGNED NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NULL,
    bound_at DATETIME(3) NULL,
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agent_attachment_receipt (command_receipt_id),
    UNIQUE KEY uq_agent_attachment_file (file_id),
    KEY idx_agent_attachment_session (content_session_id, state, created_at, id),
    KEY idx_agent_attachment_expiry (state, expires_at, id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
