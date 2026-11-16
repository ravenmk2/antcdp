package mysql

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/install"
)

func (s *Store) stateStoreSchemaReady(ctx context.Context) error {
	var columns int
	err := s.db.GetContext(ctx, &columns, `SELECT COUNT(*)
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND IS_NULLABLE='NO' AND (
    (TABLE_NAME='state_store' AND (
        (COLUMN_NAME='id' AND DATA_TYPE='bigint' AND COLUMN_TYPE LIKE '%unsigned' AND EXTRA='auto_increment') OR
        (COLUMN_NAME='namespace' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=255 AND COLLATION_NAME='utf8mb4_0900_bin') OR
        (COLUMN_NAME='name' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=64 AND COLLATION_NAME='utf8mb4_0900_bin') OR
        (COLUMN_NAME='display_name' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=128 AND CHARACTER_SET_NAME='utf8mb4')
    )) OR
    (TABLE_NAME='state_entry' AND (
        (COLUMN_NAME='store_id' AND DATA_TYPE='bigint' AND COLUMN_TYPE LIKE '%unsigned') OR
        (COLUMN_NAME='entry_key' AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH=255 AND COLLATION_NAME='utf8mb4_0900_bin') OR
        (COLUMN_NAME='value' AND DATA_TYPE='mediumblob') OR
        (COLUMN_NAME='etag' AND DATA_TYPE='binary' AND CHARACTER_MAXIMUM_LENGTH=16)
    )) OR
    (TABLE_NAME IN ('state_store','state_entry') AND COLUMN_NAME IN ('created_at','updated_at') AND DATA_TYPE='datetime' AND DATETIME_PRECISION=3)
)`)
	if err != nil {
		return err
	}
	if columns != 12 {
		return install.ErrIncompleteSchema
	}

	var indexes int
	err = s.db.GetContext(ctx, &indexes, `SELECT COUNT(*) FROM (
    SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns_list
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('state_store','state_entry') AND NON_UNIQUE=0
    GROUP BY TABLE_NAME,INDEX_NAME
    HAVING COUNT(SUB_PART)=0 AND COUNT(COLUMN_NAME)=COUNT(*)
) AS state_indexes
WHERE (TABLE_NAME='state_store' AND INDEX_NAME='PRIMARY' AND columns_list='id')
   OR (TABLE_NAME='state_store' AND INDEX_NAME='uq_state_store_namespace_name' AND columns_list='namespace,name')
   OR (TABLE_NAME='state_entry' AND INDEX_NAME='PRIMARY' AND columns_list='store_id,entry_key')`)
	if err != nil {
		return err
	}
	if indexes != 3 {
		return install.ErrIncompleteSchema
	}
	return nil
}
