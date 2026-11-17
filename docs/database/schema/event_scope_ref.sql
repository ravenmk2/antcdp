-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_scope_ref` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 event_id BIGINT UNSIGNED NOT NULL,
 scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 scope_id BIGINT UNSIGNED NOT NULL,
 routing_basis JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_event_scope(event_id,scope_kind,scope_id),
 KEY idx_event_scope_history(scope_kind,scope_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
