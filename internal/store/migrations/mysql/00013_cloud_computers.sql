-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE `cloud_computer_spec_binding` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `robot_user_id` BIGINT UNSIGNED NULL,
    `pool_capacity` SMALLINT UNSIGNED NULL,
    `spec_id` BIGINT UNSIGNED NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `updated_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `owner_key` BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(robot_user_id,0)) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_spec_binding_owner (owner_key),
    KEY idx_cloud_binding_spec (spec_id,owner_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cloud_computer` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `owner_user_id` BIGINT UNSIGNED NOT NULL,
    `workspace_user_id` BIGINT UNSIGNED NULL,
    `allocation_kind` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `backend_generation` BIGINT UNSIGNED NOT NULL,
    `sandbox_instance_id` BIGINT UNSIGNED NULL,
    `storage_generation` BIGINT UNSIGNED NOT NULL,
    `volume_id` CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `volume_name` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `volume_state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `volume_cleanup_state` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `applied_spec_id` BIGINT UNSIGNED NULL,
    `applied_spec_version` BIGINT UNSIGNED NULL,
    `idle_since` DATETIME(3) NOT NULL,
    `last_activity_at` DATETIME(3) NOT NULL,
    `error_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `fence_version` BIGINT UNSIGNED NOT NULL,
    `row_version` BIGINT UNSIGNED NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `personal_owner_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN allocation_kind='personal' AND deleted_at IS NULL THEN owner_user_id ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_personal_owner (personal_owner_id),
    UNIQUE KEY uq_cloud_volume_id (volume_id),
    UNIQUE KEY uq_cloud_volume_name (volume_name),
    UNIQUE KEY uq_cloud_instance (sandbox_instance_id),
    KEY idx_cloud_pool (owner_user_id,allocation_kind,deleted_at,idle_since,id),
    KEY idx_cloud_owner (owner_user_id,deleted_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO cloud_computer_spec_binding(robot_user_id,spec_id,row_version,created_at,updated_at) VALUES(NULL,NULL,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
