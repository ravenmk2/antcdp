-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_record` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 source_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_id BIGINT UNSIGNED NOT NULL,
 source_message_id VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NULL,
 source_event_type VARCHAR(128) NOT NULL,
 group_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version INT UNSIGNED NOT NULL,
 source_repository_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '',
 subject_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 subject_id VARCHAR(255) NOT NULL DEFAULT '',
 occurred_at DATETIME(3) NULL,
 received_at DATETIME(3) NOT NULL,
 data JSON NOT NULL,
 raw_payload MEDIUMBLOB NOT NULL,
 payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_metadata JSON NOT NULL,
 routing_result VARCHAR(24) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_event_source_message(source_kind,source_id,source_message_id),
 KEY idx_event_source(source_kind,source_id,id),
 KEY idx_event_type(event_type,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
