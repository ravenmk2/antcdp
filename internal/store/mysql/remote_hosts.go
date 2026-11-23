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

const hostColumns = "id,'ssh' AS service_type,host,port,code,name,description,enabled,row_version,config_version,credentials_version,created_by_user_id,created_at,updated_at"

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
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE remote_host SET updated_at=IF(row_version<>:row_version,UTC_TIMESTAMP(3),updated_at),name=:name,description=:description,enabled=:enabled,host=:host,port=:port,row_version=:row_version,config_version=:config_version,credentials_version=:credentials_version WHERE id=:id", v)
	if err != nil {
		return err
	}
	return t.tx.GetContext(t.ctx, &v.UpdatedAt, "SELECT updated_at FROM remote_host WHERE id=?", v.ID)
}
func (t *remoteHostTx) DeleteConnection(id uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM credential_preference WHERE resource_kind='remote_host' AND resource_id=?", id); err != nil {
		return err
	}
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM remote_host_key WHERE host_id=?", id); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM remote_host WHERE id=?", id)
	return err
}
func hostDiagnosticColumns(kind string) (table, col, key string) {
	switch kind {
	case "connection":
		return "remote_host", "last_connection_check", "id"
	case "credential":
		return "credential_preference", "last_verification", "id"
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
