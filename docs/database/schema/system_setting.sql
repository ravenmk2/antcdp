-- Reading copy of 00001_platform.sql; execute embedded migrations instead.

CREATE TABLE `system_setting` (
    `name` VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `value` JSON NOT NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
