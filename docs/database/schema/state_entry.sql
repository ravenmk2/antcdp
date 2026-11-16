-- Reading copy of 00002_state_store.sql; execute embedded migrations instead.

CREATE TABLE `state_entry` (
    `store_id` BIGINT UNSIGNED NOT NULL,
    `entry_key` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `value` MEDIUMBLOB NOT NULL,
    `etag` BINARY(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`store_id`, `entry_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
