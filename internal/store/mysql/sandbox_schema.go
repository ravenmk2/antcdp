package mysql

import (
	"context"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

var sandboxSchemaColumns = cloudSchemaColumns
var sandboxSchemaIndexes = cloudSchemaIndexes

func (s *Store) sandboxSchemaReady(ctx context.Context) error {
	for table, columns := range sandboxSchemaColumns {
		rows, e := s.db.QueryxContext(ctx, "SELECT "+columns+" FROM `"+table+"` LIMIT 0")
		if e != nil {
			return install.ErrIncompleteSchema
		}
		if e = rows.Close(); e != nil {
			return e
		}
	}
	rows := []agentSchemaIndex{}
	if e := s.db.SelectContext(ctx, &rows, "SELECT TABLE_NAME AS table_name,INDEX_NAME AS index_name,NON_UNIQUE AS non_unique,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE"); e != nil {
		return e
	}
	actual := map[string]agentSchemaIndex{}
	for _, v := range rows {
		actual[v.Table+"/"+v.Name] = v
	}
	for _, expected := range sandboxSchemaIndexes {
		v, ok := actual[expected.Table+"/"+expected.Name]
		if !ok || v.NonUnique != expected.NonUnique || !strings.EqualFold(v.Columns, expected.Columns) {
			return install.ErrIncompleteSchema
		}
	}
	return nil
}
