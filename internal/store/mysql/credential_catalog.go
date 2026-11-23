package mysql

import (
	"database/sql"
	"errors"

	c "github.com/ravenmk2/antcdp/internal/modules/credentials"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const entryColumns = "id,scope_kind,scope_id,code,name,description,kind,identifier,enabled,expires_at,row_version,material_version,created_by_user_id"

func (t *identityTx) Entries(scope c.Scope) ([]c.Entry, error) {
	rows := []c.Entry{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+entryColumns+" FROM credential WHERE scope_kind=? AND scope_id=? ORDER BY name,id", scope.Type, scope.Owner)
	return rows, err
}
func (t *identityTx) Entry(id uint64) (*c.Entry, error) {
	var e c.Entry
	err := t.tx.GetContext(t.ctx, &e, "SELECT "+entryColumns+" FROM credential WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &e, err
}
func (t *identityTx) InsertEntry(e *c.Entry) error {
	res, err := t.tx.NamedExecContext(t.ctx, "INSERT INTO credential(scope_kind,scope_id,code,name,description,kind,identifier,ciphertext,enabled,expires_at,created_by_user_id,created_at,updated_at) VALUES(:scope_kind,:scope_id,:code,:name,:description,:kind,:identifier,'',:enabled,:expires_at,:created_by_user_id,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", e)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	e.ID = uint64(id)
	return err
}
func (t *identityTx) UpdateEntry(e *c.Entry) error {
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE credential SET name=:name,description=:description,identifier=:identifier,enabled=:enabled,expires_at=:expires_at,row_version=:row_version,material_version=:material_version,updated_at=UTC_TIMESTAMP(3) WHERE id=:id", e)
	return err
}
func (t *identityTx) MaterialCiphertext(id uint64) (string, error) {
	var v string
	err := t.tx.GetContext(t.ctx, &v, "SELECT ciphertext FROM credential WHERE id=?", id)
	return v, err
}
func (t *identityTx) StoreMaterial(id uint64, v string) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE credential SET ciphertext=? WHERE id=?", v, id)
	return err
}
func (t *identityTx) RemoveEntry(id uint64) error {
	var used bool
	err := t.tx.GetContext(t.ctx, &used, "SELECT EXISTS(SELECT 1 FROM credential_preference WHERE credential_id=?)", id)
	if err != nil {
		return err
	}
	if used {
		return httpx.E(409, "CREDENTIAL_REFERENCED", "请先清除资源首选")
	}
	_, err = t.tx.ExecContext(t.ctx, "DELETE FROM credential WHERE id=?", id)
	return err
}
func (t *identityTx) Preference(kind string, id uint64, scope c.Scope) (*c.Preference, error) {
	var p c.Preference
	err := t.tx.GetContext(t.ctx, &p, "SELECT id,credential_id FROM credential_preference WHERE resource_kind=? AND resource_id=? AND scope_kind=? AND scope_id=?", kind, id, scope.Type, scope.Owner)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}
func (t *identityTx) SetPreference(kind string, id uint64, scope c.Scope, cid *uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM credential_preference WHERE resource_kind=? AND resource_id=? AND scope_kind=? AND scope_id=?", kind, id, scope.Type, scope.Owner); err != nil {
		return err
	}
	if cid == nil {
		return nil
	}
	_, err := t.tx.ExecContext(t.ctx, "INSERT INTO credential_preference(resource_kind,resource_id,scope_kind,scope_id,credential_id) VALUES(?,?,?,?,?)", kind, id, scope.Type, scope.Owner, *cid)
	return err
}
func (t *identityTx) DeletePersonalCredentials(uid uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM credential_preference WHERE scope_kind='user' AND scope_id=?", uid); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM credential WHERE scope_kind='user' AND scope_id=?", uid)
	return err
}
