package mysql

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type modelsTx struct {
	ctx context.Context
	tx  *sqlx.Tx
}

func (t *identityTx) Models() m.Repository { return &modelsTx{t.ctx, t.tx} }

const modelProviderColumns = "p.id,p.icon_key,p.code,p.name,p.description,p.provider_type,p.base_url,p.auth_method,p.identity_config,p.enabled,p.config,p.config_schema_version,p.secret_revision,p.row_version,p.config_version,p.created_by_user_id,p.created_at,p.updated_at,p.secret_ciphertext IS NOT NULL AS has_secret,COALESCE(((p.secret_ciphertext IS NULL AND p.secret_format_version IS NULL AND p.secret_key_version IS NULL) OR (p.secret_ciphertext IS NOT NULL AND p.secret_format_version IN (1,2) AND p.secret_key_version='v1')),FALSE) AS secret_valid,(SELECT COUNT(*) FROM model_definition d WHERE d.provider_id=p.id) AS model_count"
const modelDefinitionColumns = "id,icon_key,provider_id,model_id,name,description,protocol,enabled,capabilities,capability_schema_version,generation_defaults,thinking_options,context_window_tokens,max_output_tokens,row_version,config_version,created_by_user_id,created_at,updated_at"

func modelsError(err error) error {
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
			{"uq_model_provider_code", "CODE_CONFLICT", "code", "编码已被使用"},
			{"uq_model_provider_name", "NAME_CONFLICT", "name", "名称已被使用"},
			{"uq_model_definition_route", "MODEL_ROUTE_CONFLICT", "model_id", "此提供商已配置相同协议和远端模型"},
		} {
			if constraint == rule.key {
				failure := httpx.E(409, rule.code, rule.message)
				failure.Details = []httpx.Detail{{Code: "conflict", Field: rule.field}}
				return failure
			}
		}
		return httpx.E(409, "RESOURCE_CONFLICT", "名称、标识或模型路由已存在")
	}
	return err
}
func (t *modelsTx) named(query string, v any) (sql.Result, error) {
	r, e := t.tx.NamedExecContext(t.ctx, query, v)
	return r, modelsError(e)
}
func modelID(result sql.Result, err error, target *uint64) error {
	if err != nil {
		return err
	}
	id, e := result.LastInsertId()
	if e != nil {
		return e
	}
	*target = uint64(id)
	return nil
}
func filterModels(q m.Query, provider bool) (string, []any) {
	conditions := []string{"1=1"}
	args := []any{}
	prefix := ""
	if provider {
		prefix = "p."
	}
	if q.Q != "" {
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q) + "%"
		if provider {
			conditions = append(conditions, "(p.name LIKE ? ESCAPE '!' OR p.code LIKE ? ESCAPE '!')")
		} else {
			conditions = append(conditions, "(name LIKE ? ESCAPE '!' OR model_id LIKE ? ESCAPE '!')")
		}
		args = append(args, pattern, pattern)
	}
	if q.Enabled != nil {
		conditions = append(conditions, prefix+"enabled=?")
		args = append(args, *q.Enabled)
	}
	if provider && q.ProviderType != "" {
		conditions = append(conditions, "p.provider_type=?")
		args = append(args, q.ProviderType)
	}
	if !provider && q.ProviderID != 0 {
		conditions = append(conditions, "provider_id=?")
		args = append(args, q.ProviderID)
	}
	if !provider && q.Protocol != "" {
		conditions = append(conditions, "protocol=?")
		args = append(args, q.Protocol)
	}
	return strings.Join(conditions, " AND "), args
}
func (t *modelsTx) Providers(q m.Query) ([]m.Provider, int, error) {
	where, args := filterModels(q, true)
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM model_provider p WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []m.Provider{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+modelProviderColumns+" FROM model_provider p WHERE "+where+" ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?", args...)
	if e != nil {
		return nil, 0, e
	}
	return rows, total, e
}
func (t *modelsTx) Provider(id uint64) (*m.Provider, error) {
	v := &m.Provider{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+modelProviderColumns+" FROM model_provider p WHERE p.id=? FOR UPDATE", id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *modelsTx) InsertProvider(v *m.Provider) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	r, e := t.named("INSERT INTO model_provider(icon_key,code,name,description,provider_type,base_url,auth_method,identity_config,enabled,config,config_schema_version,secret_revision,row_version,config_version,created_by_user_id,created_at,updated_at) VALUES(:icon_key,:code,:name,:description,:provider_type,:base_url,:auth_method,:identity_config,:enabled,:config,:config_schema_version,:secret_revision,:row_version,:config_version,:created_by_user_id,:created_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *modelsTx) SaveProvider(v *m.Provider) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.named("UPDATE model_provider SET icon_key=:icon_key,name=:name,description=:description,base_url=:base_url,auth_method=:auth_method,enabled=:enabled,config=:config,secret_revision=:secret_revision,row_version=:row_version,config_version=:config_version,updated_at=:updated_at WHERE id=:id", v)
	return e
}
func (t *modelsTx) DeleteProvider(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM model_provider WHERE id=?", id)
	return e
}
func (t *modelsTx) SetSecret(id uint64, value string) error {
	if value == "" {
		_, e := t.tx.ExecContext(t.ctx, "UPDATE model_provider SET secret_ciphertext=NULL,secret_format_version=NULL,secret_key_version=NULL WHERE id=?", id)
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE model_provider SET secret_ciphertext=?,secret_format_version=2,secret_key_version='v1' WHERE id=?", value, id)
	return e
}
func (t *modelsTx) Secret(id uint64) (string, error) {
	var value sql.NullString
	e := t.tx.GetContext(t.ctx, &value, "SELECT secret_ciphertext FROM model_provider WHERE id=?", id)
	if errors.Is(e, sql.ErrNoRows) {
		return "", nil
	}
	return value.String, e
}
func (t *modelsTx) Definitions(q m.Query) ([]m.Definition, int, error) {
	where, args := filterModels(q, false)
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM model_definition WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []m.Definition{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+modelDefinitionColumns+" FROM model_definition WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", args...)
	if e != nil {
		return nil, 0, e
	}
	return rows, total, e
}

func (t *modelsTx) Definition(id uint64, lock bool) (*m.Definition, error) {
	q := "SELECT " + modelDefinitionColumns + " FROM model_definition WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &m.Definition{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *modelsTx) InsertDefinition(v *m.Definition) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	r, e := t.named("INSERT INTO model_definition(icon_key,provider_id,model_id,name,description,protocol,enabled,capabilities,capability_schema_version,generation_defaults,thinking_options,context_window_tokens,max_output_tokens,row_version,config_version,created_by_user_id,created_at,updated_at) VALUES(:icon_key,:provider_id,:model_id,:name,:description,:protocol,:enabled,:capabilities,:capability_schema_version,:generation_defaults,:thinking_options,:context_window_tokens,:max_output_tokens,:row_version,:config_version,:created_by_user_id,:created_at,:updated_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *modelsTx) SaveDefinition(v *m.Definition) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.named("UPDATE model_definition SET icon_key=:icon_key,name=:name,description=:description,enabled=:enabled,capabilities=:capabilities,generation_defaults=:generation_defaults,thinking_options=:thinking_options,context_window_tokens=:context_window_tokens,max_output_tokens=:max_output_tokens,row_version=:row_version,config_version=:config_version,updated_at=:updated_at WHERE id=:id", v)
	return e
}
func (t *modelsTx) DeleteDefinition(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM model_definition WHERE id=?", id)
	return e
}
func (t *modelsTx) ProviderReferenced(id uint64) (bool, error) {
	var used bool
	e := t.tx.GetContext(t.ctx, &used, "SELECT EXISTS(SELECT 1 FROM model_definition WHERE provider_id=?)", id)
	return used, e
}
func (s *Store) modelsSchemaReady(ctx context.Context) error {
	var count int
	if e := s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('model_provider','model_definition')"); e != nil {
		return e
	}
	if count != 2 {
		return install.ErrIncompleteSchema
	}
	// Explicit projections check all fields used by the module without reading rows.
	for _, q := range []string{"SELECT " + modelProviderColumns + " FROM model_provider p LIMIT 0", "SELECT " + modelDefinitionColumns + " FROM model_definition LIMIT 0"} {
		rows, e := s.db.QueryxContext(ctx, q)
		if e != nil {
			return install.ErrIncompleteSchema
		}
		if e = rows.Close(); e != nil {
			return e
		}
	}
	if e := s.db.GetContext(ctx, &count, "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN ('uq_model_provider_code','uq_model_provider_name','uq_model_definition_route') AND NON_UNIQUE=0"); e != nil {
		return e
	}
	if count != 3 {
		return install.ErrIncompleteSchema
	}
	return nil
}
