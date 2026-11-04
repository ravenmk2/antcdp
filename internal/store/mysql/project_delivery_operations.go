package mysql

import (
	"database/sql"
	"errors"
	"time"

	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
)

func (t *identityTx) BranchChecks(pid uint64, kind string, id uint64) ([]d.Check, error) {
	out := []d.Check{}
	e := t.tx.SelectContext(t.ctx, &out, `SELECT id,project_id,subject_kind,subject_id,project_repository_id,branch_name,check_id,status,COALESCE(reason,'') reason,COALESCE(commit_id,'') commit_id,is_protected,is_default,snapshot,checked_by_user_id,started_at,finished_at FROM project_branch_check WHERE project_id=? AND subject_kind=? AND subject_id=?`, pid, kind, id)
	return out, e
}
func (t *identityTx) SaveBranchCheck(v *d.Check) error {
	// Parent project lock serializes comparisons, including same-millisecond checks.
	var old []d.Check
	e := t.tx.SelectContext(t.ctx, &old, `SELECT started_at,check_id FROM project_branch_check WHERE subject_kind=? AND subject_id=? AND project_repository_id=?`, v.SubjectKind, v.SubjectID, v.RepositoryID)
	if e != nil {
		return e
	}
	if len(old) > 0 && (old[0].StartedAt.After(v.StartedAt) || old[0].StartedAt.Equal(v.StartedAt) && old[0].CheckID >= v.CheckID) {
		return nil
	}
	_, e = t.tx.NamedExecContext(t.ctx, `INSERT INTO project_branch_check(project_id,subject_kind,subject_id,project_repository_id,branch_name,check_id,status,reason,commit_id,is_protected,is_default,snapshot,checked_by_user_id,started_at,finished_at) VALUES(:project_id,:subject_kind,:subject_id,:project_repository_id,:branch_name,:check_id,:status,:reason,:commit_id,:is_protected,:is_default,:snapshot,:checked_by_user_id,:started_at,:finished_at) ON DUPLICATE KEY UPDATE branch_name=VALUES(branch_name),check_id=VALUES(check_id),status=VALUES(status),reason=VALUES(reason),commit_id=VALUES(commit_id),is_protected=VALUES(is_protected),is_default=VALUES(is_default),snapshot=VALUES(snapshot),checked_by_user_id=VALUES(checked_by_user_id),started_at=VALUES(started_at),finished_at=VALUES(finished_at)`, v)
	return e
}

const creationColumns = "id,project_id,variant_id,retry_of_id,target_branch,default_source_branch,config_snapshot,idempotency_key,request_hash,execution_hash,status,row_version,created_by_user_id,created_at,updated_at,expires_at,started_at,finished_at,lease_expires_at"

