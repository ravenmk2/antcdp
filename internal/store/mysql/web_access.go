package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	m "github.com/ravenmk2/antcdp/internal/modules/webaccess"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

type webAccessTx struct {
	ctx context.Context
	tx  *sqlx.Tx
}

func (t *identityTx) WebAccess() m.Repository { return &webAccessTx{t.ctx, t.tx} }

const webAccessProviderColumns = "p.id,p.code,p.name,p.description,p.provider_type,p.base_url,p.auth_method,p.identity_config,p.supported_operations,p.enabled,p.config,p.config_schema_version,p.secret_revision,p.row_version,p.config_version,COALESCE(p.last_diagnostic,CAST('{}' AS JSON)) AS last_diagnostic,p.created_by_user_id,p.created_at,p.updated_at,p.secret_ciphertext IS NOT NULL AS has_secret,COALESCE(((p.secret_ciphertext IS NULL AND p.secret_format_version IS NULL AND p.secret_key_version IS NULL) OR (p.secret_ciphertext IS NOT NULL AND p.secret_format_version IN (1,2) AND p.secret_key_version='v1')),FALSE) AS secret_valid"
const webAccessSettingColumns = "search_routes,search_max_results,fetch_routes,fetch_max_bytes,fetch_timeout_seconds,fetch_max_redirects,fetch_allowed_internal_hosts,row_version,updated_by_user_id,created_at,updated_at"

