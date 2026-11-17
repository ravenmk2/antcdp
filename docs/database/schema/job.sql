-- Reading copy of 00016_jobs.sql; execute embedded migrations instead.

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
