-- Reading copy of 00016_jobs.sql; execute embedded migrations instead.

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
