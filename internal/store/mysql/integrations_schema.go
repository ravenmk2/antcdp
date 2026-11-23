package mysql

import (
	"context"
	"fmt"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

// Baseline versions alone cannot distinguish an installation from before scoped
// connections. Reject it at startup instead of failing later on business queries.
func (s *Store) integrationsSchemaReady(ctx context.Context) error {
	var count int
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (
        (TABLE_NAME='service_connection' AND COLUMN_NAME IN ('ownership_type','project_id','owner_key','grants_version')) OR
        (TABLE_NAME='service_connection_grant' AND COLUMN_NAME IN ('connection_id','subject_kind','subject_id','enabled','row_version','created_by_user_id','updated_by_user_id','created_at','updated_at'))
    )`); err != nil {
		return err
	}
	if count != 13 {
		return fmt.Errorf("%w: scoped connection columns", install.ErrIncompleteSchema)
	}
	if err := s.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_connection' AND COLUMN_NAME IN ('fallback_credential_id','fallback_version')`); err != nil {
		return err
	}
	if count != 0 {
		return fmt.Errorf("%w: obsolete connection fallback columns", install.ErrIncompleteSchema)
	}
	for _, table := range []string{"service_connection"} {
		var expression string
		if err := s.db.GetContext(ctx, &expression, `SELECT GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='owner_key'`, table); err != nil {
			return err
		}
		expression = strings.ReplaceAll(expression, "\\'", "'")
		if !strings.Contains(expression, "'platform'") || strings.Contains(expression, "'system'") {
			return fmt.Errorf("%w: %s platform owner expression", install.ErrIncompleteSchema, table)
		}
	}
	for _, spec := range []struct {
		table, index, columns string
		nonUnique             int
	}{
		{"service_connection", "uq_service_connection_owner_code", "ownership_type,owner_key,code", 0},
		{"service_connection", "uq_service_connection_owner_type_name", "ownership_type,owner_key,service_type,name", 0},
		{"credential", "uq_credential_scope_code", "scope_kind,scope_id,code", 0},
		{"credential_preference", "uq_credential_preference", "resource_kind,resource_id,scope_kind,scope_id", 0},
		{"service_connection_grant", "PRIMARY", "connection_id,subject_kind,subject_id", 0},
		{"service_connection_grant", "idx_service_connection_grant_subject", "subject_kind,subject_id,enabled,connection_id", 1},
		{"project_repository", "idx_project_repository_event_target", "connection_id,repo_id,project_id", 1},
		{"job_resource_grant", "idx_job_resource_connection", "connection_id,status,job_id", 1},
		{"job_resource_grant", "idx_job_resource_credential", "credential_id,status,job_id", 1},
	} {
		var columns string
		if err := s.db.GetContext(ctx, &columns, `SELECT COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','),'') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? AND NON_UNIQUE=?`, spec.table, spec.index, spec.nonUnique); err != nil {
			return err
		}
		if columns != spec.columns {
			return fmt.Errorf("%w: %s.%s index columns %s", install.ErrIncompleteSchema, spec.table, spec.index, columns)
		}
	}
	return nil
}
