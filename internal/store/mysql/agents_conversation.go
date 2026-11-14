package mysql

import (
	"database/sql"
	"errors"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) ConversationProjection(id uint64) (*a.ConversationProjectionRow, error) {
	v := &a.ConversationProjectionRow{}
	err := t.tx.GetContext(t.ctx, v, "SELECT session_id,projection_version,through_seq,payload,payload_sha256,updated_at FROM agent_session_projection WHERE session_id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

func (t *agentsTx) SaveConversationProjection(v *a.ConversationProjectionRow) error {
	_, err := t.named("INSERT INTO agent_session_projection(session_id,projection_version,through_seq,payload,payload_sha256,updated_at) VALUES(:session_id,:projection_version,:through_seq,:payload,:payload_sha256,:updated_at) ON DUPLICATE KEY UPDATE projection_version=:projection_version,through_seq=:through_seq,payload=:payload,payload_sha256=:payload_sha256,updated_at=:updated_at", v)
	return err
}

func (t *agentsTx) SessionTitle(id uint64, lock bool) (*a.SessionTitleRow, error) {
	query := "SELECT " + sessionTitleColumns + " FROM agent_session s LEFT JOIN agent_model_call m ON m.id=s.title_model_call_id WHERE s.id=?"
	if lock {
		query += " FOR UPDATE"
	}
	v := &a.SessionTitleRow{}
	err := t.tx.GetContext(t.ctx, v, query, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}

func (t *agentsTx) SaveSessionTitle(v *a.SessionTitleRow) error {
	_, err := t.named("UPDATE agent_session SET title_source=:source,title_source_event_seq=:source_event_seq,title_generation_status=:status,title_model_call_id=:model_call_id WHERE id=:session_id", v)
	return err
}

func (t *agentsTx) PendingSessionTitles(limit int) ([]a.SessionTitleRow, error) {
	v := []a.SessionTitleRow{}
	err := t.tx.SelectContext(t.ctx, &v, "SELECT "+sessionTitleColumns+" FROM agent_session s LEFT JOIN agent_model_call m ON m.id=s.title_model_call_id WHERE s.title_generation_status IN ('queued','running') ORDER BY s.id LIMIT ?", limit)
	return v, err
}

var _ a.ConversationRepository = (*agentsTx)(nil)

const sessionTitleColumns = "s.id AS session_id,s.title_source AS source,s.title_source_event_seq AS source_event_seq,s.title_generation_status AS status,s.title_model_call_id AS model_call_id,COALESCE(m.executor_epoch,'') AS executor_epoch,s.created_at,COALESCE(m.started_at,s.updated_at) AS updated_at"
