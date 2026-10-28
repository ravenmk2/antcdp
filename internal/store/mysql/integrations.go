package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

const integrationColumns = "id,service_type,name,description,enabled,default_credential_id,row_version,credentials_version,default_version,created_by_user_id,created_at,updated_at"
const gitlabColumns = "integration_id,base_url,custom_ca_pem,webhook_enabled,webhook_verification_method,webhook_secret_ciphertext IS NOT NULL AS has_secret,row_version,connection_version,webhook_version"
const credentialColumns = "id,integration_id,service_type,code,scope_type,project_id,user_id,name,description,auth_method,identity_config,enabled,is_preferred,secret_ciphertext IS NOT NULL AS has_secret,expires_at,row_version,material_version,created_by_user_id"

func (t *identityTx) Integrations() ([]i.Integration, error) {
	out := []i.Integration{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+integrationColumns+" FROM integration ORDER BY name,id")
	return out, e
}
func (t *identityTx) Integration(id uint64) (*i.Integration, error) {
	o := &i.Integration{}
	e := t.tx.GetContext(t.ctx, o, "SELECT "+integrationColumns+" FROM integration WHERE id=? FOR UPDATE", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return o, e
}
func (t *identityTx) GitLab(id uint64) (*i.GitLab, error) {
	o := &i.GitLab{}
	e := t.tx.GetContext(t.ctx, o, "SELECT "+gitlabColumns+" FROM integration_gitlab WHERE integration_id=?", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return o, e
}
func (t *identityTx) InsertIntegration(o *i.Integration, g *i.GitLab) error {
	r, e := t.tx.ExecContext(t.ctx, "INSERT INTO integration(service_type,name,description,enabled,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", o.Type, o.Name, o.Description, o.Enabled, o.Creator)
	if e != nil {
		return e
	}
	id, e := r.LastInsertId()
	if e != nil {
		return e
	}
	o.ID = uint64(id)
	g.ID = o.ID
	_, e = t.tx.ExecContext(t.ctx, "INSERT INTO integration_gitlab(integration_id,base_url,custom_ca_pem,created_at,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", o.ID, g.BaseURL, g.CA)
	return e
}
func (t *identityTx) SaveIntegration(o *i.Integration) error {
	_, e := t.tx.NamedExecContext(t.ctx, "UPDATE integration SET updated_at=IF(row_version<>:row_version,UTC_TIMESTAMP(3),updated_at),name=:name,description=:description,enabled=:enabled,default_credential_id=:default_credential_id,row_version=:row_version,credentials_version=:credentials_version,default_version=:default_version WHERE id=:id", o)
	return e
}
func (t *identityTx) SaveGitLab(g *i.GitLab) error {
	_, e := t.tx.NamedExecContext(t.ctx, "UPDATE integration_gitlab SET base_url=:base_url,custom_ca_pem=:custom_ca_pem,webhook_enabled=:webhook_enabled,webhook_verification_method=:webhook_verification_method,row_version=:row_version,connection_version=:connection_version,webhook_version=:webhook_version,updated_at=UTC_TIMESTAMP(3) WHERE integration_id=:integration_id", g)
	return e
}
func (t *identityTx) DeleteIntegration(id uint64) error {
	if _, e := t.tx.ExecContext(t.ctx, "DELETE FROM integration_gitlab WHERE integration_id=?", id); e != nil {
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM integration WHERE id=?", id)
	return e
}
func (t *identityTx) Credentials(id uint64, s i.Scope) ([]i.Credential, error) {
	out := []i.Credential{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+credentialColumns+" FROM integration_credential WHERE integration_id=? AND scope_type=? AND owner_key=? ORDER BY name,id", id, s.Type, s.Owner)
	return out, e
}
func (t *identityTx) Credential(id uint64) (*i.Credential, error) {
	o := &i.Credential{}
	e := t.tx.GetContext(t.ctx, o, "SELECT "+credentialColumns+" FROM integration_credential WHERE id=?", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return o, e
}
func (t *identityTx) InsertCredential(c *i.Credential) error {
	r, e := t.tx.NamedExecContext(t.ctx, "INSERT INTO integration_credential(integration_id,service_type,code,scope_type,project_id,user_id,name,description,auth_method,identity_config,expires_at,created_by_user_id,created_at,updated_at) VALUES(:integration_id,:service_type,:code,:scope_type,:project_id,:user_id,:name,:description,:auth_method,:identity_config,:expires_at,:created_by_user_id,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", c)
	if e != nil {
		return e
	}
	id, e := r.LastInsertId()
	c.ID = uint64(id)
	return e
}
func (t *identityTx) SaveCredential(c *i.Credential) error {
	_, e := t.tx.NamedExecContext(t.ctx, "UPDATE integration_credential SET name=:name,description=:description,enabled=:enabled,is_preferred=:is_preferred,expires_at=:expires_at,row_version=:row_version,material_version=:material_version,updated_at=UTC_TIMESTAMP(3) WHERE id=:id", c)
	return e
}
func (t *identityTx) DeleteCredential(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM integration_credential WHERE id=?", id)
	return e
}
func (t *identityTx) CredentialCount(id uint64) (int, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM integration_credential WHERE integration_id=?", id)
	return n, e
}
func secretColumns(kind string) (table, id, col string) {
	if kind == "webhook" {
		return "integration_gitlab", "integration_id", "webhook_secret_ciphertext"
	}
	if kind == "credential" {
		return "integration_credential", "id", "secret_ciphertext"
	}
	panic("invalid secret kind")
}
func (t *identityTx) SetSecret(kind string, id uint64, value string) error {
	table, key, col := secretColumns(kind)
	_, e := t.tx.ExecContext(t.ctx, fmt.Sprintf("UPDATE %s SET %s=?,secret_format_version=1,secret_key_version='v1' WHERE %s=?", table, col, key), value, id)
	return e
}
func (t *identityTx) Secret(kind string, id uint64) (string, error) {
	table, key, col := secretColumns(kind)
	var value string
	e := t.tx.GetContext(t.ctx, &value, fmt.Sprintf("SELECT %s FROM %s WHERE %s=? AND secret_format_version=1 AND secret_key_version='v1'", col, table, key), id)
	return value, e
}
func diagnosticColumns(kind string) (table, key, col string) {
	switch kind {
	case "connection":
		return "integration_gitlab", "integration_id", "last_connection_check"
	case "webhook":
		return "integration_gitlab", "integration_id", "last_webhook_receipt"
	case "credential":
		return "integration_credential", "id", "last_verification"
	}
	panic("invalid diagnostic kind")
}
func (t *identityTx) Diagnostics(kind string, id uint64) (json.RawMessage, error) {
	table, key, col := diagnosticColumns(kind)
	var v []byte
	e := t.tx.GetContext(t.ctx, &v, fmt.Sprintf("SELECT %s FROM %s WHERE %s=?", col, table, key), id)
	return json.RawMessage(v), e
}
func (t *identityTx) SaveDiagnostics(kind string, id uint64, v json.RawMessage) error {
	table, key, col := diagnosticColumns(kind)
	_, e := t.tx.ExecContext(t.ctx, fmt.Sprintf("UPDATE %s SET %s=? WHERE %s=?", table, col, key), []byte(v), id)
	return e
}

// The account row is already locked; creators of personal credentials take the same lock.
func (t *identityTx) DeletePersonalIntegrationCredentials(uid uint64) error {
	var ids []uint64
	if e := t.tx.SelectContext(t.ctx, &ids, "SELECT DISTINCT integration_id FROM integration_credential WHERE user_id=? ORDER BY integration_id", uid); e != nil {
		return e
	}
	for _, id := range ids {
		v, e := t.Integration(id)
		if e != nil {
			return e
		}
		if v == nil {
			return errors.New("orphaned integration credential")
		}
		if _, e = t.tx.ExecContext(t.ctx, "DELETE FROM integration_credential WHERE integration_id=? AND scope_type='personal' AND user_id=?", id, uid); e != nil {
			return e
		}
		v.CredentialsVersion++
		if e = t.SaveIntegration(v); e != nil {
			return e
		}
	}
	return nil
}
