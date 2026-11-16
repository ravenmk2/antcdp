-- Reading copy of 00002_state_store.sql; execute embedded migrations instead.

CREATE TABLE `state_store` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `namespace` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `name` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `display_name` VARCHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_state_store_namespace_name` (`namespace`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
