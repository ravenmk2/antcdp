-- +goose NO TRANSACTION
-- +goose Up

CREATE TABLE `event_group` (
 id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 sort_order INT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_type` (
 id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_group VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 description VARCHAR(1000) NOT NULL,
 origin VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(id),
 KEY idx_event_type_group(event_group,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_type_version` (
 event_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version INT UNSIGNED NOT NULL,
 data_schema JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(event_type,schema_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO event_group(id,name,sort_order) VALUES ('gitlab','GitLab',0);

INSERT INTO event_type(id,event_group,name,description,origin) VALUES
 ('gitlab.merge_request.created','gitlab','合并请求创建','创建合并请求','builtin'),
 ('gitlab.merge_request.updated','gitlab','合并请求更新','内容或源分支发生更新；不一定是代码变化','builtin'),
 ('gitlab.merge_request.reopened','gitlab','合并请求重新打开','重新打开已关闭的合并请求','builtin'),
 ('gitlab.merge_request.closed','gitlab','合并请求关闭','关闭但未合并','builtin'),
 ('gitlab.merge_request.merged','gitlab','合并请求已合并','合并请求已经合并','builtin'),
 ('gitlab.push','gitlab','代码推送','分支推送、创建或删除','builtin'),
 ('gitlab.tag.created','gitlab','标签创建','创建 Git 标签','builtin'),
 ('gitlab.tag.deleted','gitlab','标签删除','删除 Git 标签','builtin'),
 ('gitlab.repository_update','gitlab','仓库更新','System Hook 仓库引用更新','builtin'),
 ('gitlab.pipeline.status_changed','gitlab','流水线状态变化','GitLab 流水线状态通知','builtin'),
 ('gitlab.ci_job.status_changed','gitlab','CI 作业状态变化','GitLab CI Job 状态通知，与平台 Job 无关','builtin'),
 ('gitlab.note.created','gitlab','评论创建','提交、MR 等对象的新评论','builtin'),
 ('gitlab.note.updated','gitlab','评论更新','已有评论的修改','builtin');

-- Assemble complete, standalone v1 schemas from the normalized GitLab payload shapes.
INSERT INTO event_type_version(event_type,schema_version,data_schema,created_at)
WITH bodies(body_key,body_schema) AS (
 SELECT 'mergeRequest',
  '{
   "type": "object",
   "required": ["id", "iid", "title", "description", "url", "sourceBranch", "targetBranch", "sourceProjectId", "targetProjectId", "headSha", "state", "draft", "workInProgress", "action", "changes"],
   "properties": {
    "id": {"type": "string"},
    "iid": {"type": "string"},
    "title": {"type": ["string", "null"]},
    "description": {"type": ["string", "null"]},
    "url": {"type": ["string", "null"]},
    "sourceBranch": {"type": ["string", "null"]},
    "targetBranch": {"type": ["string", "null"]},
    "sourceProjectId": {"type": "string"},
    "targetProjectId": {"type": "string"},
    "headSha": {"type": ["string", "null"]},
    "state": {"type": ["string", "null"]},
    "draft": {"type": ["boolean", "null"]},
    "workInProgress": {"type": ["boolean", "null"]},
    "action": {"type": "string"},
    "changes": {"type": ["object", "null"]}
   }
  }' UNION ALL
 SELECT 'push',
  '{
   "type": "object",
   "required": ["ref", "before", "after", "commits", "totalCommitsCount"],
   "properties": {
    "ref": {"type": "string"},
    "before": {"type": "string"},
    "after": {"type": "string"},
    "commits": {"type": ["array", "null"]},
    "totalCommitsCount": {"type": ["integer", "null"]}
   }
  }' UNION ALL
 SELECT 'repositoryUpdate',
  '{
   "type": "object",
   "required": ["changes", "refs"],
   "properties": {
    "changes": {"type": ["array", "null"]},
    "refs": {"type": ["array", "null"]}
   }
  }' UNION ALL
 SELECT 'pipeline',
  '{
   "type": "object",
   "required": ["id", "status", "ref", "sha", "url", "source"],
   "properties": {
    "id": {"type": "string"},
    "status": {"type": ["string", "null"]},
    "ref": {"type": ["string", "null"]},
    "sha": {"type": ["string", "null"]},
    "url": {"type": ["string", "null"]},
    "source": {"type": ["string", "null"]}
   }
  }' UNION ALL
 SELECT 'ciJob',
  '{
   "type": "object",
   "required": ["id", "name", "status", "stage", "ref", "sha", "pipelineId"],
   "properties": {
    "id": {"type": "string"},
    "name": {"type": ["string", "null"]},
    "status": {"type": ["string", "null"]},
    "stage": {"type": ["string", "null"]},
    "ref": {"type": ["string", "null"]},
    "sha": {"type": ["string", "null"]},
    "pipelineId": {"type": "string"}
   }
  }' UNION ALL
 SELECT 'note',
  '{
   "type": "object",
   "required": ["id", "body", "url", "noteableType", "noteableId", "action"],
   "properties": {
    "id": {"type": "string"},
    "body": {"type": ["string", "null"]},
    "url": {"type": ["string", "null"]},
    "noteableType": {"type": ["string", "null"]},
    "noteableId": {"type": "string"},
    "action": {"type": "string"}
   }
  }'
), variants(event_type,body_key,action_schema) AS (
 SELECT 'gitlab.merge_request.created', 'mergeRequest', JSON_OBJECT('const','open') UNION ALL
 SELECT 'gitlab.merge_request.updated', 'mergeRequest', JSON_OBJECT('const','update') UNION ALL
 SELECT 'gitlab.merge_request.reopened', 'mergeRequest', JSON_OBJECT('const','reopen') UNION ALL
 SELECT 'gitlab.merge_request.closed', 'mergeRequest', JSON_OBJECT('const','close') UNION ALL
 SELECT 'gitlab.merge_request.merged', 'mergeRequest', JSON_OBJECT('const','merge') UNION ALL
 SELECT 'gitlab.push', 'push', NULL UNION ALL
 SELECT 'gitlab.tag.created', 'push', NULL UNION ALL
 SELECT 'gitlab.tag.deleted', 'push', NULL UNION ALL
 SELECT 'gitlab.repository_update', 'repositoryUpdate', NULL UNION ALL
 SELECT 'gitlab.pipeline.status_changed', 'pipeline', NULL UNION ALL
 SELECT 'gitlab.ci_job.status_changed', 'ciJob', NULL UNION ALL
 SELECT 'gitlab.note.created', 'note', JSON_OBJECT('enum',JSON_ARRAY('','create')) UNION ALL
 SELECT 'gitlab.note.updated', 'note', JSON_OBJECT('const','update')
)
SELECT v.event_type, 1,
 JSON_OBJECT(
  '$schema','https://json-schema.org/draft/2020-12/schema',
  'type','object',
  'required',JSON_ARRAY('repository','user',v.body_key),
  'properties',JSON_OBJECT(
   'repository',CAST('{
   "type": "object",
   "required": ["id", "name", "path", "url", "defaultBranch"],
   "properties": {
    "id": {"type": "string"},
    "name": {"type": ["string", "null"]},
    "path": {"type": ["string", "null"]},
    "url": {"type": ["string", "null"]},
    "defaultBranch": {"type": ["string", "null"]}
   }
  }' AS JSON),
   'user',CAST('{
   "type": "object",
   "required": ["id", "username", "name"],
   "properties": {
    "id": {"type": "string"},
    "username": {"type": ["string", "null"]},
    "name": {"type": ["string", "null"]}
   }
  }' AS JSON),
   v.body_key, CAST(IF(v.action_schema IS NULL, b.body_schema,
     JSON_SET(b.body_schema,'$.properties.action',CAST(v.action_schema AS JSON))) AS JSON)
  )
 ), UTC_TIMESTAMP(3)
