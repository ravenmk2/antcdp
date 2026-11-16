-- Reading copy of 00003_collaboration.sql; execute embedded migrations instead.

CREATE TABLE `role_binding` (
    role_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    assigned_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (role_id, user_id),
    KEY idx_role_binding_user (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
