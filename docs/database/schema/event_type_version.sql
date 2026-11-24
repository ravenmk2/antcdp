-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_type_version` (
 event_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version INT UNSIGNED NOT NULL,
 data_schema JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(event_type,schema_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
