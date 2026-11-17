-- Reading copy of 00011_events.sql; execute embedded migrations instead.

CREATE TABLE `event_subscription_revision` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 subscription_id BIGINT UNSIGNED NOT NULL,
 revision_no BIGINT UNSIGNED NOT NULL,
 event_types JSON NOT NULL,
 executor_user_id BIGINT UNSIGNED NOT NULL,
 script_api_version INT UNSIGNED NOT NULL,
 script MEDIUMTEXT NOT NULL,
 timeout_ms BIGINT UNSIGNED NOT NULL,
 max_retries INT UNSIGNED NOT NULL,
 retry_interval_ms BIGINT UNSIGNED NOT NULL,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_event_subscription_revision(subscription_id,revision_no),
 KEY idx_event_revision_executor(executor_user_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
