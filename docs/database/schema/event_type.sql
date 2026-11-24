-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_type` (
 id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_group VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 description VARCHAR(1000) NOT NULL,
 origin VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(id),
 KEY idx_event_type_group(event_group,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
