package mysql

import (
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

const skillBindingColumns = "id,agent_id,skill_id,skill_version_id,enabled,sort_order,created_at,updated_at"

func (t *agentsTx) SkillBindings(id uint64) ([]a.SkillBinding, error) {
	rows := []a.SkillBinding{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+skillBindingColumns+" FROM agent_skill_binding WHERE agent_id=? ORDER BY sort_order,id", id)
	return rows, err
}
func (t *agentsTx) SaveSkillBindings(id uint64, rows []a.SkillBinding, now time.Time) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM agent_skill_binding WHERE agent_id=?", id); err != nil {
		return err
	}
	for _, row := range rows {
		row.AgentID, row.CreatedAt, row.UpdatedAt = id, now, now
		if _, err := t.named("INSERT INTO agent_skill_binding(agent_id,skill_id,skill_version_id,enabled,sort_order,created_at,updated_at) VALUES(:agent_id,:skill_id,:skill_version_id,:enabled,:sort_order,:created_at,:updated_at)", row); err != nil {
			return err
		}
	}
	return nil
}
