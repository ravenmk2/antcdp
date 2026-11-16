-- Reading copy of 00001_platform.sql; execute embedded migrations instead.

CREATE TABLE `user_password` (
    user_id BIGINT UNSIGNED NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    require_password_change BOOLEAN NOT NULL DEFAULT FALSE,
    password_changed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
