-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_subscription` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 scope_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 current_revision_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
 next_enqueue_seq BIGINT UNSIGNED NOT NULL DEFAULT 1,
 next_consume_seq BIGINT UNSIGNED NOT NULL DEFAULT 1,
 row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 updated_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 deleted_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 KEY idx_event_subscription_scope(scope_kind,scope_id,deleted_at,id),
 KEY idx_event_subscription_work(enabled,deleted_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
