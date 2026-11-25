package mysql

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

func (s *Store) jobsSchemaReady(ctx context.Context) error {
	var count int
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('job','job_revision','job_run_grant','job_run','job_run_log','job_resource_call','job_trigger_request','job_schedule','job_schedule_fire','job_schedule_command')`); err != nil {
		return err
	}
	if count != 10 {
		return install.ErrIncompleteSchema
	}
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dingtalk_robot' AND COLUMN_NAME IN ('scope_kind','scope_id','material_version')`); err != nil {
		return err
	}
	if count != 3 {
		return install.ErrIncompleteSchema
	}
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='job_run' AND COLUMN_NAME='state_store_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES'`); err != nil {
		return err
	}
	if count != 1 {
		return install.ErrIncompleteSchema
	}
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='job_schedule' AND COLUMN_NAME IN ('code','schedule_kind','run_at','max_fires','fire_count')) OR (TABLE_NAME IN ('job_revision','job_run') AND COLUMN_NAME='run_as_user_id' AND COLUMN_TYPE='bigint unsigned' AND IS_NULLABLE='NO') OR (TABLE_NAME='job' AND COLUMN_NAME='code' AND IS_NULLABLE='NO') OR (TABLE_NAME='job_trigger_request' AND COLUMN_NAME IN ('caller_kind','caller_id') AND IS_NULLABLE='NO'))`); err != nil {
		return err
	}
	if count != 10 {
		return install.ErrIncompleteSchema
	}
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='job_revision' AND COLUMN_NAME='resource_bindings') OR (TABLE_NAME='job_resource_call' AND COLUMN_NAME IN ('binding_name','grant_id')))`); err != nil {
		return err
	}
	if count != 0 {
		return install.ErrIncompleteSchema
	}
	for _, expected := range []struct{ table, index, columns string }{{"job_schedule", "uq_job_schedule_job_code", "job_id,code"}, {"job", "uq_job_scope_code", "scope_kind,scope_id,code"}, {"job_trigger_request", "uq_job_trigger_request", "job_id,caller_kind,caller_id,request_key"}} {
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
