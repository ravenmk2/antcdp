-- Reading copy of 00014_agent_runtime.sql; execute embedded migrations instead.

CREATE TABLE `agent_session_preference` (
    user_id BIGINT UNSIGNED NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_at DATETIME(3) NULL,
    viewed_through_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    viewed_at DATETIME(3) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, session_id),
    KEY idx_agent_session_preference_order (user_id, pinned, pinned_at, session_id),
    KEY idx_agent_session_preference_session (session_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
