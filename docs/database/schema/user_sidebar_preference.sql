-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

CREATE TABLE `user_sidebar_preference` (
    user_id BIGINT UNSIGNED NOT NULL,
    project_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    team_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
