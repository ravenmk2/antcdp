package mysql

import (
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) FavoriteAgents(user uint64, ids []uint64) (map[uint64]bool, error) {
	result := make(map[uint64]bool, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	query, args, err := sqlx.In("SELECT agent_id FROM agent_favorite WHERE user_id=? AND agent_id IN (?)", user, ids)
	if err != nil {
		return nil, err
	}
	var found []uint64
	if err = t.tx.SelectContext(t.ctx, &found, query, args...); err != nil {
		return nil, err
	}
	for _, id := range found {
		result[id] = true
	}
	return result, nil
}

func (t *agentsTx) FavoriteDefinitions(user uint64, admin bool, q a.Query) ([]a.Definition, int, error) {
	where := []string{"agent.deleted_at IS NULL", "agent.agent_type='chat'", "f.user_id=?"}
	args := []any{user}
	if !admin {
		where = append(where, agentUsagePredicate)
		args = append(args, user, user, user)
	}
	if q.Q != "" {
		where = append(where, "(agent.name LIKE ? ESCAPE '!' OR agent.description LIKE ? ESCAPE '!')")
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q) + "%"
		args = append(args, pattern, pattern)
	}
	from := " FROM agent JOIN agent_favorite f ON f.agent_id=agent.id WHERE " + strings.Join(where, " AND ")
	var total int
	if err := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*)"+from, args...); err != nil {
		return nil, 0, err
	}
	rows := []a.Definition{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	columns := "agent." + strings.ReplaceAll(agentDefinitionColumns, ",", ",agent.")
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+columns+from+" ORDER BY f.created_at DESC,f.agent_id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, err
}

func (t *agentsTx) SaveFavorite(user, agent uint64, favorite bool, now time.Time) error {
	if !favorite {
		_, err := t.tx.ExecContext(t.ctx, "DELETE FROM agent_favorite WHERE user_id=? AND agent_id=?", user, agent)
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "INSERT INTO agent_favorite(user_id,agent_id,created_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE agent_id=VALUES(agent_id)", user, agent, now)
	return err
}

func (t *agentsTx) CanReadAgentHistory(agent, user uint64, admin bool) (bool, error) {
	// Match root-session contentAccess: personal history stays private even to admins.
	var allowed bool
	err := t.tx.GetContext(t.ctx, &allowed, "SELECT EXISTS(SELECT 1 FROM agent_session WHERE agent_id=? AND session_kind='root' AND ((agent_type='chat' AND executor_user_id=?) OR (agent_type='service' AND ?)))", agent, user, admin)
	return allowed, err
}
