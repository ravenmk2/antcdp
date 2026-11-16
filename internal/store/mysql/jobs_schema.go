package mysql

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

func (s *Store) jobsSchemaReady(ctx context.Context) error {
	var count int
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('job','job_revision','job_run_grant','job_resource_grant','job_run','job_run_log','job_resource_call','job_trigger_request','job_schedule','job_schedule_fire')`); err != nil {
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
	return nil
}
