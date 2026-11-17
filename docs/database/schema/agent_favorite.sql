-- Reading copy of 00012_agent_definitions.sql; execute embedded migrations instead.

CREATE TABLE `agent_favorite` (
    user_id BIGINT UNSIGNED NOT NULL,
    agent_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, agent_id),
    KEY idx_agent_favorite_order (user_id, created_at, agent_id),
    KEY idx_agent_favorite_agent (agent_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
