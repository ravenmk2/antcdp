-- +goose Up
-- +goose NO TRANSACTION
-- Final version 6: typed service configuration in JSON, GitLab extension for
-- webhook settings only. No per-service Jenkins table is created.
-- Upgrade from the consolidated version 5. An intermediate version 6 requires
-- explicit maintenance conversion; changing its migration number is not enough.
ALTER TABLE service_connection
    ADD COLUMN config JSON NULL AFTER enabled,
    ADD COLUMN config_schema_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER config;

UPDATE service_connection c
JOIN service_connection_gitlab g ON g.connection_id=c.id
SET c.config=JSON_OBJECT('base_url',g.base_url,'custom_ca_pem',g.custom_ca_pem)
WHERE c.service_type='gitlab';

-- Missing/unsupported configuration fails here before removing source columns.
ALTER TABLE service_connection MODIFY COLUMN config JSON NOT NULL;

ALTER TABLE service_connection_gitlab
    DROP COLUMN base_url,
    DROP COLUMN custom_ca_pem;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
