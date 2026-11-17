-- Reading copy of 00016_jobs.sql; execute embedded migrations instead.

CREATE TABLE job_run_grant (
 job_id BIGINT UNSIGNED NOT NULL,
 subject_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 subject_id BIGINT UNSIGNED NOT NULL,
 granted_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(job_id,subject_kind,subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
