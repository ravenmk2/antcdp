-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_group` (
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 sort_order INT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
