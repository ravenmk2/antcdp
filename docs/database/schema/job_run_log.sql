-- Reading copy of 00015_jobs.sql; execute embedded migrations instead.

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
