package mysql

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

type stateKV struct {
	backend stateBackend
	id      statestore.StoreID
}

func (kv stateKV) Get(ctx context.Context, key string) (statestore.Entry, error) {
	if err := statestore.ValidateKey(key); err != nil {
		return statestore.Entry{}, err
	}
	var row struct {
		Value []byte `db:"value"`
		ETag  []byte `db:"etag"`
	}
	err := kv.backend.db.GetContext(ctx, &row, "SELECT e.`value`,e.`etag` FROM `state_store` s LEFT JOIN `state_entry` e ON e.`store_id`=s.`id` AND e.`entry_key`=? WHERE s.`id`=?", key, kv.id)
	if errors.Is(err, sql.ErrNoRows) {
		return statestore.Entry{}, statestore.ErrStoreNotFound
	}
	if err != nil {
		return statestore.Entry{}, err
	}
	if row.ETag == nil {
		return statestore.Entry{}, statestore.ErrKeyNotFound
	}
	return statestore.Entry{Value: row.Value, ETag: statestore.ETag(hex.EncodeToString(row.ETag))}, nil
}

func (kv stateKV) Put(ctx context.Context, key string, value []byte, opts statestore.PutOptions) (statestore.ETag, error) {
	if err := statestore.ValidateKey(key); err != nil {
		return "", err
	}
	if len(value) > statestore.MaxValueBytes {
		return "", fmt.Errorf("%w: state value exceeds %d bytes", statestore.ErrInvalidArgument, statestore.MaxValueBytes)
	}
	if opts.IfAbsent && opts.IfMatch != "" {
		return "", fmt.Errorf("%w: IfAbsent and IfMatch are mutually exclusive", statestore.ErrInvalidArgument)
	}
	if value == nil {
		value = []byte{}
	}
	tag := cryptox.Random(16)
	err := kv.backend.transact(ctx, func(tx *sqlx.Tx) error {
		if err := lockStateStore(ctx, tx, kv.id, "FOR SHARE"); err != nil {
			return err
		}
		if opts.IfMatch != "" {
			match, err := stateETagBytes(opts.IfMatch)
			if err != nil {
				return err
			}
			result, err := tx.ExecContext(ctx, "UPDATE `state_entry` SET `value`=?,`etag`=?,`updated_at`=UTC_TIMESTAMP(3) WHERE `store_id`=? AND `entry_key`=? AND `etag`=?", value, tag, kv.id, key, match)
			return stateConditionalResult(result, err)
		}
		query := "INSERT INTO `state_entry` (`store_id`,`entry_key`,`value`,`etag`,`created_at`,`updated_at`) VALUES (?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"
		if !opts.IfAbsent {
			query += " ON DUPLICATE KEY UPDATE `value`=VALUES(`value`),`etag`=VALUES(`etag`),`updated_at`=VALUES(`updated_at`)"
		}
		_, err := tx.ExecContext(ctx, query, kv.id, key, value, tag)
		if opts.IfAbsent && stateMySQLError(err, 1062) {
			return statestore.ErrConflict
		}
		return err
	})
	if err != nil {
		return "", err
	}
	return statestore.ETag(hex.EncodeToString(tag)), nil
}

func (kv stateKV) Delete(ctx context.Context, key string, opts statestore.DeleteOptions) error {
	if err := statestore.ValidateKey(key); err != nil {
		return err
	}
	return kv.backend.transact(ctx, func(tx *sqlx.Tx) error {
		if err := lockStateStore(ctx, tx, kv.id, "FOR SHARE"); err != nil {
			return err
		}
		const query = "DELETE FROM `state_entry` WHERE `store_id`=? AND `entry_key`=?"
		if opts.IfMatch == "" {
			_, err := tx.ExecContext(ctx, query, kv.id, key)
			return err
		}
		match, err := stateETagBytes(opts.IfMatch)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, query+" AND `etag`=?", kv.id, key, match)
		return stateConditionalResult(result, err)
	})
}

func stateETagBytes(tag statestore.ETag) ([]byte, error) {
	if len(tag) != 32 {
		return nil, statestore.ErrConflict
	}
	value, err := hex.DecodeString(string(tag))
	if err != nil || hex.EncodeToString(value) != string(tag) {
		return nil, statestore.ErrConflict
	}
	return value, nil
}

func stateConditionalResult(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return statestore.ErrConflict
	}
	return err
}
