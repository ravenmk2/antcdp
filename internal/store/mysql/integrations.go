package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const connectionColumns = "id,service_type,code,name,description,enabled,fallback_credential_id,row_version,config_version,credentials_version,fallback_version,created_by_user_id,created_at,updated_at"
const secretProjection = "secret_ciphertext IS NOT NULL AS has_secret,COALESCE(((secret_ciphertext IS NULL AND secret_format_version IS NULL AND secret_key_version IS NULL) OR (secret_ciphertext IS NOT NULL AND secret_format_version=1 AND secret_key_version='v1')),FALSE) AS secret_valid"
const credentialColumns = "id,connection_id,service_type,code,ownership_type,project_id,user_id,name,description,auth_method,auth_schema_version,identity_config,enabled,is_preferred," + secretProjection + ",expires_at,row_version,material_version,created_by_user_id,created_at,updated_at"

func integrationIntegrity() error {
	return httpx.E(500, "DATA_INTEGRITY_ERROR", "服务配置完整性异常")
}
func (t *identityTx) Connections() ([]i.ServiceConnection, error) {
	out := []i.ServiceConnection{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT "+connectionColumns+" FROM service_connection ORDER BY name,id")
	return out, err
}
func (t *identityTx) Connection(id uint64) (*i.ServiceConnection, error) {
	v := &i.ServiceConnection{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+connectionColumns+",config,config_schema_version FROM service_connection WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *identityTx) InsertConnection(v *i.ServiceConnection) error {
	_, err := i.DecodeConnectionConfig(v.Type, v.ConfigSchemaVersion, v.ConfigJSON)
	if err != nil {
		return err
	}
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	result, err := t.tx.NamedExecContext(t.ctx, "INSERT INTO service_connection(service_type,code,name,description,enabled,config,config_schema_version,created_by_user_id,created_at,updated_at) VALUES(:service_type,:code,:name,:description,:enabled,:config,:config_schema_version,:created_by_user_id,:created_at,:updated_at)", v)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	v.ID = uint64(id)
	if v.Type == "gitlab" {
		_, err = t.tx.ExecContext(t.ctx, "INSERT INTO service_connection_gitlab(connection_id) VALUES(?)", v.ID)
	}
	return err
}
func (t *identityTx) SaveConnection(v *i.ServiceConnection) error {
	if _, err := i.DecodeConnectionConfig(v.Type, v.ConfigSchemaVersion, v.ConfigJSON); err != nil {
		return err
	}
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE service_connection SET updated_at=IF(row_version<>:row_version,UTC_TIMESTAMP(3),updated_at),name=:name,description=:description,enabled=:enabled,config=:config,config_schema_version=:config_schema_version,fallback_credential_id=:fallback_credential_id,row_version=:row_version,config_version=:config_version,credentials_version=:credentials_version,fallback_version=:fallback_version WHERE id=:id", v)
	if err != nil {
		return err
	}
	return t.tx.GetContext(t.ctx, &v.UpdatedAt, "SELECT updated_at FROM service_connection WHERE id=?", v.ID)
}
func (t *identityTx) DeleteConnection(id uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM service_connection_gitlab WHERE connection_id=?", id); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM service_connection WHERE id=?", id)
	return err
}
func (t *identityTx) Credentials(id uint64, owner i.CredentialOwnership) ([]i.ServiceCredential, error) {
	rows := []i.ServiceCredential{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+credentialColumns+" FROM service_credential WHERE connection_id=? AND ownership_type=? AND owner_key=? ORDER BY name,id", id, owner.Type, owner.Owner)
	if err != nil {
		return nil, err
	}
	for j := range rows {
		if !rows[j].ValidRecord() {
			return nil, integrationIntegrity()
		}
	}
	return rows, nil
}
func (t *identityTx) Credential(id uint64) (*i.ServiceCredential, error) {
	v := &i.ServiceCredential{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+credentialColumns+" FROM service_credential WHERE id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !v.ValidRecord() {
		return nil, integrationIntegrity()
	}
	return v, nil
}
func (t *identityTx) InsertCredential(v *i.ServiceCredential) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	result, err := t.tx.NamedExecContext(t.ctx, "INSERT INTO service_credential(connection_id,service_type,code,ownership_type,project_id,user_id,name,description,auth_method,auth_schema_version,identity_config,expires_at,created_by_user_id,created_at,updated_at) VALUES(:connection_id,:service_type,:code,:ownership_type,:project_id,:user_id,:name,:description,:auth_method,:auth_schema_version,:identity_config,:expires_at,:created_by_user_id,:created_at,:updated_at)", v)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	v.ID = uint64(id)
	return err
}
func (t *identityTx) SaveCredential(v *i.ServiceCredential) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE service_credential SET name=:name,description=:description,auth_method=:auth_method,auth_schema_version=:auth_schema_version,identity_config=:identity_config,enabled=:enabled,is_preferred=:is_preferred,expires_at=:expires_at,row_version=:row_version,material_version=:material_version,updated_at=:updated_at WHERE id=:id", v)
	return err
}
func (t *identityTx) DeleteCredential(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM service_credential WHERE id=?", id)
	return err
}
func (t *identityTx) CredentialCount(id uint64) (int, error) {
	var n int
	err := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM service_credential WHERE connection_id=?", id)
	return n, err
}
func (t *identityTx) WebhookSettings(id uint64) (*i.WebhookSettings, error) {
	v := &i.WebhookSettings{}
	projection := strings.ReplaceAll(secretProjection, "secret_", "webhook_secret_")
	projection = strings.ReplaceAll(projection, "AS webhook_secret_valid", "AS secret_valid")
	err := t.tx.GetContext(t.ctx, v, "SELECT connection_id,webhook_enabled,webhook_verification_method,"+projection+",webhook_version,webhook_updated_at FROM service_connection_gitlab WHERE connection_id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, integrationIntegrity()
	}
	if err != nil {
		return nil, err
	}
	if !v.ValidRecord() {
		return nil, integrationIntegrity()
	}
	return v, nil
}
func (t *identityTx) SaveWebhookSettings(v *i.WebhookSettings) error {
	now := time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = &now
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE service_connection_gitlab SET webhook_enabled=:webhook_enabled,webhook_verification_method=:webhook_verification_method,webhook_version=:webhook_version,webhook_updated_at=:webhook_updated_at WHERE connection_id=:connection_id", v)
	return err
}
func secretColumns(kind string) (table, prefix, key string) {
	switch kind {
	case "credential":
		return "service_credential", "", "id"
	case "webhook":
		return "service_connection_gitlab", "webhook_", "connection_id"
	}
	panic("invalid secret kind")
}
func (t *identityTx) SetSecret(kind string, id uint64, value string) error {
	table, prefix, key := secretColumns(kind)
	_, err := t.tx.ExecContext(t.ctx, fmt.Sprintf("UPDATE %s SET %ssecret_ciphertext=?,%ssecret_format_version=1,%ssecret_key_version='v1' WHERE %s=?", table, prefix, prefix, prefix, key), value, id)
	return err
}
func (t *identityTx) Secret(kind string, id uint64) (string, error) {
	table, prefix, key := secretColumns(kind)
	var value string
	err := t.tx.GetContext(t.ctx, &value, fmt.Sprintf("SELECT %ssecret_ciphertext FROM %s WHERE %s=? AND %ssecret_format_version=1 AND %ssecret_key_version='v1' AND %ssecret_ciphertext IS NOT NULL", prefix, table, key, prefix, prefix, prefix), id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", integrationIntegrity()
	}
	return value, err
}
func diagnosticColumns(kind string) (table, col, key string) {
	switch kind {
	case "connection":
		return "service_connection", "last_connection_check", "id"
	case "credential":
		return "service_credential", "last_verification", "id"
	case "webhook":
		return "service_connection_gitlab", "webhook_last_receipt", "connection_id"
	}
	panic("invalid diagnostic kind")
}
func (t *identityTx) Diagnostics(kind string, id uint64) (json.RawMessage, error) {
	table, col, key := diagnosticColumns(kind)
	var b []byte
	err := t.tx.GetContext(t.ctx, &b, fmt.Sprintf("SELECT %s FROM %s WHERE %s=?", col, table, key), id)
	return json.RawMessage(b), err
}
func (t *identityTx) SaveDiagnostics(kind string, id uint64, v json.RawMessage) error {
	table, col, key := diagnosticColumns(kind)
	_, err := t.tx.ExecContext(t.ctx, fmt.Sprintf("UPDATE %s SET %s=? WHERE %s=?", table, col, key), []byte(v), id)
	return err
}

// Account deletion already holds the user row; creation takes the same lock.
func (t *identityTx) DeletePersonalServiceCredentials(uid uint64) error {
	ids := []uint64{}
	if err := t.tx.SelectContext(t.ctx, &ids, "SELECT DISTINCT connection_id FROM service_credential WHERE user_id=? ORDER BY connection_id", uid); err != nil {
		return err
	}
	for _, id := range ids {
		v, err := t.Connection(id)
		if err != nil {
			return err
		}
		if v == nil {
			return integrationIntegrity()
		}
		if _, err = t.tx.ExecContext(t.ctx, "DELETE FROM service_credential WHERE connection_id=? AND ownership_type='personal' AND user_id=?", id, uid); err != nil {
			return err
		}
		v.CredentialsVersion++
		if err = t.SaveConnection(v); err != nil {
			return err
		}
	}
	return nil
}