func (t *identityTx) Creations(pid uint64, q d.Query) ([]d.Creation, int, error) {
	where := "project_id=?"
	args := []any{pid}
	if q.VariantID != 0 {
		where += " AND variant_id=?"
		args = append(args, q.VariantID)
	}
	if q.Status != "" && q.Status != "all" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	var n int
	if e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM project_branch_creation WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	out := []d.Creation{}
	args = append(args, q.Size, (q.Page-1)*q.Size)
	e := t.tx.SelectContext(t.ctx, &out, "SELECT "+creationColumns+" FROM project_branch_creation WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", args...)
	return out, n, e
}
func (t *identityTx) Creation(pid, id uint64) (*d.Creation, error) {
	var v d.Creation
	e := t.tx.GetContext(t.ctx, &v, "SELECT "+creationColumns+" FROM project_branch_creation WHERE project_id=? AND id=? FOR UPDATE", pid, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, e
}
func (t *identityTx) CreationByKey(pid, uid uint64, key string) (*d.Creation, error) {
	var id uint64
	e := t.tx.GetContext(t.ctx, &id, "SELECT id FROM project_branch_creation WHERE project_id=? AND created_by_user_id=? AND idempotency_key=?", pid, uid, key)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	return t.Creation(pid, id)
}
func (t *identityTx) CreationItems(id uint64) ([]d.CreationItem, error) {
	out := []d.CreationItem{}
	e := t.tx.SelectContext(t.ctx, &out, `SELECT id,creation_id,project_repository_id,repository_version,connection_id,repo_id,repository_path,COALESCE(source_branch,'') source_branch,COALESCE(source_commit_id,'') source_commit_id,COALESCE(preview_target_commit_id,'') preview_target_commit_id,preview_state,COALESCE(preview_reason,'') preview_reason,remote_snapshot,COALESCE(action,'') action,status,COALESCE(reason,'') reason,COALESCE(result_commit_id,'') result_commit_id,COALESCE(reconciliation,'null') reconciliation,started_at,finished_at FROM project_branch_creation_item WHERE creation_id=? ORDER BY id`, id)
	return out, e
}
func (t *identityTx) SaveCreation(v *d.Creation, create bool) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	if create {
		v.CreatedAt = v.UpdatedAt
		r, e := t.tx.NamedExecContext(t.ctx, `INSERT INTO project_branch_creation(project_id,variant_id,retry_of_id,target_branch,default_source_branch,config_snapshot,idempotency_key,request_hash,status,created_by_user_id,created_at,updated_at,expires_at) VALUES(:project_id,:variant_id,:retry_of_id,:target_branch,:default_source_branch,:config_snapshot,:idempotency_key,:request_hash,:status,:created_by_user_id,:created_at,:updated_at,:expires_at)`, v)
		if e != nil {
			return e
		}
		id, e := r.LastInsertId()
		v.ID = uint64(id)
		return e
	}
	var slot any
	if v.Status == "executing" {
		slot = 1
	}
	_, e := t.tx.ExecContext(t.ctx, `UPDATE project_branch_creation SET status=?,active_slot=?,row_version=?,execution_hash=?,updated_at=?,started_at=?,finished_at=?,lease_expires_at=? WHERE id=?`, v.Status, slot, v.Version, v.ExecutionHash, v.UpdatedAt, v.StartedAt, v.FinishedAt, v.Lease, v.ID)
	return e
}
func (t *identityTx) SaveCreationItem(v *d.CreationItem, create bool) error {
	if create {
		r, e := t.tx.NamedExecContext(t.ctx, `INSERT INTO project_branch_creation_item(creation_id,project_repository_id,repository_version,connection_id,repo_id,repository_path,source_branch,source_commit_id,preview_target_commit_id,preview_state,preview_reason,remote_snapshot,status) VALUES(:creation_id,:project_repository_id,:repository_version,:connection_id,:repo_id,:repository_path,:source_branch,:source_commit_id,:preview_target_commit_id,:preview_state,:preview_reason,:remote_snapshot,:status)`, v)
		if e != nil {
			return e
		}
		id, e := r.LastInsertId()
		v.ID = uint64(id)
		return e
	}
	_, e := t.tx.NamedExecContext(t.ctx, `UPDATE project_branch_creation_item SET action=:action,status=:status,reason=:reason,result_commit_id=:result_commit_id,reconciliation=:reconciliation,started_at=:started_at,finished_at=:finished_at WHERE id=:id AND creation_id=:creation_id`, v)
	return e
}
func (t *identityTx) RecoverCreations(now time.Time) error {
	// One row at a time: recovery only locks batch/items and never goes back to a
	// project lock. Workers also serialize item updates on this same batch lock.
	var ids []uint64
	if e := t.tx.SelectContext(t.ctx, &ids, "SELECT id FROM project_branch_creation WHERE status='executing' AND lease_expires_at<=? ORDER BY id LIMIT 100 FOR UPDATE", now); e != nil {
		return e
	}
	for _, id := range ids {
		if _, e := t.tx.ExecContext(t.ctx, `UPDATE project_branch_creation_item SET status=CASE WHEN status='creating' THEN 'unknown' ELSE 'not_started' END,reason='interrupted',finished_at=? WHERE creation_id=? AND status IN ('pending','creating')`, now, id); e != nil {
			return e
		}
		if _, e := t.tx.ExecContext(t.ctx, `UPDATE project_branch_creation SET status='interrupted',active_slot=NULL,finished_at=?,updated_at=?,row_version=row_version+1 WHERE id=?`, now, now, id); e != nil {
			return e
		}
	}
	var expired []uint64
	if e := t.tx.SelectContext(t.ctx, &expired, "SELECT id FROM project_branch_creation WHERE status='prepared' AND expires_at<? ORDER BY id LIMIT 100 FOR UPDATE", now.Add(-7*24*time.Hour)); e != nil {
		return e
	}
	for _, id := range expired {
		if _, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_branch_creation_item WHERE creation_id=?", id); e != nil {
			return e
		}
		if _, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_branch_creation WHERE id=?", id); e != nil {
			return e
		}
	}
	return nil
}
