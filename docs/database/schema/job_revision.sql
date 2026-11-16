-- Reading copy of 00015_jobs.sql; execute embedded migrations instead.

CREATE TABLE job_revision (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
 content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 script MEDIUMTEXT NOT NULL,
 input_schema JSON NOT NULL,
 resource_bindings JSON NOT NULL,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_job_revision_content(job_id,content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
