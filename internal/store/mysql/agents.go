package mysql

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type agentsTx struct {
	ctx context.Context
	tx  *sqlx.Tx
}

func (t *identityTx) Agents() a.Repository { return &agentsTx{t.ctx, t.tx} }

const agentDefinitionColumns = "id,code,name,description,agent_type,scope_kind,scope_id,robot_user_id,enabled,system_prompt,config_schema_version,default_model_binding_id,runtime_policy,pool_capacity,config_version,row_version,created_by_user_id,created_at,updated_at,deleted_at"
const agentModelBindingColumns = "id,agent_id,model_definition_id,thinking_options,default_thinking,generation_overrides,sort_order,created_at,updated_at,removed_at"
const agentToolBindingColumns = "id,agent_id,tool_kind,tool_key,policy,parameter_constraints,config,config_schema_version,sort_order,created_at,updated_at,removed_at"

func agentsError(err error) error {
	var e *driver.MySQLError
	if !errors.As(err, &e) || e.Number != 1062 {
		return err
	}
	constraint := ""
	if at := strings.LastIndex(e.Message, " for key '"); at >= 0 {
		constraint = strings.TrimSuffix(e.Message[at+len(" for key '"):], "'")
		if dot := strings.LastIndexByte(constraint, '.'); dot >= 0 {
			constraint = constraint[dot+1:]
		}
	}
	if constraint == "uq_agent_code" || constraint == "uq_agent_sandbox_provider_code" {
		v := httpx.E(409, "CODE_CONFLICT", "编码已被使用")
		v.Details = []httpx.Detail{{Code: "conflict", Field: "code"}}
		return v
	}
	if constraint == "uq_agent_sandbox_provider_name" {
		v := httpx.E(409, "NAME_CONFLICT", "名称已被使用")
		v.Details = []httpx.Detail{{Code: "conflict", Field: "name"}}
		return v
	}
	return httpx.E(409, "RESOURCE_CONFLICT", "资源或活动状态已变化，请重新加载")
}
func (t *agentsTx) named(q string, v any) (sql.Result, error) {
	r, e := t.tx.NamedExecContext(t.ctx, q, v)
	return r, agentsError(e)
}
func (t *agentsTx) Definitions(q a.Query) ([]a.Definition, int, error) {
	conditions := []string{"deleted_at IS NULL"}
	args := []any{}
	if q.CatalogUserID != 0 {
		conditions = append(conditions, "EXISTS(SELECT 1 FROM agent_model_binding b JOIN model_definition m ON m.id=b.model_definition_id JOIN model_provider p ON p.id=m.provider_id WHERE b.id=agent.default_model_binding_id AND b.removed_at IS NULL AND m.enabled=1 AND p.enabled=1 AND (p.auth_method='none' OR p.secret_ciphertext IS NOT NULL))")
		if !q.CatalogAdmin {
			conditions = append(conditions, agentUsagePredicate)
			args = append(args, q.CatalogUserID, q.CatalogUserID, q.CatalogUserID)
		}
	}
	if q.Q != "" {
		conditions = append(conditions, "(name LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')")
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q) + "%"
		args = append(args, pattern, pattern)
	}
	if q.Mode != "" {
		conditions = append(conditions, "agent_type=?")
		args = append(args, q.Mode)
	}
	if q.ScopeKind != "" {
		conditions = append(conditions, "scope_kind=?")
		args = append(args, q.ScopeKind)
	}
	if q.ProjectID != 0 {
		conditions = append(conditions, "scope_kind='project' AND scope_id=?")
		args = append(args, q.ProjectID)
	}
	if q.Enabled != nil {
		conditions = append(conditions, "enabled=?")
		args = append(args, *q.Enabled)
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []a.Definition{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentDefinitionColumns+",(SELECT COUNT(*) FROM agent_model_binding b WHERE b.agent_id=agent.id AND b.removed_at IS NULL) AS model_binding_count,(SELECT COUNT(*) FROM agent_tool_binding b WHERE b.agent_id=agent.id AND b.removed_at IS NULL) AS tool_binding_count,(SELECT COUNT(*) FROM agent_mcp_binding b WHERE b.agent_id=agent.id AND b.removed_at IS NULL) AS mcp_binding_count FROM agent WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *agentsTx) Definition(id uint64, lock bool) (*a.Definition, error) {
	q := "SELECT " + agentDefinitionColumns + " FROM agent WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &a.Definition{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertDefinition(v *a.Definition) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	r, e := t.named("INSERT INTO agent(code,name,description,agent_type,scope_kind,scope_id,robot_user_id,enabled,system_prompt,config_schema_version,default_model_binding_id,runtime_policy,pool_capacity,config_version,row_version,created_by_user_id,created_at,updated_at,deleted_at) VALUES(:code,:name,:description,:agent_type,:scope_kind,:scope_id,:robot_user_id,:enabled,:system_prompt,:config_schema_version,:default_model_binding_id,:runtime_policy,:pool_capacity,:config_version,:row_version,:created_by_user_id,:created_at,:updated_at,:deleted_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveDefinition(v *a.Definition) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.named("UPDATE agent SET name=:name,description=:description,enabled=:enabled,system_prompt=:system_prompt,default_model_binding_id=:default_model_binding_id,runtime_policy=:runtime_policy,pool_capacity=:pool_capacity,config_version=:config_version,row_version=:row_version,updated_at=:updated_at,deleted_at=:deleted_at WHERE id=:id", v)
	return e
}
func (t *agentsTx) DefinitionReferenced(id uint64) (bool, error) {
	var used bool
	e := t.tx.GetContext(t.ctx, &used, "SELECT EXISTS(SELECT 1 FROM agent_session WHERE agent_id=?) OR EXISTS(SELECT 1 FROM agent_operation WHERE subject_kind='agent' AND subject_id=? AND status IN ('queued','running','outcome_unknown'))", id, id)
	return used, e
}
func (t *agentsTx) ModelBindings(id uint64, all bool) ([]a.ModelBinding, error) {
	q := "SELECT " + agentModelBindingColumns + " FROM agent_model_binding WHERE agent_id=?"
	if !all {
		q += " AND removed_at IS NULL"
	}
	q += " ORDER BY sort_order,id"
	rows := []a.ModelBinding{}
	e := t.tx.SelectContext(t.ctx, &rows, q, id)
	return rows, e
}
func (t *agentsTx) SaveModelBindings(id uint64, rows []a.ModelBinding, now time.Time) error {
	if _, e := t.tx.ExecContext(t.ctx, "UPDATE agent_model_binding SET removed_at=?,updated_at=? WHERE agent_id=? AND removed_at IS NULL", now, now, id); e != nil {
		return e
	}
	for i := range rows {
		v := &rows[i]
		v.AgentID = id
		v.CreatedAt = now
		v.UpdatedAt = now
		_, e := t.named("INSERT INTO agent_model_binding(agent_id,model_definition_id,thinking_options,default_thinking,generation_overrides,sort_order,created_at,updated_at) VALUES(:agent_id,:model_definition_id,:thinking_options,:default_thinking,:generation_overrides,:sort_order,:created_at,:updated_at) ON DUPLICATE KEY UPDATE thinking_options=VALUES(thinking_options),default_thinking=VALUES(default_thinking),generation_overrides=VALUES(generation_overrides),sort_order=VALUES(sort_order),removed_at=NULL,updated_at=VALUES(updated_at)", v)
		if e != nil {
			return e
		}
	}
	return nil
}
func (t *agentsTx) ToolBindings(id uint64, all bool) ([]a.ToolBinding, error) {
	q := "SELECT " + agentToolBindingColumns + " FROM agent_tool_binding WHERE agent_id=?"
	if !all {
		q += " AND removed_at IS NULL"
	}
	q += " ORDER BY sort_order,id"
	rows := []a.ToolBinding{}
	e := t.tx.SelectContext(t.ctx, &rows, q, id)
	return rows, e
}
func (t *agentsTx) SaveToolBindings(id uint64, rows []a.ToolBinding, now time.Time) error {
	if _, e := t.tx.ExecContext(t.ctx, "UPDATE agent_tool_binding SET removed_at=?,updated_at=? WHERE agent_id=? AND removed_at IS NULL", now, now, id); e != nil {
		return e
	}
	for i := range rows {
		v := &rows[i]
		v.AgentID = id
		v.CreatedAt = now
		v.UpdatedAt = now
		_, e := t.named("INSERT INTO agent_tool_binding(agent_id,tool_kind,tool_key,policy,parameter_constraints,config,config_schema_version,sort_order,created_at,updated_at) VALUES(:agent_id,:tool_kind,:tool_key,:policy,:parameter_constraints,:config,:config_schema_version,:sort_order,:created_at,:updated_at) ON DUPLICATE KEY UPDATE policy=VALUES(policy),parameter_constraints=VALUES(parameter_constraints),config=VALUES(config),config_schema_version=VALUES(config_schema_version),sort_order=VALUES(sort_order),removed_at=NULL,updated_at=VALUES(updated_at)", v)
		if e != nil {
			return e
		}
	}
	return nil
}

// Agent scope grants entry only. Projects include direct and team membership.
const agentUsagePredicate = "(scope_kind='platform' OR (scope_kind='team' AND EXISTS(SELECT 1 FROM team t JOIN team_member m ON m.team_id=t.id WHERE t.id=agent.scope_id AND t.dissolved_at IS NULL AND m.user_id=?)) OR (scope_kind='project' AND EXISTS(SELECT 1 FROM project o WHERE o.id=agent.scope_id AND o.archived_at IS NULL AND " + projectMembership + ")))"

func (t *agentsTx) CanUseAgent(id, userID uint64, admin bool) (bool, error) {
	q := "SELECT EXISTS(SELECT 1 FROM agent WHERE id=? AND deleted_at IS NULL"
	args := []any{id}
	if !admin {
		q += " AND " + agentUsagePredicate
		args = append(args, userID, userID, userID)
	}
	var allowed bool
	err := t.tx.GetContext(t.ctx, &allowed, q+")", args...)
	return allowed, err
}
func (t *agentsTx) ScopeExists(kind string, id *uint64) (bool, error) {
	if kind == "platform" {
		return id == nil, nil
	}
	if id == nil {
		return false, nil
	}
	var q string
	switch kind {
	case "team":
		q = "SELECT EXISTS(SELECT 1 FROM team WHERE id=? AND dissolved_at IS NULL)"
	case "project":
		q = "SELECT EXISTS(SELECT 1 FROM project WHERE id=? AND archived_at IS NULL)"
	default:
		return false, nil
	}
	var exists bool
	err := t.tx.GetContext(t.ctx, &exists, q, *id)
	return exists, err
}
func activeProjectRead(userID uint64, admin bool) (string, []any) {
	if admin {
		return "o.archived_at IS NULL", nil
	}
	return "o.archived_at IS NULL AND " + projectMembership, []any{userID, userID}
}
func (t *agentsTx) AvailableProjects(userID uint64, admin bool) ([]a.ProjectOption, error) {
	visible, args := activeProjectRead(userID, admin)
	items := []a.ProjectOption{}
	err := t.tx.SelectContext(t.ctx, &items, "SELECT o.id,o.name FROM project o WHERE "+visible+" ORDER BY o.id", args...)
	return items, err
}

func (t *agentsTx) CanReadActiveProject(projectID, userID uint64, admin bool) (bool, error) {
	visible, args := activeProjectRead(userID, admin)
	var allowed bool
	e := t.tx.GetContext(t.ctx, &allowed, "SELECT EXISTS(SELECT 1 FROM project o WHERE o.id=? AND "+visible+")", append([]any{projectID}, args...)...)
	return allowed, e
}

func (t *agentsTx) AgentHasActiveWork(id uint64) (bool, error) {
	var busy bool
	e := t.tx.GetContext(t.ctx, &busy, "SELECT EXISTS(SELECT 1 FROM agent_session s WHERE s.agent_id=? AND (s.active_run_id IS NOT NULL OR s.active_compaction_id IS NOT NULL))", id)
	return busy, e
}

func (t *agentsTx) AgentSessionIDs(id uint64) ([]uint64, error) {
	ids := []uint64{}
	err := t.tx.SelectContext(t.ctx, &ids, "SELECT id FROM agent_session WHERE agent_id=? AND session_kind='root' ORDER BY id", id)
	return ids, err
}
func (t *agentsTx) ModelReferenced(kind string, id uint64) (bool, error) {
	var used bool
	q := "SELECT EXISTS(SELECT 1 FROM agent_model_binding WHERE model_definition_id=?) OR EXISTS(SELECT 1 FROM agent_model_call WHERE model_definition_id=?)"
	if kind == "model_provider" {
		q = "SELECT EXISTS(SELECT 1 FROM agent_model_binding b JOIN model_definition d ON d.id=b.model_definition_id WHERE d.provider_id=?) OR EXISTS(SELECT 1 FROM agent_model_call WHERE provider_id=?)"
	}
	e := t.tx.GetContext(t.ctx, &used, q, id, id)
	return used, e
}
func (t *agentsTx) Receipt(actor, kind, id, command, key string) (*a.Receipt, error) {
	v := &a.Receipt{}
	e := t.tx.GetContext(t.ctx, v, "SELECT "+agentReceiptColumns+" FROM agent_command_receipt WHERE actor_kind='user' AND actor_id=? AND scope_kind=? AND scope_id=? AND command_kind=? AND idempotency_key=? FOR UPDATE", actor, kind, id, command, key)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentsTx) InsertReceipt(v *a.Receipt) error {
	r, e := t.named("INSERT INTO agent_command_receipt(actor_kind,actor_id,scope_kind,scope_id,command_kind,idempotency_key,request_hash,status,result,created_at) VALUES(:actor_kind,:actor_id,:scope_kind,:scope_id,:command_kind,:idempotency_key,:request_hash,:status,:result,:created_at)", v)
	return modelID(r, e, &v.ID)
}
func (t *agentsTx) SaveReceipt(v *a.Receipt) error {
	_, e := t.named("UPDATE agent_command_receipt SET status=:status,response_status=:response_status,result=:result,operation_id=:operation_id,target_kind=:target_kind,target_id=:target_id,completed_at=:completed_at WHERE id=:id", v)
	return e
}

const agentReceiptColumns = "id,actor_kind,actor_id,scope_kind,scope_id,command_kind,idempotency_key,request_hash,status,COALESCE(response_status,0) AS response_status,COALESCE(result,CAST('null' AS JSON)) AS result,operation_id,target_kind,target_id,created_at,completed_at"
