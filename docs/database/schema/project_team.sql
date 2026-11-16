-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

CREATE TABLE `project_team` (
    project_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, team_id),
    KEY idx_project_team_team (team_id, project_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