func webAccessError(err error) error {
	var e *driver.MySQLError
	if errors.As(err, &e) && e.Number == 1062 {
		// Parse only the constraint suffix; a duplicated user value may itself
		// contain an index name and must not select a different error field.
		constraint := ""
		if at := strings.LastIndex(e.Message, " for key '"); at >= 0 {
			constraint = strings.TrimSuffix(e.Message[at+len(" for key '"):], "'")
			if dot := strings.LastIndexByte(constraint, '.'); dot >= 0 {
				constraint = constraint[dot+1:]
			}
		}
		for _, rule := range []struct{ key, code, field, message string }{
			{"uq_web_access_provider_code", "CODE_CONFLICT", "code", "编码已被使用"},
			{"uq_web_access_provider_name", "NAME_CONFLICT", "name", "名称已被使用"},
		} {
			if constraint == rule.key {
				failure := httpx.E(409, rule.code, rule.message)
				failure.Details = []httpx.Detail{{Code: "conflict", Field: rule.field}}
				return failure
			}
		}
		return httpx.E(409, "RESOURCE_CONFLICT", "名称或标识已存在")
	}
	return err
}
func (t *webAccessTx) named(query string, v any) (sql.Result, error) {
	r, e := t.tx.NamedExecContext(t.ctx, query, v)
	return r, webAccessError(e)
}
func (t *webAccessTx) Provider(id uint64) (*m.Provider, error) {
	v := &m.Provider{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+webAccessProviderColumns+" FROM web_access_provider p WHERE p.id=? FOR UPDATE", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *webAccessTx) InsertProvider(v *m.Provider) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	r, e := t.named("INSERT INTO web_access_provider(code,name,description,provider_type,base_url,auth_method,identity_config,supported_operations,enabled,config,config_schema_version,secret_revision,row_version,config_version,created_by_user_id,created_at,updated_at) VALUES(:code,:name,:description,:provider_type,:base_url,:auth_method,:identity_config,:supported_operations,:enabled,:config,:config_schema_version,:secret_revision,:row_version,:config_version,:created_by_user_id,:created_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *webAccessTx) SaveProvider(v *m.Provider) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.named("UPDATE web_access_provider SET name=:name,description=:description,base_url=:base_url,auth_method=:auth_method,enabled=:enabled,config=:config,secret_revision=:secret_revision,row_version=:row_version,config_version=:config_version,updated_at=:updated_at WHERE id=:id", v)
	return e
}
func (t *webAccessTx) DeleteProvider(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM web_access_provider WHERE id=?", id)
	return e
}
func (t *webAccessTx) SetSecret(id uint64, value string) error {
	if value == "" {
		_, e := t.tx.ExecContext(t.ctx, "UPDATE web_access_provider SET secret_ciphertext=NULL,secret_format_version=NULL,secret_key_version=NULL WHERE id=?", id)
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE web_access_provider SET secret_ciphertext=?,secret_format_version=2,secret_key_version='v1' WHERE id=?", value, id)
	return e
}
func (t *webAccessTx) Secret(id uint64) (string, error) {
	var value sql.NullString
	e := t.tx.GetContext(t.ctx, &value, "SELECT secret_ciphertext FROM web_access_provider WHERE id=?", id)
	if errors.Is(e, sql.ErrNoRows) {
		return "", nil
	}
	return value.String, e
}
func (t *webAccessTx) Providers(q m.Query) ([]m.Provider, int, error) {
	conditions := []string{"1=1"}
	args := []any{}
	if q.Q != "" {
		p := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q) + "%"
		conditions = append(conditions, "(p.name LIKE ? ESCAPE '!' OR p.code LIKE ? ESCAPE '!')")
		args = append(args, p, p)
	}
	if q.Enabled != nil {
		conditions = append(conditions, "p.enabled=?")
		args = append(args, *q.Enabled)
	}
	if q.ProviderType != "" {
		conditions = append(conditions, "p.provider_type=?")
		args = append(args, q.ProviderType)
	}
	if q.Operation != "" {
		conditions = append(conditions, "JSON_CONTAINS(p.supported_operations,JSON_QUOTE(?))")
		args = append(args, q.Operation)
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM web_access_provider p WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []m.Provider{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+webAccessProviderColumns+" FROM web_access_provider p WHERE "+where+" ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *webAccessTx) Settings() (*m.SettingsRow, error) {
	v := &m.SettingsRow{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+webAccessSettingColumns+" FROM web_access_setting WHERE id=1 FOR UPDATE")
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *webAccessTx) SaveSettings(v *m.SettingsRow) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.named("UPDATE web_access_setting SET search_routes=:search_routes,search_max_results=:search_max_results,fetch_routes=:fetch_routes,fetch_max_bytes=:fetch_max_bytes,fetch_timeout_seconds=:fetch_timeout_seconds,fetch_max_redirects=:fetch_max_redirects,fetch_allowed_internal_hosts=:fetch_allowed_internal_hosts,row_version=:row_version,updated_by_user_id=:updated_by_user_id,updated_at=:updated_at WHERE id=1", v)
	return e
}
func (t *webAccessTx) ProviderReferenced(id uint64) (bool, error) {
	// The singleton is the lock that serializes route selection and provider deletion.
	row, e := t.Settings()
	if e != nil {
		return false, e
	}
	if row == nil {
		return false, httpx.E(500, "DATA_INTEGRITY_ERROR", "网络检索设置缺失")
	}
	for _, b := range []json.RawMessage{row.SearchRoutes, row.FetchRoutes} {
		var routes []runtime.RouteRef
		if json.Unmarshal(b, &routes) != nil {
			return false, httpx.E(500, "DATA_INTEGRITY_ERROR", "网络检索设置异常")
		}
		for _, r := range routes {
			if r.Kind == "provider" && r.ID == strconv.FormatUint(id, 10) {
				return true, nil
			}
		}
	}
	return false, nil
}
func (t *webAccessTx) RecordDiagnostic(id uint64, capability string, v m.StoredDiagnostic) error {
	if capability != "search" && capability != "fetch" {
		return httpx.Invalid("operation", "unsupported")
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx, "UPDATE web_access_provider SET last_diagnostic=JSON_SET(COALESCE(last_diagnostic,JSON_OBJECT()),?,CAST(? AS JSON)),last_diagnostic_at=? WHERE id=?", "$."+capability, string(data), v.Diagnostic.FinishedAt, id)
	return err
}
