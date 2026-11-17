-- Reading copy of 00016_jobs.sql; execute embedded migrations instead.

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
