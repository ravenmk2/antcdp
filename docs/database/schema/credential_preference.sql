-- Reading copy of 00004_integrations.sql; execute embedded migrations instead.

CREATE TABLE `credential_preference` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    resource_kind ENUM('service_connection','remote_host') NOT NULL,
    resource_id BIGINT UNSIGNED NOT NULL,
    scope_kind ENUM('platform','project','user','team') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    credential_id BIGINT UNSIGNED NOT NULL,
    last_verification JSON NULL,
    UNIQUE KEY uq_credential_preference (resource_kind,resource_id,scope_kind,scope_id),
    KEY idx_preferred_credential (credential_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
