-- Reading copy of 00015_jobs.sql; execute embedded migrations instead.

CREATE TABLE job_resource_grant (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 job_id BIGINT UNSIGNED NOT NULL,
 connection_id BIGINT UNSIGNED NOT NULL,
 credential_id BIGINT UNSIGNED NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'active',
 active_slot TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status='active' THEN 1 ELSE NULL END) STORED,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 revoked_by_user_id BIGINT UNSIGNED NULL,
 revoked_at DATETIME(3) NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_job_resource_active(job_id,connection_id,credential_id,active_slot), KEY idx_job_resource(job_id,id), KEY idx_job_resource_connection(connection_id,status,job_id), KEY idx_job_resource_credential(credential_id,status,job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
