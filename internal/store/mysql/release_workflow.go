package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	driver "github.com/go-sql-driver/mysql"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (t *identityTx) PriorBaseline(vid uint64, r d.ReleaseRepo) (string, string, error) {
	// An archived manifest owns its immutable SHA. Carry the baseline of an
	// interrupted first run until one such manifest exists.
	var sha string
	e := t.tx.GetContext(t.ctx, &sha, `SELECT JSON_UNQUOTE(JSON_EXTRACT(e.snapshot,'$.commit_sha')) FROM project_release_repository cur JOIN project_release_repository prev ON prev.remote_key=cur.remote_key JOIN project_release p ON p.id=prev.release_id JOIN project_release_manifest_entry e ON e.manifest_id=p.current_manifest_id AND e.subject_id=prev.id AND e.kind='repository' WHERE cur.id=? AND p.variant_id=? AND p.status='archived' ORDER BY p.ended_at DESC,p.id DESC LIMIT 1`, r.ID, vid)
	if e == nil {
		return sha, "archived", nil
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return "", "", e
	}
	e = t.tx.GetContext(t.ctx, &sha, `SELECT prev.baseline_sha FROM project_release_repository cur JOIN project_release_repository prev ON prev.remote_key=cur.remote_key JOIN project_release p ON p.id=prev.release_id WHERE cur.id=? AND p.variant_id=? AND p.status='terminated' AND prev.baseline_sha IS NOT NULL AND JSON_CONTAINS_PATH(p.variant_snapshot,'one','$.integration_started_at') ORDER BY p.ended_at DESC,p.id DESC LIMIT 1`, r.ID, vid)
	if errors.Is(e, sql.ErrNoRows) {
		return "", "", nil
	}
	return sha, "carried", e
}
func (t *identityTx) SaveBaseline(id uint64, sha, kind, ref string, actor uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_repository SET baseline_sha=?,baseline_kind=?,baseline_ref=NULLIF(?,''),baseline_at=UTC_TIMESTAMP(3),baseline_actor_id=? WHERE id=?", sha, kind, ref, actor, id)
	return e
}
func (t *identityTx) ActiveRelease(r *d.Release, acquire bool) error {
	var slot any
	key := "NULL"
	if acquire {
		slot = 1
		key = "remote_key"
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_release SET active_slot=?,variant_snapshot=IF(?=1,JSON_SET(variant_snapshot,'$.integration_started_at',UTC_TIMESTAMP(3)),variant_snapshot) WHERE id=?", slot, slot, r.ID)
	if e == nil {
		_, e = t.tx.ExecContext(t.ctx, "UPDATE project_release_repository SET active_remote_key="+key+" WHERE release_id=? AND in_scope=1 ORDER BY remote_key", r.ID)
	}
	var me *driver.MySQLError
	if errors.As(e, &me) && me.Number == 1062 {
		return httpx.E(409, "RELEASE_BUSY", "该产品分支或共享仓库主干已被其他发布占用")
	}
	return e
}
func (t *identityTx) ReleaseChanges(rid uint64) ([]d.ReleaseChange, error) {
	out := []d.ReleaseChange{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT id,release_repository_id,change_kind,remote_ref,disposition,COALESCE(reverted_by_change_id,0) reverted_by_change_id,evidence,note FROM project_release_change WHERE release_id=? ORDER BY id", rid)
	return out, e
}
func (t *identityTx) SaveChange(rid, actor uint64, v *d.ReleaseChange) error {
	if v.ID != 0 {
		_, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_change SET disposition=?,reverted_by_change_id=NULLIF(?,0),evidence=?,note=?,row_version=row_version+1 WHERE id=? AND release_id=?", v.Status, v.RevertedBy, v.Evidence, v.Note, v.ID, rid)
		return e
	}
	rows, e := t.ReleaseChanges(rid)
	if e != nil {
		return e
	}
	for _, old := range rows {
		if old.Repo == v.Repo && old.Kind == v.Kind && old.Ref == v.Ref {
			canRefresh := old.Status == "selected" && v.Status == "selected" && old.RevertedBy == 0
			if old.Status != "removed" && !canRefresh {
				v.ID = old.ID
				return nil
			}
			v.ID = old.ID
			return t.SaveChange(rid, actor, v)
		}
	}
	res, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_release_change(release_id,release_repository_id,change_kind,remote_ref,disposition,evidence,note,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, rid, v.Repo, v.Kind, v.Ref, v.Status, v.Evidence, v.Note, actor)
	if e != nil {
		return e
	}
	id, e := res.LastInsertId()
	v.ID = uint64(id)
	return e
}
func (t *identityTx) ReleaseManifests(rid uint64) ([]d.Manifest, error) {
	out := []d.Manifest{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT id,sequence_no,header,LOWER(HEX(digest)) digest,COALESCE(decision,'') decision,COALESCE(review_note,'') review_note,created_at,COALESCE(reviewer_id,0) reviewer_id,reviewed_at FROM project_release_manifest WHERE release_id=? ORDER BY sequence_no DESC", rid)
	return out, e
}
func (t *identityTx) FreezeRelease(r *d.Release, m *d.Manifest, entries []d.FrozenEntry, actor uint64) error {
	if e := t.tx.GetContext(t.ctx, &m.Sequence, "SELECT COALESCE(MAX(sequence_no),0)+1 FROM project_release_manifest WHERE release_id=?", r.ID); e != nil {
		return e
	}
	res, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_release_manifest(release_id,sequence_no,format_version,header,digest,actor_user_id,created_at) VALUES(?,?,1,?,UNHEX(?),?,UTC_TIMESTAMP(3))`, r.ID, m.Sequence, m.Header, m.Digest, actor)
	if e != nil {
		return e
	}
	id, e := res.LastInsertId()
	if e != nil {
		return e
	}
	m.ID = uint64(id)
	for _, ent := range entries {
		if _, e = t.tx.ExecContext(t.ctx, `INSERT INTO project_release_manifest_entry(manifest_id,kind,subject_id,revision_id,sort_order,snapshot) VALUES(?,?,?,NULLIF(?,''),?,?)`, m.ID, ent.Kind, ent.Subject, ent.Revision, ent.Position, ent.Data); e != nil {
			return e
		}
	}
	r.Manifest = &m.ID
	r.Status = "reviewing"
	return nil
}
func (t *identityTx) Entries(mid uint64) ([]d.FrozenEntry, error) {
	out := []d.FrozenEntry{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT kind,subject_id,COALESCE(revision_id,'') revision_id,sort_order,snapshot FROM project_release_manifest_entry WHERE manifest_id=? ORDER BY kind,sort_order,subject_id", mid)
	return out, e
}
func (t *identityTx) ReviewRelease(mid uint64, decision, note string, actor uint64) error {
	res, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_manifest SET decision=?,review_note=?,reviewer_id=?,reviewed_at=UTC_TIMESTAMP(3) WHERE id=? AND decision IS NULL", decision, note, actor, mid)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if n != 1 {
		return httpx.E(409, "ALREADY_REVIEWED", "该版本已验收")
	}
	return e
}
func (t *identityTx) Operations(rid uint64) ([]d.Operation, error) {
	out := []d.Operation{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT id,actor_user_id,kind,status,LOWER(HEX(request_digest)) request_digest,idempotency_key,created_at FROM project_release_operation WHERE release_id=? ORDER BY id DESC", rid)
	return out, e
}
func (t *identityTx) Steps(id uint64) ([]d.Step, error) {
	out := []d.Step{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT id,operation_id,release_repository_id,kind,status,intent,COALESCE(observed,'null') observed,updated_at FROM project_release_operation_step WHERE operation_id=? ORDER BY step_no", id)
	return out, e
}
func (t *identityTx) StartOperation(rid, mid uint64, o *d.Operation, steps []d.Step) error {
	res, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_release_operation(release_id,manifest_id,kind,status,active_slot,idempotency_key,request_digest,actor_user_id,created_at) VALUES(?,NULLIF(?,0),?,'running',1,?,UNHEX(?),?,UTC_TIMESTAMP(3))`, rid, mid, o.Kind, o.Key, o.Hash, o.Actor)
	if e != nil {
		return releaseConflict(e)
	}
	id, e := res.LastInsertId()
	if e != nil {
		return e
	}
	o.ID = uint64(id)
	for n, step := range steps {
		res, e = t.tx.ExecContext(t.ctx, `INSERT INTO project_release_operation_step(operation_id,release_repository_id,step_no,kind,status,intent,updated_at) VALUES(?,?,?,?,'pending',?,UTC_TIMESTAMP(3))`, o.ID, step.Repo, n+1, step.Kind, step.Intent)
		if e != nil {
			return e
		}
		id, e = res.LastInsertId()
		if e != nil {
			return e
		}
		steps[n].ID = uint64(id)
		steps[n].Op = o.ID
	}
	return nil
}
func (t *identityTx) StepResult(op, id uint64, old, status string, obs json.RawMessage) error {
	res, e := t.tx.ExecContext(t.ctx, `UPDATE project_release_operation_step SET status=?,observed=COALESCE(?,observed),updated_at=UTC_TIMESTAMP(3),lease_until=IF(?='running',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),NULL) WHERE operation_id=? AND id=? AND status=?`, status, obs, status, op, id, old)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if n != 1 {
		return httpx.E(409, "STATE_CHANGED", "步骤已变化，请重新核实")
	}
	return e
}
func (t *identityTx) EndOperation(op uint64, status string) error {
	var slot any
	if status == "unknown" {
		slot = 1
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_operation SET status=?,active_slot=?,finished_at=IF(? IS NULL,UTC_TIMESTAMP(3),NULL) WHERE id=? AND active_slot=1", status, slot, slot, op)
	return e
}

func (t *identityTx) releaseOccupies(pid, vid, rid uint64) (bool, error) {
	where := "p.project_id=? AND p.active_slot=1"
	args := []any{pid}
	if vid != 0 {
		where += " AND p.variant_id=?"
		args = append(args, vid)
	}
	if rid != 0 {
		where += " AND EXISTS(SELECT 1 FROM project_release_repository rr WHERE rr.release_id=p.id AND rr.project_repository_id=? AND rr.in_scope=1)"
		args = append(args, rid)
	}
	var active bool
	e := t.tx.GetContext(t.ctx, &active, fmt.Sprintf("SELECT EXISTS(SELECT 1 FROM project_release p WHERE %s)", where), args...)
	return active, e
}
