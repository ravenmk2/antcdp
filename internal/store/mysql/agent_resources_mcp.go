package mysql

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	driver "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	r "github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type mcpTx struct {
	ctx context.Context
	tx  *sqlx.Tx
}

func (t *identityTx) AgentMCP() r.MCPRepository { return &mcpTx{t.ctx, t.tx} }

const mcpServerColumns = "id,code,name,description,url,auth_method,auth_header_name,identity_config,timeout_seconds,enabled,config,config_schema_version,(secret_ciphertext IS NOT NULL AND OCTET_LENGTH(secret_ciphertext)>0) AS has_secret,secret_revision,row_version,config_version,COALESCE(last_diagnostic,CAST('null' AS JSON)) AS last_diagnostic,last_diagnostic_at,created_by_user_id,created_at,updated_at,(SELECT COUNT(*) FROM agent_mcp_binding b WHERE b.mcp_server_id=agent_mcp_server.id AND b.removed_at IS NULL) AS agent_count"

func mcpError(err error) error {
	var e *driver.MySQLError
	if !errors.As(err, &e) || e.Number != 1062 {
		return err
	}
	constraint := ""
	if i := strings.LastIndex(e.Message, " for key '"); i >= 0 {
		constraint = strings.TrimSuffix(e.Message[i+10:], "'")
		if j := strings.LastIndexByte(constraint, '.'); j >= 0 {
			constraint = constraint[j+1:]
		}
	}
	field, code := "", "RESOURCE_CONFLICT"
	switch constraint {
	case "uq_agent_mcp_server_code":
		field = "code"
		code = "CODE_CONFLICT"
	case "uq_agent_mcp_server_name":
		field = "name"
		code = "NAME_CONFLICT"
	}
	problem := httpx.E(409, code, "MCP资源已存在或发生并发变化")
	if field != "" {
		problem.Details = []httpx.Detail{{Field: field, Code: "conflict"}}
	}
	return problem
}
func (t *mcpTx) named(q string, v any) (sql.Result, error) {
	result, err := t.tx.NamedExecContext(t.ctx, q, v)
	return result, mcpError(err)
}
func mcpQuery(q r.Query, column string) (string, []any) {
	conditions := []string{"1=1"}
	args := []any{}
	if q.Q != "" {
		conditions = append(conditions, "("+column+" LIKE ? ESCAPE '!')")
		args = append(args, "%"+strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q)+"%")
	}
	return strings.Join(conditions, " AND "), args
}
func (t *mcpTx) MCPServers(q r.Query) ([]r.MCPServer, int, error) {
	where, args := mcpQuery(q, "CONCAT_WS(' ',name,description,url)")
	if q.Enabled != nil {
		where += " AND enabled=?"
		args = append(args, *q.Enabled)
	}
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_mcp_server WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []r.MCPServer{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+mcpServerColumns+" FROM agent_mcp_server WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *mcpTx) MCPAgents(id uint64, q r.Query) ([]r.MCPAgent, int, error) {
	var total int
	if err := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_mcp_binding WHERE mcp_server_id=? AND removed_at IS NULL", id); err != nil {
		return nil, 0, err
	}
	rows := []r.MCPAgent{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT a.id,a.name,a.enabled,b.enabled AS binding_enabled FROM agent_mcp_binding b JOIN agent a ON a.id=b.agent_id WHERE b.mcp_server_id=? AND b.removed_at IS NULL ORDER BY a.id LIMIT ? OFFSET ?", id, q.PageSize, (q.Page-1)*q.PageSize)
	return rows, total, err
}
func (t *mcpTx) MCPServer(id uint64, lock bool) (*r.MCPServer, error) {
	q := "SELECT " + mcpServerColumns + " FROM agent_mcp_server WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &r.MCPServer{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *mcpTx) InsertMCPServer(v *r.MCPServer) error {
	result, e := t.named("INSERT INTO agent_mcp_server(code,name,description,url,auth_method,auth_header_name,identity_config,timeout_seconds,enabled,config,config_schema_version,secret_revision,row_version,config_version,created_by_user_id,created_at,updated_at) VALUES(:code,:name,:description,:url,:auth_method,:auth_header_name,:identity_config,:timeout_seconds,:enabled,:config,:config_schema_version,:secret_revision,:row_version,:config_version,:created_by_user_id,:created_at,:updated_at)", v)
	return modelID(result, e, &v.ID)
}
func (t *mcpTx) SaveMCPServer(v *r.MCPServer) error {
	_, e := t.named("UPDATE agent_mcp_server SET name=:name,description=:description,url=:url,auth_method=:auth_method,auth_header_name=:auth_header_name,identity_config=:identity_config,timeout_seconds=:timeout_seconds,enabled=:enabled,config=:config,secret_revision=:secret_revision,row_version=:row_version,config_version=:config_version,last_diagnostic=:last_diagnostic,last_diagnostic_at=:last_diagnostic_at,updated_at=:updated_at WHERE id=:id", v)
	return e
}
func (t *mcpTx) DeleteMCPServer(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM agent_mcp_server WHERE id=?", id)
	return e
}
func (t *mcpTx) MCPReferenced(id uint64) (bool, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, `SELECT EXISTS(SELECT 1 FROM agent_mcp_binding WHERE mcp_server_id=? AND removed_at IS NULL) OR EXISTS(SELECT 1 FROM agent_tool_call WHERE mcp_server_id=?)`, id, id)
	return n != 0, e
}
func (t *mcpTx) MCPSecret(id uint64) (string, error) {
	var secret sql.NullString
	e := t.tx.GetContext(t.ctx, &secret, "SELECT secret_ciphertext FROM agent_mcp_server WHERE id=?", id)
	return secret.String, e
}
func (t *mcpTx) SaveMCPSecret(id uint64, cipher *string) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE agent_mcp_server SET secret_ciphertext=?,secret_format_version=IF(? IS NULL,NULL,1),secret_key_version=IF(? IS NULL,NULL,'1') WHERE id=?", cipher, cipher, cipher, id)
	return e
}
