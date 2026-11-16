-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

CREATE TABLE `user_project_shortcut` (
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, project_id),
    KEY idx_user_project_shortcut_order (user_id, sort_order, project_id),
    KEY idx_user_project_shortcut_target (project_id, user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
