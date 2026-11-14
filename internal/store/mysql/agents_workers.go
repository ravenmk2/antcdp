package mysql

import (
	"database/sql"
	"errors"
	"strconv"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) WorkerReference(run uint64, lock bool) (*a.ResourceReferenceRow, error) {
	q := "SELECT " + agentResourceReferenceColumns + " FROM agent_resource_reference WHERE holder_kind='run_worker' AND holder_id=? AND resource_kind='local_worker'"
	if lock {
		q += " FOR UPDATE"
	}
	row := &a.ResourceReferenceRow{}
	err := t.tx.GetContext(t.ctx, row, q, strconv.FormatUint(run, 10))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return row, err
}
func (t *agentsTx) ReleaseOldWorkers(epoch string, now time.Time) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE agent_resource_reference SET state='released',released_at=?,updated_at=?,release_reason='local_executor_restarted' WHERE resource_kind='local_worker' AND executor_epoch<>? AND released_at IS NULL", now, now, epoch)
	return err
}

func (t *agentsTx) ReleaseRootSkills(root uint64, now time.Time) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE agent_resource_reference SET state='released',released_at=?,updated_at=?,release_reason='root_settled' WHERE holder_kind='root_skill' AND holder_id=? AND released_at IS NULL", now, now, strconv.FormatUint(root, 10))
	return err
}
