package mysql

import (
	"context"
	"fmt"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

func (s *Store) eventsSchemaReady(ctx context.Context) error {
	for table, columns := range map[string]string{
		"event_record":                "id,source_kind,source_id,source_message_id,source_event_type,group_code,event_type,schema_version,source_repository_id,subject_kind,subject_id,occurred_at,received_at,data,raw_payload,payload_hash,source_metadata,routing_result",
		"event_scope_ref":             "id,event_id,scope_kind,scope_id,routing_basis,created_at",
		"event_subscription":          "id,scope_kind,scope_id,name,description,enabled,current_revision_id,next_enqueue_seq,next_consume_seq,row_version,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at",
		"event_subscription_revision": "id,subscription_id,revision_no,event_types,executor_user_id,script_api_version,script,timeout_ms,max_retries,retry_interval_ms,created_by_user_id,created_at",
		"event_consumption":           "id,subscription_id,revision_id,scope_ref_id,queue_seq,status,attempt_count,started_at,deadline_at,next_retry_at,finished_at,error_code,error_summary,result,has_result,retry_of_id,operator_user_id,automatic_scope_ref_id,last_log_seq,script_log_count,script_log_bytes,script_logs_truncated,created_at",
		"event_consumption_log":       "consumption_id,seq,attempt_no,occurred_at,kind,level,message,fields",
	} {
		rows, err := s.db.QueryxContext(ctx, "SELECT "+columns+" FROM "+table+" LIMIT 0")
		if err != nil {
			return fmt.Errorf("event schema %s: %w", table, err)
		}
		if err = rows.Close(); err != nil {
			return err
		}
	}
	for _, expected := range []struct{ table, index, columns string }{
		{"event_record", "uq_event_source_message", "source_kind,source_id,source_message_id"},
		{"event_scope_ref", "uq_event_scope", "event_id,scope_kind,scope_id"},
		{"event_consumption", "uq_event_consumption_queue", "subscription_id,queue_seq"},
		{"event_consumption", "uq_event_consumption_automatic", "subscription_id,automatic_scope_ref_id"},
		{"event_consumption", "uq_event_consumption_retry", "retry_of_id"},
	} {
		var found string
		if err := s.db.GetContext(ctx, &found, `SELECT COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','),'') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? AND NON_UNIQUE=0`, expected.table, expected.index); err != nil {
			return err
		}
		if found != expected.columns {
			return install.ErrIncompleteSchema
		}
	}
	return nil
}
