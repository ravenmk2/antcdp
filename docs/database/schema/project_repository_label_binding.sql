-- Reading copy of 00010_delivery.sql; execute embedded migrations instead.

CREATE TABLE project_repository_label_binding (
    project_repository_id BIGINT UNSIGNED NOT NULL,
    label_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_repository_id, label_id),
    KEY idx_repository_label_binding_label (label_id, project_repository_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
