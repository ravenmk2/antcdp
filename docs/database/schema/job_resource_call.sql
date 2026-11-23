-- Reading copy of 00016_jobs.sql; execute embedded migrations instead.

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
