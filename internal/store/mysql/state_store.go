package mysql

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

// StateStore uses the application's existing MySQL connection pool.
func (s *Store) StateStore() statestore.Backend {
	return stateBackend{db: s.db}
}

type stateBackend struct {
	db *sqlx.DB
}

type stateStoreRow struct {
	ID          statestore.StoreID `db:"id"`
	Namespace   string             `db:"namespace"`
	Name        string             `db:"name"`
	DisplayName string             `db:"display_name"`
	CreatedAt   time.Time          `db:"created_at"`
	UpdatedAt   time.Time          `db:"updated_at"`
}

const stateStoreColumns = "`id`,`namespace`,`name`,`display_name`,`created_at`,`updated_at`"
const insertStateStore = "INSERT INTO `state_store` (`namespace`,`name`,`display_name`,`created_at`,`updated_at`) VALUES (?,?,?,?,?)"

func (r stateStoreRow) info() statestore.StoreInfo {
	return statestore.StoreInfo{
		ID: r.ID, Namespace: r.Namespace, Name: r.Name, DisplayName: r.DisplayName,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func (b stateBackend) CreateStore(ctx context.Context, namespace, name, displayName string) (statestore.StoreInfo, error) {
	if err := statestore.ValidateNamespace(namespace); err != nil {
		return statestore.StoreInfo{}, err
	}
	if err := statestore.ValidateStoreName(name); err != nil {
		return statestore.StoreInfo{}, err
	}
	if err := statestore.ValidateDisplayName(displayName); err != nil {
		return statestore.StoreInfo{}, err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	result, err := b.db.ExecContext(ctx, insertStateStore, namespace, name, displayName, now, now)
	if stateMySQLError(err, 1062) {
		return statestore.StoreInfo{}, statestore.ErrStoreExists
	}
	if err != nil {
		return statestore.StoreInfo{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return statestore.StoreInfo{}, err
	}
	return statestore.StoreInfo{
		ID: statestore.StoreID(id), Namespace: namespace, Name: name, DisplayName: displayName,
		CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (b stateBackend) OpenStore(ctx context.Context, namespace, name string) (statestore.StoreInfo, statestore.KV, error) {
	if err := statestore.ValidateNamespace(namespace); err != nil {
		return statestore.StoreInfo{}, nil, err
	}
	if err := statestore.ValidateStoreName(name); err != nil {
		return statestore.StoreInfo{}, nil, err
	}
	var row stateStoreRow
	const selectStore = "SELECT " + stateStoreColumns + " FROM `state_store` WHERE `namespace`=? AND `name`=?"
	err := b.db.GetContext(ctx, &row, selectStore, namespace, name)
	if errors.Is(err, sql.ErrNoRows) {
		err = b.transact(ctx, func(tx *sqlx.Tx) error {
			now := time.Now().UTC().Truncate(time.Millisecond)
			if _, err := tx.ExecContext(ctx, insertStateStore+" ON DUPLICATE KEY UPDATE `id`=`id`", namespace, name, name, now, now); err != nil {
				return err
			}
			return tx.GetContext(ctx, &row, selectStore, namespace, name)
		})
	}
	if err != nil {
		return statestore.StoreInfo{}, nil, err
	}
	return row.info(), stateKV{backend: b, id: row.ID}, nil
}

func (b stateBackend) ListStores(ctx context.Context, namespace string, page statestore.StorePageRequest) (statestore.StorePage, error) {
	if err := statestore.ValidateNamespace(namespace); err != nil {
		return statestore.StorePage{}, err
	}
	if page.AfterName != "" {
		if err := statestore.ValidateStoreName(page.AfterName); err != nil {
			return statestore.StorePage{}, err
		}
	}
	if page.Limit < 0 || page.Limit > 100 {
		return statestore.StorePage{}, fmt.Errorf("%w: store page limit must be 0 to 100", statestore.ErrInvalidArgument)
	}
	if page.Limit == 0 {
		page.Limit = 50
	}
	var rows []stateStoreRow
	err := b.db.SelectContext(ctx, &rows, "SELECT "+stateStoreColumns+" FROM `state_store` WHERE `namespace`=? AND `name`>? ORDER BY `name` LIMIT ?", namespace, page.AfterName, page.Limit+1)
	if err != nil {
		return statestore.StorePage{}, err
	}
	var result statestore.StorePage
	if len(rows) > page.Limit {
		rows = rows[:page.Limit]
		result.NextAfterName = rows[len(rows)-1].Name
	}
	result.Items = make([]statestore.StoreInfo, len(rows))
	for i, row := range rows {
		result.Items[i] = row.info()
	}
	return result, nil
}

func (b stateBackend) SetDisplayName(ctx context.Context, id statestore.StoreID, displayName string) error {
	if err := statestore.ValidateDisplayName(displayName); err != nil {
		return err
	}
	return b.transact(ctx, func(tx *sqlx.Tx) error {
		if err := lockStateStore(ctx, tx, id, "FOR UPDATE"); err != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		_, err := tx.ExecContext(ctx, "UPDATE `state_store` SET `display_name`=?,`updated_at`=? WHERE `id`=?", displayName, now, id)
		return err
	})
}

func (b stateBackend) DeleteStore(ctx context.Context, id statestore.StoreID) error {
	return b.transact(ctx, func(tx *sqlx.Tx) error {
		if err := lockStateStore(ctx, tx, id, "FOR UPDATE"); err != nil {
			return err
		}
		return deleteStateStore(ctx, tx, id)
	})
}

func (b stateBackend) DeleteNamespace(ctx context.Context, namespace string) error {
	if err := statestore.ValidateNamespace(namespace); err != nil {
		return err
	}
	return b.transact(ctx, func(tx *sqlx.Tx) error {
		var ids []statestore.StoreID
		if err := tx.SelectContext(ctx, &ids, "SELECT `id` FROM `state_store` WHERE `namespace`=? ORDER BY `name` FOR UPDATE", namespace); err != nil {
			return err
		}
		for _, id := range ids {
			if err := deleteStateStore(ctx, tx, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func lockStateStore(ctx context.Context, tx *sqlx.Tx, id statestore.StoreID, lock string) error {
	var found statestore.StoreID
	err := tx.GetContext(ctx, &found, "SELECT `id` FROM `state_store` WHERE `id`=? "+lock, id)
	if errors.Is(err, sql.ErrNoRows) {
		return statestore.ErrStoreNotFound
	}
	return err
}

func deleteStateStore(ctx context.Context, tx *sqlx.Tx, id statestore.StoreID) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM `state_entry` WHERE `store_id`=?", id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "DELETE FROM `state_store` WHERE `id`=?", id)
	return err
}

func (b stateBackend) transact(ctx context.Context, operation func(*sqlx.Tx) error) error {
	for attempt := 0; ; attempt++ {
		tx, err := b.db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
		if err != nil {
			return err
		}
		err = operation(tx)
		if err == nil {
			return tx.Commit()
		}
		_ = tx.Rollback()
		if attempt >= 2 || ctx.Err() != nil || !stateMySQLError(err, 1205, 1213) {
			return err
		}
	}
}

func stateMySQLError(err error, numbers ...uint16) bool {
	var dbErr *driver.MySQLError
	return errors.As(err, &dbErr) && slices.Contains(numbers, dbErr.Number)
}
