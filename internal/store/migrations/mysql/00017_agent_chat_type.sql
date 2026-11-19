-- +goose Up

UPDATE agent SET agent_type = 'chat' WHERE agent_type = 'interactive';
UPDATE agent_session SET agent_type = 'chat' WHERE agent_type = 'interactive';
UPDATE agent_file SET content_domain = 'chat' WHERE content_domain = 'interactive';
UPDATE agent_operation SET content_domain = 'chat' WHERE content_domain = 'interactive';

UPDATE agent_command_receipt
SET result = JSON_SET(result, '$.data.agent_type', 'chat')
WHERE JSON_UNQUOTE(JSON_EXTRACT(result, '$.data.agent_type')) = 'interactive';

UPDATE agent_command_receipt
SET result = JSON_SET(result, '$.data.configuration.agent_type', 'chat')
WHERE JSON_UNQUOTE(JSON_EXTRACT(result, '$.data.configuration.agent_type')) = 'interactive';