FROM variants v JOIN bodies b ON b.body_key=v.body_key;

CREATE TABLE `event_record` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 source_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_id BIGINT UNSIGNED NOT NULL,
 source_message_id VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NULL,
 source_event_type VARCHAR(128) NOT NULL,
 group_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_type VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version INT UNSIGNED NOT NULL,
 source_repository_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL DEFAULT '',
 subject_kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 subject_id VARCHAR(255) NOT NULL DEFAULT '',
 occurred_at DATETIME(3) NULL,
 received_at DATETIME(3) NOT NULL,
 data JSON NOT NULL,
 raw_payload MEDIUMBLOB NOT NULL,
 payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_metadata JSON NOT NULL,
 routing_result VARCHAR(24) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_event_source_message(source_kind,source_id,source_message_id),
 KEY idx_event_source(source_kind,source_id,id),
 KEY idx_event_type(event_type,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_scope_ref` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 event_id BIGINT UNSIGNED NOT NULL,
 scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 scope_id BIGINT UNSIGNED NOT NULL,
 routing_basis JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_event_scope(event_id,scope_kind,scope_id),
 KEY idx_event_scope_history(scope_kind,scope_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_subscription` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 scope_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 scope_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 current_revision_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
 next_enqueue_seq BIGINT UNSIGNED NOT NULL DEFAULT 1,
 next_consume_seq BIGINT UNSIGNED NOT NULL DEFAULT 1,
 row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 updated_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 updated_at DATETIME(3) NOT NULL,
 deleted_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 KEY idx_event_subscription_scope(scope_kind,scope_id,deleted_at,id),
 KEY idx_event_subscription_work(enabled,deleted_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_subscription_revision` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 subscription_id BIGINT UNSIGNED NOT NULL,
 revision_no BIGINT UNSIGNED NOT NULL,
 event_types JSON NOT NULL,
 run_as_user_id BIGINT UNSIGNED NOT NULL,
 script_api_version INT UNSIGNED NOT NULL,
 script MEDIUMTEXT NOT NULL,
 timeout_ms BIGINT UNSIGNED NOT NULL,
 max_retries INT UNSIGNED NOT NULL,
 retry_interval_ms BIGINT UNSIGNED NOT NULL,
 created_by_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_event_subscription_revision(subscription_id,revision_no),
 KEY idx_event_revision_executor(run_as_user_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_consumption` (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 subscription_id BIGINT UNSIGNED NOT NULL,
 revision_id BIGINT UNSIGNED NOT NULL,
 scope_ref_id BIGINT UNSIGNED NOT NULL,
 queue_seq BIGINT UNSIGNED NOT NULL,
 status VARCHAR(24) NOT NULL,
 attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
 started_at DATETIME(3) NULL,
 deadline_at DATETIME(3) NULL,
 next_retry_at DATETIME(3) NULL,
 finished_at DATETIME(3) NULL,
 error_code VARCHAR(64) NOT NULL DEFAULT '',
 error_summary TEXT NOT NULL,
 result JSON NOT NULL,
 has_result BOOLEAN NOT NULL DEFAULT FALSE,
 retry_of_id BIGINT UNSIGNED NULL,
 operator_user_id BIGINT UNSIGNED NULL,
 automatic_scope_ref_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN retry_of_id IS NULL THEN scope_ref_id ELSE NULL END) STORED,
 last_log_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_log_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_log_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
 script_logs_truncated BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_event_consumption_queue(subscription_id,queue_seq),
 UNIQUE KEY uq_event_consumption_automatic(subscription_id,automatic_scope_ref_id),
 UNIQUE KEY uq_event_consumption_retry(retry_of_id),
 KEY idx_event_consumption_reference(scope_ref_id,id),
 KEY idx_event_consumption_status(status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_consumption_log` (
 consumption_id BIGINT UNSIGNED NOT NULL,
 seq BIGINT UNSIGNED NOT NULL,
 attempt_no INT UNSIGNED NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 kind VARCHAR(24) NOT NULL,
 level VARCHAR(16) NOT NULL,
 message TEXT NOT NULL,
 fields JSON NOT NULL,
 PRIMARY KEY(consumption_id,seq),
 KEY idx_event_consumption_attempt(consumption_id,attempt_no,seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Restore matching database and data backups to downgrade';
