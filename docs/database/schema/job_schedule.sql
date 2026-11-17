-- Reading copy of 00016_jobs.sql; execute embedded migrations instead.

CREATE TABLE job_schedule (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
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
 PRIMARY KEY(id), KEY idx_job_schedule_due(enabled,next_fire_at,id), KEY idx_job_schedule_job(job_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
