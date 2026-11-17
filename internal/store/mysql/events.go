package mysql

import (
	"database/sql"
	"errors"
	"time"

	e "github.com/ravenmk2/antcdp/internal/modules/events"
)

type eventTx struct{ *identityTx }

func (t *identityTx) Events() e.Repository { return &eventTx{t} }

func (t *eventTx) insert(q string, value any, id *uint64) error {
	r, err := t.tx.NamedExecContext(t.ctx, q, value)
	if err != nil {
		return err
	}
	n, err := r.LastInsertId()
	*id = uint64(n)
	return err
}

func (t *eventTx) Targets(connection uint64, repo string) ([]e.Target, error) {
	rows := []e.Target{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT pr.id,pr.project_id FROM project_repository pr JOIN project p ON p.id=pr.project_id WHERE pr.connection_id=? AND pr.repo_id=? AND p.archived_at IS NULL ORDER BY pr.project_id,pr.id`, connection, repo)
	return rows, err
}
func (t *eventTx) Record(id uint64) (*e.Record, error) {
	v := &e.Record{}
	err := t.tx.GetContext(t.ctx, v, "SELECT * FROM event_record WHERE id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) RecordByMessage(kind string, source uint64, message string) (*e.Record, error) {
	v := &e.Record{}
	err := t.tx.GetContext(t.ctx, v, "SELECT * FROM event_record WHERE source_kind=? AND source_id=? AND source_message_id=? FOR UPDATE", kind, source, message)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) InsertRecord(v *e.Record) error {
	return t.insert(`INSERT INTO event_record(source_kind,source_id,source_message_id,source_event_type,group_code,event_type,schema_version,source_repository_id,subject_kind,subject_id,occurred_at,received_at,data,raw_payload,payload_hash,source_metadata,routing_result) VALUES(:source_kind,:source_id,:source_message_id,:source_event_type,:group_code,:event_type,:schema_version,:source_repository_id,:subject_kind,:subject_id,:occurred_at,:received_at,:data,:raw_payload,:payload_hash,:source_metadata,:routing_result)`, v, &v.ID)
}
func (t *eventTx) References(project uint64, f e.Filter) ([]e.Reference, error) {
	rows := []e.Reference{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT r.* FROM event_scope_ref r JOIN event_record e ON e.id=r.event_id WHERE r.scope_kind='project' AND r.scope_id=? AND (?=0 OR r.id<?) AND (?='' OR e.event_type=?) ORDER BY r.id DESC LIMIT 100`, project, f.Before, f.Before, f.Type, f.Type)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Event, err = t.Record(rows[i].EventID)
		if err != nil {
			return nil, err
		}
	}
	return rows, nil
}
func (t *eventTx) Reference(id uint64) (*e.Reference, error) {
	v := &e.Reference{}
	err := t.tx.GetContext(t.ctx, v, "SELECT * FROM event_scope_ref WHERE id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v.Event, err = t.Record(v.EventID)
	return v, err
}
func (t *eventTx) InsertReference(v *e.Reference) error {
	return t.insert(`INSERT INTO event_scope_ref(event_id,scope_kind,scope_id,routing_basis,created_at) VALUES(:event_id,:scope_kind,:scope_id,:routing_basis,:created_at)`, v, &v.ID)
}
func (t *eventTx) Subscriptions(project uint64, lock bool) ([]e.Subscription, error) {
	rows := []e.Subscription{}
	q := "SELECT * FROM event_subscription WHERE scope_kind='project' AND scope_id=? AND deleted_at IS NULL ORDER BY id"
	if lock {
		q += " FOR UPDATE"
	}
	err := t.tx.SelectContext(t.ctx, &rows, q, project)
	return rows, err
}
func (t *eventTx) Subscription(id uint64, lock bool) (*e.Subscription, error) {
	v := &e.Subscription{}
	q := "SELECT * FROM event_subscription WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	err := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) SaveSubscription(v *e.Subscription) error {
	if v.ID == 0 {
		return t.insert(`INSERT INTO event_subscription(scope_kind,scope_id,name,description,enabled,current_revision_id,next_enqueue_seq,next_consume_seq,row_version,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at) VALUES(:scope_kind,:scope_id,:name,:description,:enabled,:current_revision_id,:next_enqueue_seq,:next_consume_seq,:row_version,:created_by_user_id,:updated_by_user_id,:created_at,:updated_at,:deleted_at)`, v, &v.ID)
	}
	_, err := t.tx.NamedExecContext(t.ctx, `UPDATE event_subscription SET name=:name,description=:description,enabled=:enabled,current_revision_id=:current_revision_id,next_enqueue_seq=:next_enqueue_seq,next_consume_seq=:next_consume_seq,row_version=:row_version,updated_by_user_id=:updated_by_user_id,updated_at=:updated_at,deleted_at=:deleted_at WHERE id=:id`, v)
	return err
}
func (t *eventTx) Revision(id uint64) (*e.Revision, error) {
	v := &e.Revision{}
	err := t.tx.GetContext(t.ctx, v, "SELECT * FROM event_subscription_revision WHERE id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) Revisions(id uint64) ([]e.Revision, error) {
	rows := []e.Revision{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT * FROM event_subscription_revision WHERE subscription_id=? ORDER BY revision_no DESC LIMIT 100", id)
	return rows, err
}
func (t *eventTx) InsertRevision(v *e.Revision) error {
	return t.insert(`INSERT INTO event_subscription_revision(subscription_id,revision_no,event_types,executor_user_id,script_api_version,script,timeout_ms,max_retries,retry_interval_ms,created_by_user_id,created_at) VALUES(:subscription_id,:revision_no,:event_types,:executor_user_id,:script_api_version,:script,:timeout_ms,:max_retries,:retry_interval_ms,:created_by_user_id,:created_at)`, v, &v.ID)
}
func (t *eventTx) Consumptions(project uint64, f e.Filter) ([]e.Consumption, error) {
	rows := []e.Consumption{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT c.* FROM event_consumption c JOIN event_subscription s ON s.id=c.subscription_id WHERE s.scope_kind='project' AND s.scope_id=? AND (?=0 OR c.id<?) AND (?=0 OR c.subscription_id=?) AND (?='' OR c.status=?) ORDER BY c.id DESC LIMIT 100`, project, f.Before, f.Before, f.SubscriptionID, f.SubscriptionID, f.Status, f.Status)
	return rows, err
}
func (t *eventTx) Consumption(id uint64, lock bool) (*e.Consumption, error) {
	v := &e.Consumption{}
	q := "SELECT * FROM event_consumption WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	err := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) Head(subscription, seq uint64, lock bool) (*e.Consumption, error) {
	v := &e.Consumption{}
	q := "SELECT * FROM event_consumption WHERE subscription_id=? AND queue_seq=?"
	if lock {
		q += " FOR UPDATE"
	}
	err := t.tx.GetContext(t.ctx, v, q, subscription, seq)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) RetryChild(id uint64) (*e.Consumption, error) {
	v := &e.Consumption{}
	err := t.tx.GetContext(t.ctx, v, "SELECT * FROM event_consumption WHERE retry_of_id=?", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *eventTx) InsertConsumption(v *e.Consumption) error {
	return t.insert(`INSERT INTO event_consumption(subscription_id,revision_id,scope_ref_id,queue_seq,status,attempt_count,error_code,error_summary,result,has_result,retry_of_id,operator_user_id,created_at) VALUES(:subscription_id,:revision_id,:scope_ref_id,:queue_seq,:status,:attempt_count,:error_code,:error_summary,:result,:has_result,:retry_of_id,:operator_user_id,:created_at)`, v, &v.ID)
}
func (t *eventTx) SaveConsumption(v *e.Consumption) error {
	_, err := t.tx.NamedExecContext(t.ctx, `UPDATE event_consumption SET status=:status,attempt_count=:attempt_count,started_at=:started_at,deadline_at=:deadline_at,next_retry_at=:next_retry_at,finished_at=:finished_at,error_code=:error_code,error_summary=:error_summary,result=:result,has_result=:has_result,last_log_seq=:last_log_seq,script_log_count=:script_log_count,script_log_bytes=:script_log_bytes,script_logs_truncated=:script_logs_truncated WHERE id=:id`, v)
	return err
}
func (t *eventTx) AppendLog(c *e.Consumption, v *e.Log) error {
	c.LastLogSeq++
	v.ConsumptionID, v.Seq, v.Attempt = c.ID, c.LastLogSeq, c.Attempt
	if v.At.IsZero() {
		v.At = time.Now().UTC().Truncate(time.Millisecond)
	}
	if len(v.Fields) == 0 {
		v.Fields = []byte(`{}`)
	}
	_, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO event_consumption_log(consumption_id,seq,attempt_no,occurred_at,kind,level,message,fields) VALUES(:consumption_id,:seq,:attempt_no,:occurred_at,:kind,:level,:message,:fields)`, v)
	if err != nil {
		return err
	}
	return t.SaveConsumption(c)
}
func (t *eventTx) Logs(id, after uint64) ([]e.Log, error) {
	rows := []e.Log{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT * FROM event_consumption_log WHERE consumption_id=? AND seq>? ORDER BY seq LIMIT 500", id, after)
	return rows, err
}
func (t *eventTx) CancelQueued(id uint64, at time.Time) error {
	rows := []e.Consumption{}
	if err := t.tx.SelectContext(t.ctx, &rows, "SELECT * FROM event_consumption WHERE subscription_id=? AND status IN ('queued','retry_wait') ORDER BY queue_seq FOR UPDATE", id); err != nil {
		return err
	}
	for i := range rows {
		c := &rows[i]
		c.Status, c.FinishedAt, c.NextRetryAt = "cancelled", &at, nil
		if err := t.AppendLog(c, &e.Log{At: at, Kind: "execution", Level: "info", Message: "订阅已删除，取消尚未开始的消费"}); err != nil {
			return err
		}
	}
	return nil
}
func (t *eventTx) WorkSubscriptions(includeDisabled bool) ([]uint64, error) {
	rows := []uint64{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT s.id FROM event_subscription s JOIN project p ON s.scope_kind='project' AND p.id=s.scope_id JOIN event_consumption c ON c.subscription_id=s.id AND c.queue_seq=s.next_consume_seq WHERE (? OR (s.enabled=TRUE AND s.deleted_at IS NULL AND p.archived_at IS NULL)) AND (c.status='queued' OR (c.status='retry_wait' AND c.next_retry_at<=UTC_TIMESTAMP(3))) ORDER BY c.created_at,c.id LIMIT 100`, includeDisabled)
	return rows, err
}
func (t *eventTx) ActiveConsumptions() ([]e.Consumption, error) {
	rows := []e.Consumption{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT * FROM event_consumption WHERE status IN ('running','stopping') ORDER BY id")
	return rows, err
}
func (t *eventTx) RobotOptions(project uint64) ([]e.RobotOption, error) {
	rows := []e.RobotOption{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT u.id,u.display_name,u.username FROM user u WHERE u.account_type='robot' AND u.deleted_at IS NULL AND u.status='active' AND (EXISTS(SELECT 1 FROM project_member pm WHERE pm.project_id=? AND pm.user_id=u.id) OR EXISTS(SELECT 1 FROM project_team pt JOIN team tm ON tm.id=pt.team_id AND tm.dissolved_at IS NULL JOIN team_member m ON m.team_id=tm.id WHERE pt.project_id=? AND m.user_id=u.id)) ORDER BY u.display_name,u.id`, project, project)
	return rows, err
}
