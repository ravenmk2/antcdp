package mysql

import (
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) MCPBindings(id uint64, all bool) ([]a.MCPBinding, error) {
	q := "SELECT id,agent_id,mcp_server_id,enabled,sort_order,created_at,updated_at,removed_at FROM agent_mcp_binding WHERE agent_id=?"
	if !all {
		q += " AND removed_at IS NULL"
	}
	q += " ORDER BY sort_order,id"
	rows := []a.MCPBinding{}
	e := t.tx.SelectContext(t.ctx, &rows, q, id)
	return rows, e
}
func (t *agentsTx) SaveMCPBindings(id uint64, rows []a.MCPBinding, now time.Time) error {
	if _, e := t.tx.ExecContext(t.ctx, "UPDATE agent_mcp_binding SET removed_at=?,updated_at=? WHERE agent_id=? AND removed_at IS NULL", now, now, id); e != nil {
		return e
	}
	for i := range rows {
		v := &rows[i]
		v.AgentID = id
		v.CreatedAt = now
		v.UpdatedAt = now
		_, e := t.named("INSERT INTO agent_mcp_binding(agent_id,mcp_server_id,enabled,sort_order,created_at,updated_at) VALUES(:agent_id,:mcp_server_id,:enabled,:sort_order,:created_at,:updated_at) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),sort_order=VALUES(sort_order),removed_at=NULL,updated_at=VALUES(updated_at)", v)
		if e != nil {
			return e
		}
	}
	return nil
}
