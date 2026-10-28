-- +goose Up
ALTER TABLE integration_credential
    ADD COLUMN service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER integration_id,
    ADD COLUMN code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER service_type;

UPDATE integration_credential c JOIN integration i ON i.id=c.integration_id
SET c.service_type=i.service_type, c.code=CONCAT('credential_',c.id),
    c.identity_config=IF(i.service_type='gitlab',JSON_REMOVE(c.identity_config,'$.token_type'),c.identity_config),
    c.row_version=c.row_version+1;

UPDATE integration SET credentials_version=credentials_version+1
WHERE id IN (SELECT integration_id FROM integration_credential);

ALTER TABLE integration_credential
    MODIFY service_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ADD UNIQUE KEY uq_integration_credential_code (service_type,code);

-- Forward-only: restore a matched database/data backup to roll back.
