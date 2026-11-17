-- +goose NO TRANSACTION
-- +goose Up

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

CREATE TABLE `event_consumption` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 subscription_id BIGINT UNSIGNED NOT NULL,
 revision_id BIGINT UNSIGNED NOT NULL,
 scope_ref_id BIGINT UNSIGNED NOT NULL,
 queue_seq BIGINT UNSIGNED NOT NULL,
 status VARCHAR(24) NOT NULL,
 attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
 started_at DATETIME(3) NULL,
 deadline_at DATETIME(3) NULL,
 next_retry_at DATETIME(3) NULL,
 finished_at DATETIME(3) NULL,
 error_code VARCHAR(64) NOT NULL DEFAULT '',
 error_summary TEXT NOT NULL,
 result JSON NOT NULL,
 has_result BOOLEAN NOT NULL DEFAULT FALSE,
 retry_of_id BIGINT UNSIGNED NULL,
 operator_user_id BIGINT UNSIGNED NULL,
 automatic_scope_ref_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN retry_of_id IS NULL THEN scope_ref_id ELSE NULL END) STORED,
 last_log_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_log_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_log_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_logs_truncated BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_event_consumption_queue(subscription_id,queue_seq),
 UNIQUE KEY uq_event_consumption_automatic(subscription_id,automatic_scope_ref_id),
 UNIQUE KEY uq_event_consumption_retry(retry_of_id),
 KEY idx_event_consumption_reference(scope_ref_id,id),
 KEY idx_event_consumption_status(status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_consumption_log` (
 consumption_id BIGINT UNSIGNED NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 attempt_no INT UNSIGNED NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 kind VARCHAR(24) NOT NULL,
 level VARCHAR(16) NOT NULL,
 message TEXT NOT NULL,
 fields JSON NOT NULL,
 PRIMARY KEY(consumption_id,seq),
 KEY idx_event_consumption_attempt(consumption_id,attempt_no,seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
