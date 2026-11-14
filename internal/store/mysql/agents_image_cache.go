package mysql

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

const imageCacheColumns = "id,cache_key,state,payload,lease_token,lease_until,last_used_at,created_at,updated_at"

func imageCacheTable(kind string) (string, error) {
	switch kind {
	case "variant":
		return "`agent_image_variant`", nil
	case "remote":
		return "`agent_model_file`", nil
	default:
		return "", fmt.Errorf("invalid image cache kind")
	}
}

func (t *agentsTx) EnsureImageCache(kind string, key []byte, now time.Time) error {
	table, err := imageCacheTable(kind)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx, "INSERT INTO "+table+"(cache_key,state,payload,lease_token,last_used_at,created_at,updated_at) VALUES(?,'empty',JSON_OBJECT(),'',?,?,?) ON DUPLICATE KEY UPDATE id=id", key, now, now, now)
	return err
}

func (t *agentsTx) ImageCache(kind string, key []byte, lock bool) (*a.ImageCacheRow, error) {
	table, err := imageCacheTable(kind)
	if err != nil {
		return nil, err
	}
	query := "SELECT " + imageCacheColumns + " FROM " + table + " WHERE cache_key=?"
	if lock {
		query += " FOR UPDATE"
	}
	var row a.ImageCacheRow
	err = t.tx.GetContext(t.ctx, &row, query, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &row, err
}

func (t *agentsTx) SaveImageCache(kind string, row *a.ImageCacheRow) error {
	table, err := imageCacheTable(kind)
	if err != nil {
		return err
	}
	_, err = t.tx.NamedExecContext(t.ctx, "UPDATE "+table+" SET state=:state,payload=:payload,lease_token=:lease_token,lease_until=:lease_until,last_used_at=:last_used_at,updated_at=:updated_at WHERE id=:id AND cache_key=:cache_key", row)
	return err
}

func (t *agentsTx) ImageCacheCandidates(kind string, before time.Time, limit int) ([]a.ImageCacheRow, error) {
	table, err := imageCacheTable(kind)
	if err != nil {
		return nil, err
	}
	rows := []a.ImageCacheRow{}
	err = t.tx.SelectContext(t.ctx, &rows, "SELECT "+imageCacheColumns+" FROM "+table+" WHERE last_used_at<? AND (lease_until IS NULL OR lease_until<?) ORDER BY last_used_at,id LIMIT ?", before, time.Now().UTC(), limit)
	return rows, err
}

func (t *agentsTx) DeleteImageCache(kind string, key []byte, token string) error {
	table, err := imageCacheTable(kind)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx, "DELETE FROM "+table+" WHERE cache_key=? AND lease_token=?", key, token)
	return err
}
