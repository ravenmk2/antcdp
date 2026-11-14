package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	i "github.com/ravenmk2/antcdp/internal/modules/remotehosts"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"golang.org/x/crypto/ssh"
)

const hostColumns = "id,'ssh' AS service_type,host,port,code,name,description,enabled,fallback_credential_id,row_version,config_version,credentials_version,fallback_version,created_by_user_id,created_at,updated_at"
const hostSecretProjection = "secret_ciphertext IS NOT NULL AS has_secret,COALESCE(((secret_ciphertext IS NULL AND secret_format_version IS NULL AND secret_key_version IS NULL) OR (secret_ciphertext IS NOT NULL AND secret_format_version IN (1,2) AND secret_key_version='v1')),FALSE) AS secret_valid"
const hostCredentialColumns = "id,host_id AS connection_id,'ssh' AS service_type,code,ownership_type,project_id,user_id,name,description,auth_method,1 AS auth_schema_version,JSON_OBJECT('username',username) AS identity_config,username,COALESCE(secret_format_version,0) AS secret_format_version,enabled,is_preferred," + hostSecretProjection + ",expires_at,row_version,material_version,created_by_user_id,created_at,updated_at"

func hostIntegrity() error {
	return httpx.E(500, "DATA_INTEGRITY_ERROR", "服务配置完整性异常")
}
func (t *remoteHostTx) Connections() ([]i.Host, error) {
	out := []i.Host{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT "+hostColumns+" FROM remote_host ORDER BY name,id")
	return out, err
}
func (t *remoteHostTx) Connection(id uint64) (*i.Host, error) {
	v := &i.Host{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+hostColumns+" FROM remote_host WHERE id=? FOR UPDATE", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v.Config = i.Config{Host: v.Hostname, Port: v.Port}
	if err = t.tx.SelectContext(t.ctx, &v.Config.HostKeys, "SELECT public_key FROM remote_host_key WHERE host_id=? ORDER BY id", id); err != nil {
		return nil, err
	}
	v.ConfigSchemaVersion = 1
	v.ConfigJSON, err = json.Marshal(v.Config)
	return v, err
}
func (t *remoteHostTx) InsertConnection(v *i.Host) error {
	_, err := i.DecodeConnectionConfig(v.Type, v.ConfigSchemaVersion, v.ConfigJSON)
	if err != nil {
		return err
	}
	v.Hostname, v.Port = v.Config.Host, v.Config.Port
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	result, err := t.tx.NamedExecContext(t.ctx, "INSERT INTO remote_host(code,name,description,enabled,host,port,created_by_user_id,created_at,updated_at) VALUES(:code,:name,:description,:enabled,:host,:port,:created_by_user_id,:created_at,:updated_at)", v)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	v.ID = uint64(id)
	return err
}
func (t *remoteHostTx) SaveConnection(v *i.Host) error {
	if _, err := i.DecodeConnectionConfig(v.Type, v.ConfigSchemaVersion, v.ConfigJSON); err != nil {
		return err
	}
	v.Hostname, v.Port = v.Config.Host, v.Config.Port
	if err := t.saveHostKeys(v); err != nil {
		return err
	}
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE remote_host SET updated_at=IF(row_version<>:row_version,UTC_TIMESTAMP(3),updated_at),name=:name,description=:description,enabled=:enabled,host=:host,port=:port,fallback_credential_id=:fallback_credential_id,row_version=:row_version,config_version=:config_version,credentials_version=:credentials_version,fallback_version=:fallback_version WHERE id=:id", v)
	if err != nil {
		return err
	}
	return t.tx.GetContext(t.ctx, &v.UpdatedAt, "SELECT updated_at FROM remote_host WHERE id=?", v.ID)
}
func (t *remoteHostTx) DeleteConnection(id uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM remote_host_key WHERE host_id=?", id); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM remote_host WHERE id=?", id)
	return err
}
func (t *remoteHostTx) Credentials(id uint64, owner i.CredentialOwnership) ([]i.Credential, error) {
	rows := []i.Credential{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+hostCredentialColumns+" FROM remote_host_credential WHERE host_id=? AND ownership_type=? AND owner_key=? ORDER BY name,id", id, owner.Type, owner.Owner)
	if err != nil {
		return nil, err
	}
	for j := range rows {
		if !rows[j].ValidRecord() {
			return nil, hostIntegrity()
		}
	}
	return rows, nil
}
func (t *remoteHostTx) Credential(id uint64) (*i.Credential, error) {
	v := &i.Credential{}
	err := t.tx.GetContext(t.ctx, v, "SELECT "+hostCredentialColumns+" FROM remote_host_credential WHERE id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !v.ValidRecord() {
		return nil, hostIntegrity()
	}
	return v, nil
}
func (t *remoteHostTx) InsertCredential(v *i.Credential) error {
	if err := hostUsername(v); err != nil {
		return err
	}
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	result, err := t.tx.NamedExecContext(t.ctx, "INSERT INTO remote_host_credential(host_id,code,ownership_type,project_id,user_id,name,description,auth_method,username,expires_at,created_by_user_id,created_at,updated_at) VALUES(:connection_id,:code,:ownership_type,:project_id,:user_id,:name,:description,:auth_method,:username,:expires_at,:created_by_user_id,:created_at,:updated_at)", v)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	v.ID = uint64(id)
	return err
}
func (t *remoteHostTx) SaveCredential(v *i.Credential) error {
	if err := hostUsername(v); err != nil {
		return err
	}
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE remote_host_credential SET name=:name,description=:description,auth_method=:auth_method,username=:username,enabled=:enabled,is_preferred=:is_preferred,expires_at=:expires_at,row_version=:row_version,material_version=:material_version,updated_at=:updated_at WHERE id=:id", v)
	return err
}
func (t *remoteHostTx) DeleteCredential(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM remote_host_credential WHERE id=?", id)
	return err
}
func (t *remoteHostTx) CredentialCount(id uint64) (int, error) {
	var n int
	err := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM remote_host_credential WHERE host_id=?", id)
	return n, err
}
func hostSecretColumns(kind string) (table, prefix, key string) {
	switch kind {
	case "credential":
		return "remote_host_credential", "", "id"
	}
	panic("invalid secret kind")
}
func (t *remoteHostTx) SetSecret(kind string, id uint64, value string) error {
	table, prefix, key := hostSecretColumns(kind)
	_, err := t.tx.ExecContext(t.ctx, fmt.Sprintf("UPDATE %s SET %ssecret_ciphertext=?,%ssecret_format_version=2,%ssecret_key_version='v1' WHERE %s=?", table, prefix, prefix, prefix, key), value, id)
	return err
}
func (t *remoteHostTx) Secret(kind string, id uint64) (string, error) {
	table, prefix, key := hostSecretColumns(kind)
	var value string
	err := t.tx.GetContext(t.ctx, &value, fmt.Sprintf("SELECT %ssecret_ciphertext FROM %s WHERE %s=? AND %ssecret_format_version IN (1,2) AND %ssecret_key_version='v1' AND %ssecret_ciphertext IS NOT NULL", prefix, table, key, prefix, prefix, prefix), id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", hostIntegrity()
	}
	return value, err
}
func hostDiagnosticColumns(kind string) (table, col, key string) {
	switch kind {
	case "connection":
		return "remote_host", "last_connection_check", "id"
	case "credential":
		return "remote_host_credential", "last_verification", "id"
	}
	panic("invalid diagnostic kind")
}
func (t *remoteHostTx) Diagnostics(kind string, id uint64) (json.RawMessage, error) {
	table, col, key := hostDiagnosticColumns(kind)
	var b []byte
	err := t.tx.GetContext(t.ctx, &b, fmt.Sprintf("SELECT %s FROM %s WHERE %s=?", col, table, key), id)
	return json.RawMessage(b), err
}
func (t *remoteHostTx) SaveDiagnostics(kind string, id uint64, v json.RawMessage) error {
	table, col, key := hostDiagnosticColumns(kind)
	_, err := t.tx.ExecContext(t.ctx, fmt.Sprintf("UPDATE %s SET %s=? WHERE %s=?", table, col, key), []byte(v), id)
	return err
}

type remoteHostTx struct{ *identityTx }

func (t *identityTx) RemoteHosts() i.Repository { return &remoteHostTx{t} }
func hostUsername(v *i.Credential) error {
	var value struct {
		Username string `json:"username"`
	}
	if err := json.Unmarshal(v.Identity, &value); err != nil {
		return err
	}
	v.Username = value.Username
	return nil
}
func (t *remoteHostTx) saveHostKeys(v *i.Host) error {
	var old []string
	if err := t.tx.SelectContext(t.ctx, &old, "SELECT public_key FROM remote_host_key WHERE host_id=?", v.ID); err != nil {
		return err
	}
	retained := map[string]bool{}
	for _, raw := range v.Config.HostKeys {
		retained[raw] = true
	}
	for _, raw := range old {
		if !retained[raw] {
			if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM remote_host_key WHERE host_id=? AND public_key=?", v.ID, raw); err != nil {
				return err
			}
		} else {
			delete(retained, raw)
		}
	}
	for raw := range retained {
		key, _, _, _, err := ssh.ParseAuthorizedKey([]byte(raw))
		if err != nil {
			return err
		}
		if v.TrustActor == 0 {
			return hostIntegrity()
		}
		if _, err = t.tx.ExecContext(t.ctx, "INSERT INTO remote_host_key(host_id,algorithm,public_key,fingerprint_sha256,trusted_by_user_id,trusted_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))", v.ID, key.Type(), raw, ssh.FingerprintSHA256(key), v.TrustActor); err != nil {
			return err
		}
	}
	return nil
}
func (t *identityTx) DeletePersonalRemoteHostCredentials(uid uint64) error {
	var ids []uint64
	if err := t.tx.SelectContext(t.ctx, &ids, "SELECT DISTINCT host_id FROM remote_host_credential WHERE user_id=? ORDER BY host_id", uid); err != nil {
		return err
	}
	r := t.RemoteHosts()
	for _, id := range ids {
		v, err := r.Connection(id)
		if err != nil {
			return err
		}
		if v == nil {
			return hostIntegrity()
		}
		if _, err = t.tx.ExecContext(t.ctx, "DELETE FROM remote_host_credential WHERE host_id=? AND ownership_type='personal' AND user_id=?", id, uid); err != nil {
			return err
		}
		v.CredentialsVersion++
		if err = r.SaveConnection(v); err != nil {
			return err
		}
	}
	return nil
}
