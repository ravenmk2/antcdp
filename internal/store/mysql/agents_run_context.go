package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) RunContext(root uint64) (*a.RunContextRow, error) {
	v := &a.RunContextRow{}
	err := t.tx.GetContext(t.ctx, v, "SELECT root_run_id,agent_id,executor_user_id,agent_config_version,schema_version,project_context_id,cloud_computer_id,cwd,system_prompt,model_snapshot,runtime_policy,builtin_tools,mcp_bindings,resource_grants,skill_manifest,COALESCE(mcp_surface,CAST('null' AS JSON)) AS mcp_surface,mcp_prepared_at,created_at FROM agent_run_context WHERE root_run_id=?", root)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

func (t *agentsTx) InsertRunContext(v *a.RunContextRow) error {
	_, err := t.named("INSERT INTO agent_run_context(root_run_id,agent_id,executor_user_id,agent_config_version,schema_version,project_context_id,cloud_computer_id,cwd,system_prompt,model_snapshot,runtime_policy,builtin_tools,mcp_bindings,resource_grants,skill_manifest,created_at) VALUES(:root_run_id,:agent_id,:executor_user_id,:agent_config_version,:schema_version,:project_context_id,:cloud_computer_id,:cwd,:system_prompt,:model_snapshot,:runtime_policy,:builtin_tools,:mcp_bindings,:resource_grants,:skill_manifest,:created_at)", v)
	return err
}

func (t *agentsTx) PrepareMCPManifest(root uint64, surface json.RawMessage, now time.Time) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE agent_run_context SET mcp_surface=?,mcp_prepared_at=? WHERE root_run_id=? AND mcp_prepared_at IS NULL", surface, now, root)
	return err
}

func (t *agentsTx) AccountResourceGrants(uid uint64, admin bool) ([]agentcore.ResourceGrant, error) {
	out := []agentcore.ResourceGrant{}
	// Team membership gives ordinary project membership, never project admin.
	query := "SELECT 'project' AS kind,p.id,IF(? OR pm.role='admin','admin','member') AS role FROM project p LEFT JOIN project_member pm ON pm.project_id=p.id AND pm.user_id=? WHERE p.archived_at IS NULL AND (? OR pm.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM project_team pt JOIN team te ON te.id=pt.team_id JOIN team_member tm ON tm.team_id=te.id WHERE pt.project_id=p.id AND te.dissolved_at IS NULL AND tm.user_id=?)) UNION ALL SELECT 'team' AS kind,te.id,IF(?,'admin',tm.role) AS role FROM team te LEFT JOIN team_member tm ON tm.team_id=te.id AND tm.user_id=? WHERE te.dissolved_at IS NULL AND (? OR tm.user_id IS NOT NULL) ORDER BY kind,id"
	err := t.tx.SelectContext(t.ctx, &out, query, admin, uid, admin, uid, admin, uid, admin)
	return out, err
}
