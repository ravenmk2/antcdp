package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"

	"github.com/ravenmk2/antcdp/internal/modules/jobs"
)

type jobTx struct{ *identityTx }

func (t *identityTx) Jobs() jobs.Repository { return &jobTx{t} }
func jobMissing(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}
func (t *jobTx) Jobs(project uint64, f jobs.Filter) ([]jobs.Job, error) {
	out := []jobs.Job{}
	err := t.tx.SelectContext(t.ctx, &out, `SELECT j.*,
		(SELECT COUNT(*) FROM job_run WHERE job_id=j.id AND status='queued') queued_count,
		(SELECT COUNT(*) FROM job_run WHERE job_id=j.id AND status IN ('running','cancelling','stopping')) active_count,
		COALESCE((SELECT status FROM job_run WHERE job_id=j.id ORDER BY id DESC LIMIT 1),'') latest_status,
		(SELECT MIN(next_fire_at) FROM job_schedule WHERE job_id=j.id AND enabled=TRUE) next_fire_at
		FROM job j WHERE scope_kind='project' AND scope_id=? AND (?=0 OR id<?)
		AND (?='' OR LOCATE(?,name)>0 OR LOCATE(?,description)>0)
		AND (?='' OR (?='enabled' AND enabled=TRUE) OR (?='disabled' AND enabled=FALSE))
		ORDER BY id DESC LIMIT 100`, project, f.Before, f.Before, f.Query, f.Query, f.Query, f.Status, f.Status, f.Status)
	return out, err
}
func (t *jobTx) Job(id uint64) (*jobs.Job, error) {
	var v jobs.Job
	err := t.tx.GetContext(t.ctx, &v, "SELECT * FROM job WHERE id=? FOR UPDATE", id)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) JobByCode(project uint64, code string) (*jobs.Job, error) {
	var v jobs.Job
	err := t.tx.GetContext(t.ctx, &v, "SELECT * FROM job WHERE scope_kind='project' AND scope_id=? AND code=? FOR UPDATE", project, code)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) AutomationReceipt(job, caller uint64, key string) (*jobs.Receipt, error) {
	var v jobs.Receipt
	err := t.tx.GetContext(t.ctx, &v, "SELECT * FROM job_trigger_request WHERE job_id=? AND caller_kind='event_subscription' AND caller_id=? AND request_key=? FOR UPDATE", job, caller, key)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) SaveJob(v *jobs.Job) error {
	if v.ID == 0 {
		result, err := t.tx.NamedExecContext(t.ctx, "INSERT INTO job(code,scope_kind,scope_id,name,description,enabled,current_revision_id,max_concurrency,busy_policy,timeout_ms,row_version,created_by_user_id,created_at,updated_at) VALUES(:code,:scope_kind,:scope_id,:name,:description,:enabled,:current_revision_id,:max_concurrency,:busy_policy,:timeout_ms,:row_version,:created_by_user_id,:created_at,:updated_at)", v)
		if err != nil {
			var duplicate *driver.MySQLError
			if errors.As(err, &duplicate) && duplicate.Number == 1062 {
				return httpx.E(409, "CODE_CONFLICT", "项目中已存在此作业编码")
			}
			return err
		}
		id, err := result.LastInsertId()
		v.ID = uint64(id)
		return err
	}
	_, err := t.tx.NamedExecContext(t.ctx, "UPDATE job SET name=:name,description=:description,enabled=:enabled,current_revision_id=:current_revision_id,max_concurrency=:max_concurrency,busy_policy=:busy_policy,timeout_ms=:timeout_ms,row_version=:row_version,updated_at=:updated_at WHERE id=:id", v)
	return err
}
func (t *jobTx) Revision(id uint64) (*jobs.Revision, error) {
	var row struct {
		ID          uint64    `db:"id"`
		RunAsUserID uint64    `db:"run_as_user_id"`
		JobID       uint64    `db:"job_id"`
		Hash        string    `db:"content_hash"`
		Script      string    `db:"script"`
		Parameters  []byte    `db:"input_schema"`
		Creator     uint64    `db:"created_by_user_id"`
		At          time.Time `db:"created_at"`
	}
	err := t.tx.GetContext(t.ctx, &row, "SELECT * FROM job_revision WHERE id=?", id)
	if err != nil {
		return nil, jobMissing(err)
	}
	v := &jobs.Revision{ID: row.ID, JobID: row.JobID, Hash: row.Hash, Creator: row.Creator, CreatedAt: row.At, Config: jobs.Config{Script: row.Script, RunAsUserID: row.RunAsUserID}}
	if err = json.Unmarshal(row.Parameters, &v.Parameters); err != nil {
		return nil, err
	}
	return v, nil
}
func (t *jobTx) SaveRevision(v *jobs.Revision) error {
	err := t.tx.GetContext(t.ctx, &v.ID, "SELECT id FROM job_revision WHERE job_id=? AND content_hash=?", v.JobID, v.Hash)
	if err == nil {
		stored, readErr := t.Revision(v.ID)
		if readErr != nil {
			return readErr
		}
		// MySQL normalizes JSON whitespace and escaping. Compare decoded
		// configuration values rather than the storage representation.
		var a, b any
		if stored == nil {
			return errors.New("job revision disappeared")
		}
		left, marshalErr := json.Marshal(stored.Config)
		if marshalErr != nil {
			return marshalErr
		}
		right, marshalErr := json.Marshal(v.Config)
		if marshalErr != nil {
			return marshalErr
		}
		if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil || !reflect.DeepEqual(a, b) {
			return errors.New("job revision digest matched different content")
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	params, err := json.Marshal(v.Parameters)
	if err != nil {
		return err
	}
	result, err := t.tx.ExecContext(t.ctx, "INSERT INTO job_revision(run_as_user_id,job_id,content_hash,script,input_schema,created_by_user_id,created_at) VALUES(?,?,?,?,?,?,?)", v.RunAsUserID, v.JobID, v.Hash, v.Script, params, v.Creator, v.CreatedAt)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	v.ID = uint64(id)
	return err
}
func (t *jobTx) Grants(id uint64) ([]jobs.Grant, error) {
	out := []jobs.Grant{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT subject_kind,subject_id FROM job_run_grant WHERE job_id=? ORDER BY subject_kind,subject_id", id)
	return out, err
}
func (t *jobTx) SetGrants(id, actor uint64, grants []jobs.Grant) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM job_run_grant WHERE job_id=?", id); err != nil {
		return err
	}
	for _, g := range grants {
		if _, err := t.tx.ExecContext(t.ctx, "INSERT INTO job_run_grant(job_id,subject_kind,subject_id,granted_by_user_id,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))", id, g.Kind, g.ID, actor); err != nil {
			return err
		}
	}
	return nil
}
func (t *jobTx) RunAllowed(job, user uint64) (bool, error) {
	var allowed bool
	err := t.tx.GetContext(t.ctx, &allowed, `SELECT EXISTS(SELECT 1 FROM job_run_grant g JOIN job j ON j.id=g.job_id WHERE g.job_id=? AND ((g.subject_kind='user' AND g.subject_id=?) OR (g.subject_kind='role' AND EXISTS(SELECT 1 FROM role_binding b JOIN role r ON r.id=b.role_id WHERE b.role_id=g.subject_id AND b.user_id=? AND r.scope_kind='project' AND r.scope_id=j.scope_id))))`, job, user, user)
	return allowed, err
}

const runColumns = "id,job_id,revision_id,run_as_user_id,trigger_kind,actor_user_id,trigger_context,inputs,timeout_ms,state_mode,state_store_id,rerun_of_run_id,status,stop_reason,error_code,error_summary,COALESCE(result,CAST('null' AS JSON)) AS result,has_result,queued_at,started_at,finished_at,stop_requested_by_user_id,stop_requested_at,last_log_seq,script_log_count,script_log_bytes,script_logs_truncated"

func (t *jobTx) Run(id uint64) (*jobs.Run, error) {
	var v jobs.Run
	err := t.tx.GetContext(t.ctx, &v, "SELECT "+runColumns+" FROM job_run WHERE id=? FOR UPDATE", id)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) Runs(id, before uint64) ([]jobs.Run, error) {
	out := []jobs.Run{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT "+runColumns+" FROM job_run WHERE job_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 100", id, before, before)
	return out, err
}
func (t *jobTx) Active(id uint64) ([]jobs.Run, error) {
	out := []jobs.Run{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT "+runColumns+" FROM job_run WHERE job_id=? AND status IN ('queued','running','cancelling','stopping') ORDER BY queued_at,id FOR UPDATE", id)
	return out, err
}
func (t *jobTx) QueuedActors(job uint64) ([]uint64, error) {
	out := []uint64{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT DISTINCT actor_user_id FROM job_run WHERE job_id=? AND status='queued' AND actor_user_id IS NOT NULL UNION SELECT run_as_user_id FROM job_run WHERE job_id=? AND status='queued' ORDER BY 1", job, job)
	return out, err
}
func (t *jobTx) SaveRun(v *jobs.Run) error {
	if v.ID == 0 {
		result, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO job_run(job_id,revision_id,run_as_user_id,trigger_kind,actor_user_id,trigger_context,inputs,timeout_ms,state_mode,rerun_of_run_id,status,stop_reason,error_code,error_summary,queued_at) VALUES(:job_id,:revision_id,:run_as_user_id,:trigger_kind,:actor_user_id,:trigger_context,:inputs,:timeout_ms,:state_mode,:rerun_of_run_id,:status,:stop_reason,:error_code,:error_summary,:queued_at)`, v)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		v.ID = uint64(id)
		return err
	}
	_, err := t.tx.NamedExecContext(t.ctx, `UPDATE job_run SET state_store_id=:state_store_id,status=:status,stop_reason=:stop_reason,error_code=:error_code,error_summary=:error_summary,result=:result,has_result=:has_result,started_at=:started_at,finished_at=:finished_at,stop_requested_by_user_id=:stop_requested_by_user_id,stop_requested_at=:stop_requested_at,last_log_seq=:last_log_seq,script_log_count=:script_log_count,script_log_bytes=:script_log_bytes,script_logs_truncated=:script_logs_truncated WHERE id=:id`, v)
	return err
}
func (t *jobTx) AppendLog(v *jobs.Run, l *jobs.Log) error {
	v.LastSeq++
	l.RunID = v.ID
	l.Seq = v.LastSeq
	if l.At.IsZero() {
		l.At = time.Now().UTC()
	}
	if len(l.Fields) == 0 {
		l.Fields = json.RawMessage(`{}`)
	}
	_, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO job_run_log(job_run_id,seq,occurred_at,kind,level,message,fields,resource_call_id) VALUES(:job_run_id,:seq,:occurred_at,:kind,:level,:message,:fields,:resource_call_id)`, l)
	if err != nil {
		return err
	}
	return t.SaveRun(v)
}
func (t *jobTx) Logs(id, after uint64) ([]jobs.Log, error) {
	out := []jobs.Log{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT * FROM job_run_log WHERE job_run_id=? AND seq>? ORDER BY seq LIMIT 200", id, after)
	return out, err
}
func (t *jobTx) Receipt(job, actor uint64, key string) (*jobs.Receipt, error) {
	var v jobs.Receipt
	err := t.tx.GetContext(t.ctx, &v, "SELECT * FROM job_trigger_request WHERE job_id=? AND caller_kind='user' AND caller_id=? AND request_key=?", job, actor, key)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) SaveReceipt(v *jobs.Receipt) error {
	if v.CallerKind == "" {
		v.CallerKind, v.CallerID = "user", v.Actor
	}
	result, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO job_trigger_request(caller_kind,caller_id,job_id,actor_user_id,request_key,payload_hash,trigger_kind,outcome,reason_code,job_run_id,created_at) VALUES(:caller_kind,:caller_id,:job_id,:actor_user_id,:request_key,:payload_hash,:trigger_kind,:outcome,:reason_code,:job_run_id,:created_at)`, v)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	v.ID = uint64(id)
	return err
}
func (t *jobTx) Receipts(job, before uint64) ([]jobs.Receipt, error) {
	out := []jobs.Receipt{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT * FROM job_trigger_request WHERE job_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 100", job, before, before)
	return out, err
}
func (t *jobTx) Schedule(id uint64) (*jobs.Schedule, error) {
	var v jobs.Schedule
	err := t.tx.GetContext(t.ctx, &v, "SELECT * FROM job_schedule WHERE id=? FOR UPDATE", id)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) ScheduleByCode(job uint64, code string) (*jobs.Schedule, error) {
	var plan jobs.Schedule
	err := t.tx.GetContext(t.ctx, &plan, "SELECT * FROM job_schedule WHERE job_id=? AND code=? FOR UPDATE", job, code)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &plan, nil
}
func (t *jobTx) ScheduleCommand(schedule, actor uint64, key string) (*jobs.ScheduleCommandReceipt, error) {
	var receipt jobs.ScheduleCommandReceipt
	err := t.tx.GetContext(t.ctx, &receipt, "SELECT payload_hash,result_version FROM job_schedule_command WHERE schedule_id=? AND actor_user_id=? AND request_key=?", schedule, actor, key)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &receipt, nil
}
func (t *jobTx) SaveScheduleCommand(schedule, actor uint64, key string, receipt jobs.ScheduleCommandReceipt) error {
	_, err := t.tx.ExecContext(t.ctx, "INSERT INTO job_schedule_command(schedule_id,actor_user_id,request_key,payload_hash,result_version) VALUES(?,?,?,?,?)", schedule, actor, key, receipt.Hash, receipt.Version)
	return err
}
func (t *jobTx) Schedules(job uint64) ([]jobs.Schedule, error) {
	out := []jobs.Schedule{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT * FROM job_schedule WHERE job_id=? ORDER BY id", job)
	return out, err
}
func (t *jobTx) SaveSchedule(v *jobs.Schedule) error {
	if v.ID == 0 {
		result, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO job_schedule(code,schedule_kind,run_at,max_fires,fire_count,job_id,name,cron,timezone,inputs,enabled,next_fire_at,row_version,created_by_user_id,created_at,updated_at) VALUES(:code,:schedule_kind,:run_at,:max_fires,:fire_count,:job_id,:name,:cron,:timezone,:inputs,:enabled,:next_fire_at,:row_version,:created_by_user_id,:created_at,:updated_at)`, v)
		if err != nil {
			var duplicate *driver.MySQLError
			if errors.As(err, &duplicate) && duplicate.Number == 1062 {
				return httpx.E(409, "CODE_CONFLICT", "作业中已存在此计划编码")
			}
			return err
		}
		id, err := result.LastInsertId()
		v.ID = uint64(id)
		return err
	}
	_, err := t.tx.NamedExecContext(t.ctx, `UPDATE job_schedule SET schedule_kind=:schedule_kind,run_at=:run_at,max_fires=:max_fires,fire_count=:fire_count,name=:name,cron=:cron,timezone=:timezone,inputs=:inputs,enabled=:enabled,next_fire_at=:next_fire_at,row_version=:row_version,updated_at=:updated_at WHERE id=:id`, v)
	return err
}
func (t *jobTx) SaveFire(v *jobs.Fire) error {
	result, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO job_schedule_fire(schedule_id,scheduled_at,processed_at,outcome,reason_code,job_run_id) VALUES(:schedule_id,:scheduled_at,:processed_at,:outcome,:reason_code,:job_run_id)`, v)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	v.ID = uint64(id)
	return err
}
func (t *jobTx) Fires(id, before uint64) ([]jobs.Fire, error) {
	out := []jobs.Fire{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT * FROM job_schedule_fire WHERE schedule_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 100", id, before, before)
	return out, err
}
func (t *jobTx) SaveCall(v *jobs.Call) error {
	if v.ID == 0 {
		result, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO job_resource_call(job_run_id,resource_kind,resource_id,authorization_kind,connection_id,configured_credential_id,credential_id,credential_material_version,robot_material_version,resource_snapshot,target,operation,outcome,error_code,external_ref,created_at,finished_at) VALUES(:job_run_id,:resource_kind,:resource_id,:authorization_kind,:connection_id,:configured_credential_id,:credential_id,:credential_material_version,:robot_material_version,:resource_snapshot,:target,:operation,:outcome,:error_code,:external_ref,:created_at,:finished_at)`, v)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		v.ID = uint64(id)
		return err
	}
	_, err := t.tx.NamedExecContext(t.ctx, `UPDATE job_resource_call SET outcome=:outcome,error_code=:error_code,finished_at=:finished_at,external_ref=:external_ref WHERE id=:id`, v)
	return err
}
func (t *jobTx) Call(id uint64) (*jobs.Call, error) {
	var v jobs.Call
	err := t.tx.GetContext(t.ctx, &v, "SELECT * FROM job_resource_call WHERE id=? FOR UPDATE", id)
	if err != nil {
		return nil, jobMissing(err)
	}
	return &v, nil
}
func (t *jobTx) Calls(run uint64) ([]jobs.Call, error) {
	out := []jobs.Call{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT * FROM job_resource_call WHERE job_run_id=? ORDER BY id", run)
	return out, err
}
func (t *jobTx) CallsForLogs(run, after, through uint64) ([]jobs.Call, error) {
	out := []jobs.Call{}
	err := t.tx.SelectContext(t.ctx, &out, `SELECT c.* FROM job_resource_call c JOIN
		(SELECT DISTINCT resource_call_id FROM job_run_log WHERE job_run_id=? AND seq>? AND seq<=? AND resource_call_id IS NOT NULL) l
		ON l.resource_call_id=c.id WHERE c.job_run_id=? ORDER BY c.id`, run, after, through, run)
	return out, err
}
func (t *jobTx) WorkJobs() ([]uint64, error) {
	out := []uint64{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT id FROM job WHERE EXISTS(SELECT 1 FROM job_run WHERE job_id=job.id AND status='queued') OR EXISTS(SELECT 1 FROM job_schedule WHERE job_id=job.id AND enabled=TRUE AND next_fire_at<=UTC_TIMESTAMP(3)) ORDER BY id")
	return out, err
}
func (t *jobTx) RecoveryJobs() ([]uint64, error) {
	out := []uint64{}
	err := t.tx.SelectContext(t.ctx, &out, "SELECT id FROM job ORDER BY id")
	return out, err
}

var _ jobs.Repository = (*jobTx)(nil)
