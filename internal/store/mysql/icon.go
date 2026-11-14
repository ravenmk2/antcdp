package mysql

import (
	"database/sql"
	"errors"
	"slices"
	"time"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
)

const iconColumns = "id,storage_key,sha256,size_bytes,uploaded_by_user_id,state,expires_at,orphaned_at,created_at"

func (t *identityTx) Icons(ids []uint64, lock bool) (map[uint64]*c.IconFile, error) {
	ids = append([]uint64{}, ids...)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	out := map[uint64]*c.IconFile{}
	for _, id := range ids {
		v := &c.IconFile{}
		q := "SELECT " + iconColumns + " FROM icon_file WHERE id=?"
		if lock {
			q += " FOR UPDATE"
		}
		err := t.tx.GetContext(t.ctx, v, q, id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[id] = v
	}
	return out, nil
}
func (t *identityTx) InsertIcon(v *c.IconFile) error {
	r, e := t.tx.ExecContext(t.ctx, "INSERT INTO icon_file(storage_key,content_type,width,height,size_bytes,sha256,uploaded_by_user_id,state,expires_at,created_at) VALUES (?,'image/png',256,256,?,?,?,'staged',?,?)", v.Key, v.Size, v.Hash, v.UploaderID, v.ExpiresAt, v.CreatedAt)
	if e != nil {
		return e
	}
	id, e := r.LastInsertId()
	v.ID = uint64(id)
	return e
}
func (t *identityTx) IconState(id uint64, state string, now time.Time) error {
	var orphan *time.Time
	if state == "orphaned" {
		orphan = &now
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE icon_file SET state=?,expires_at=NULL,orphaned_at=? WHERE id=?", state, orphan, id)
	return e
}
func (t *identityTx) DeleteIcon(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM icon_file WHERE id=?", id)
	return e
}
func (t *identityTx) IconOwner(id uint64) (c.Kind, uint64, error) {
	for _, k := range []c.Kind{c.Team, c.Project} {
		var owner uint64
		e := t.tx.GetContext(t.ctx, &owner, "SELECT id FROM "+collabTable(k)+" WHERE icon_file_id=?", id)
		if e == nil {
			return k, owner, nil
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return "", 0, e
		}
	}
	return "", 0, nil
}
func (t *identityTx) ExpiredIcons(now time.Time) ([]c.IconFile, error) {
	out := []c.IconFile{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+iconColumns+" FROM icon_file WHERE ((state='staged' AND expires_at<=?) OR (state='orphaned' AND orphaned_at<=?)) AND NOT EXISTS(SELECT 1 FROM project WHERE icon_file_id=icon_file.id) AND NOT EXISTS(SELECT 1 FROM team WHERE icon_file_id=icon_file.id) ORDER BY id LIMIT 100 FOR UPDATE", now, now.Add(-24*time.Hour))
	return out, e
}
func (t *identityTx) IconKeyExists(key string) (bool, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM icon_file WHERE storage_key=?", key)
	return n > 0, e
}
