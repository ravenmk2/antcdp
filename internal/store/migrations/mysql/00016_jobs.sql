-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE job (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'project',
 scope_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 current_revision_id BIGINT UNSIGNED NULL,
 max_concurrency INT UNSIGNED NOT NULL DEFAULT 1,
 busy_policy VARCHAR(16) NOT NULL DEFAULT 'queue',
 timeout_ms BIGINT UNSIGNED NOT NULL DEFAULT 1800000,
 row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_job_scope_code(scope_kind,scope_id,code), KEY idx_job_scope(scope_kind,scope_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_revision (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
 run_as_user_id BIGINT UNSIGNED NOT NULL,
 content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 script MEDIUMTEXT NOT NULL,
 input_schema JSON NOT NULL,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_job_revision_content(job_id,content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_run_grant (
 job_id BIGINT UNSIGNED NOT NULL,
 subject_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 granted_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(job_id,subject_kind,subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_run (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
 revision_id BIGINT UNSIGNED NOT NULL,
 run_as_user_id BIGINT UNSIGNED NOT NULL,
 trigger_kind VARCHAR(16) NOT NULL,
 actor_user_id BIGINT UNSIGNED NULL,
 trigger_context JSON NOT NULL,
 inputs JSON NOT NULL,
 timeout_ms BIGINT UNSIGNED NOT NULL,
 state_mode VARCHAR(16) NOT NULL,
 state_store_id BIGINT UNSIGNED NULL,
 rerun_of_run_id BIGINT UNSIGNED NULL,
 status VARCHAR(16) NOT NULL,
 stop_reason VARCHAR(64) NOT NULL DEFAULT '',
 error_code VARCHAR(64) NOT NULL DEFAULT '',
 error_summary TEXT NOT NULL,
 result JSON NULL,
 has_result BOOLEAN NOT NULL DEFAULT FALSE,
 queued_at DATETIME(3) NOT NULL,
 started_at DATETIME(3) NULL,
 finished_at DATETIME(3) NULL,
 stop_requested_by_user_id BIGINT UNSIGNED NULL,
 stop_requested_at DATETIME(3) NULL,
 last_log_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_log_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_log_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_logs_truncated BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(id), KEY idx_job_run_history(job_id,id), KEY idx_job_run_queue(status,queued_at,id), KEY idx_job_run_slots(job_id,status,queued_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_run_log (
 job_run_id BIGINT UNSIGNED NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 kind VARCHAR(16) NOT NULL,
 level VARCHAR(16) NOT NULL,
 message TEXT NOT NULL,
 fields JSON NOT NULL,
 resource_call_id BIGINT UNSIGNED NULL,
 PRIMARY KEY(job_run_id,seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_resource_call (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_run_id BIGINT UNSIGNED NOT NULL,
 resource_kind VARCHAR(32) NOT NULL,
 resource_id BIGINT UNSIGNED NULL,
 authorization_kind VARCHAR(16) NOT NULL,
 connection_id BIGINT UNSIGNED NULL,
 configured_credential_id BIGINT UNSIGNED NULL,
 credential_id BIGINT UNSIGNED NULL,
 credential_material_version BIGINT UNSIGNED NULL,
 robot_material_version BIGINT UNSIGNED NULL,
 resource_snapshot JSON NOT NULL,
 target VARCHAR(1000) NOT NULL DEFAULT '',
 operation VARCHAR(64) NOT NULL,
 outcome VARCHAR(16) NOT NULL,
 error_code VARCHAR(64) NOT NULL DEFAULT '',
 external_ref VARCHAR(255) NULL,
 created_at DATETIME(3) NOT NULL,
 finished_at DATETIME(3) NULL,
 PRIMARY KEY(id), KEY idx_job_call_run(job_run_id,id), KEY idx_job_call_resource(resource_kind,resource_id,created_at,id), KEY idx_job_call_credential(credential_id,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_trigger_request (
 caller_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 caller_id BIGINT UNSIGNED NOT NULL,
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 trigger_kind VARCHAR(16) NOT NULL,
 outcome VARCHAR(16) NOT NULL,
 reason_code VARCHAR(64) NOT NULL DEFAULT '',
 job_run_id BIGINT UNSIGNED NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_job_trigger_request(job_id,caller_kind,caller_id,request_key), KEY idx_job_request_history(job_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_schedule (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schedule_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'cron',
 run_at DATETIME(3) NULL,
 max_fires INT UNSIGNED NULL,
 fire_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
 name VARCHAR(100) NOT NULL,
 cron VARCHAR(255) NOT NULL,
 timezone VARCHAR(64) NOT NULL,
 inputs JSON NOT NULL,
 enabled BOOLEAN NOT NULL,
 next_fire_at DATETIME(3) NULL,
 row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 CONSTRAINT chk_job_schedule_mode CHECK (
   (schedule_kind='once' AND run_at IS NOT NULL AND cron='' AND max_fires IS NOT NULL AND max_fires=1)
   OR (schedule_kind='cron' AND run_at IS NULL AND cron<>'' AND (max_fires IS NULL OR max_fires>0))
 ),
 PRIMARY KEY(id), UNIQUE KEY uq_job_schedule_job_code(job_id,code), KEY idx_job_schedule_due(enabled,next_fire_at,id), KEY idx_job_schedule_job(job_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_schedule_command (
 schedule_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 result_version BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(schedule_id,actor_user_id,request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_schedule_fire (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 schedule_id BIGINT UNSIGNED NOT NULL,
 scheduled_at DATETIME(3) NOT NULL,
 processed_at DATETIME(3) NOT NULL,
 outcome VARCHAR(16) NOT NULL,
 reason_code VARCHAR(64) NOT NULL DEFAULT '',
 job_run_id BIGINT UNSIGNED NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_job_schedule_fire(schedule_id,scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
