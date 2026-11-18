package mysql

import (
	"database/sql"
	"errors"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

const papiGrantColumns = "agent_id,api_code,parameter_constraints,created_at,updated_at"

func (t *agentsTx) PAPIGrants(agentID uint64) ([]a.PAPIGrantRow, error) {
	rows := []a.PAPIGrantRow{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+papiGrantColumns+" FROM agent_papi_grant WHERE agent_id=? ORDER BY api_code", agentID)
	return rows, err
}

func (t *agentsTx) PAPIGrant(agentID uint64, code string) (*a.PAPIGrantRow, error) {
	var row a.PAPIGrantRow
	err := t.tx.GetContext(t.ctx, &row, "SELECT "+papiGrantColumns+" FROM agent_papi_grant WHERE agent_id=? AND api_code=?", agentID, code)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &row, err
}

func (t *agentsTx) PutPAPIGrant(row a.PAPIGrantRow) error {
	_, err := t.named(`INSERT INTO agent_papi_grant (`+papiGrantColumns+`)
VALUES (:agent_id,:api_code,:parameter_constraints,:created_at,:updated_at)
ON DUPLICATE KEY UPDATE parameter_constraints=VALUES(parameter_constraints),updated_at=VALUES(updated_at)`, row)
	return err
}

func (t *agentsTx) DeletePAPIGrant(agentID uint64, code string) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM agent_papi_grant WHERE agent_id=? AND api_code=?", agentID, code)
	return err
}
