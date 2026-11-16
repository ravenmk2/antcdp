-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

CREATE TABLE `user_team_shortcut` (
    user_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, team_id),
    KEY idx_user_team_shortcut_order (user_id, sort_order, team_id),
    KEY idx_user_team_shortcut_target (team_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
