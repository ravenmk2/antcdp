package mysql

import (
	"database/sql"
	"errors"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (t *agentsTx) UseGrants(id uint64) ([]agents.UseGrant, error) {
	rows := []agents.UseGrant{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT subject_kind,subject_id FROM agent_use_grant WHERE agent_id=?
 UNION ALL SELECT 'job',job_id FROM job_agent_grant WHERE agent_id=? ORDER BY subject_kind,subject_id`, id, id)
	return rows, err
}

// A job grant authorizes the job itself, including scheduled runs without a user.
func (t *agentsTx) ReplaceUseGrants(agent *agents.Definition, grants []agents.UseGrant, actor uint64) error {
	if len(grants) > 500 {
		return httpx.Invalid("use_grants", "too_many")
	}
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM agent_use_grant WHERE agent_id=?", agent.ID); err != nil {
		return err
	}
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM job_agent_grant WHERE agent_id=?", agent.ID); err != nil {
		return err
	}
	seen := map[agents.UseGrant]bool{}
	for _, g := range grants {
		if g.ID == 0 || seen[g] {
			return httpx.Invalid("use_grants", "invalid_or_duplicate")
		}
		seen[g] = true
		var count int64
		var err error
		switch g.Kind {
		case "user":
			count, err = t.insertGrant(`INSERT INTO agent_use_grant SELECT ?, 'user',id,?,UTC_TIMESTAMP(3) FROM user WHERE id=? AND status='active' AND deleted_at IS NULL`, agent.ID, actor, g.ID)
		case "role":
			count, err = t.insertGrant(`INSERT INTO agent_use_grant SELECT ?, 'role',id,?,UTC_TIMESTAMP(3) FROM role WHERE id=? AND scope_kind=? AND scope_id=?`, agent.ID, actor, g.ID, agent.ScopeKind, agent.ScopeID)
		case "job":
			if agent.Mode != "service" {
				return httpx.Invalid("use_grants", "service_agent_required")
			}
			count, err = t.insertGrant(`INSERT INTO job_agent_grant SELECT j.id,?,?,UTC_TIMESTAMP(3) FROM job j JOIN project p ON p.id=j.scope_id AND p.archived_at IS NULL WHERE j.id=? AND (?='platform' OR (?='project' AND j.scope_id=?) OR (?='team' AND EXISTS(SELECT 1 FROM project_team pt JOIN team tm ON tm.id=pt.team_id AND tm.dissolved_at IS NULL WHERE pt.project_id=j.scope_id AND pt.team_id=?)))`, agent.ID, actor, g.ID, agent.ScopeKind, agent.ScopeKind, agent.ScopeID, agent.ScopeKind, agent.ScopeID)
		default:
			return httpx.Invalid("use_grants", "unsupported_subject")
		}
		if err != nil {
			return err
		}
		if count != 1 {
			return httpx.Invalid("use_grants", "subject_unavailable")
		}
	}
	return nil
}

func (t *agentsTx) insertGrant(query string, args ...any) (int64, error) {
	result, err := t.tx.ExecContext(t.ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (t *agentsTx) CanJobRunAgent(run, project, agent uint64) (bool, error) {
	var id uint64
	err := t.tx.GetContext(t.ctx, &id, `SELECT j.id FROM job_run v JOIN job j ON j.id=v.job_id
 JOIN project p ON p.id=j.scope_id AND p.archived_at IS NULL
 JOIN job_agent_grant g ON g.job_id=j.id JOIN agent a ON a.id=g.agent_id
 WHERE v.id=? AND v.status='running' AND j.scope_id=? AND a.id=? AND
 (a.scope_kind='platform' OR (a.scope_kind='project' AND a.scope_id=j.scope_id)
 OR (a.scope_kind='team' AND EXISTS(SELECT 1 FROM project_team pt JOIN team tm ON tm.id=pt.team_id
 WHERE tm.dissolved_at IS NULL AND pt.team_id=a.scope_id AND pt.project_id=j.scope_id))) FOR UPDATE OF v FOR SHARE OF j,p,g,a`, run, project, agent)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
