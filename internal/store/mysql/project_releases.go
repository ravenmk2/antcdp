package mysql

import (
	"database/sql"
	"errors"
	"time"

	driver "github.com/go-sql-driver/mysql"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const releaseColumns = "id,name,version_label,tag_name,description_md,status,row_version,variant_snapshot,updated_at,current_manifest_id,COALESCE(end_reason,'') end_reason"

func (t *identityTx) Releases(vid uint64, q d.Query) ([]d.Release, int, error) {
	rows := []d.Release{}
	where := "variant_id=?"
	args := []any{vid}
	if q.Status != "" && q.Status != "all" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	if q.Search != "" {
		// Names can be Unicode while version/Tag columns are ASCII. Convert the
		// columns so a Unicode search is not coerced into their ASCII charset.
		where += " AND (name LIKE ? ESCAPE '!' OR CONVERT(version_label USING utf8mb4) COLLATE utf8mb4_0900_bin LIKE ? ESCAPE '!' OR CONVERT(tag_name USING utf8mb4) COLLATE utf8mb4_0900_bin LIKE ? ESCAPE '!')"
		args = append(args, collabSearch(q.Search), collabSearch(q.Search), collabSearch(q.Search))
	}
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM project_release WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	args = append(args, q.Size, (q.Page-1)*q.Size)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+releaseColumns+","+releaseNeedsAttention+" needs_attention FROM project_release r WHERE "+where+" ORDER BY id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *identityTx) Release(vid, rid uint64) (*d.Release, error) {
	var r d.Release
	e := t.tx.GetContext(t.ctx, &r, "SELECT "+releaseColumns+","+releaseNeedsAttention+" needs_attention FROM project_release r WHERE id=? AND variant_id=?", rid, vid)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return &r, e
}
func (t *identityTx) SetReleasePrefix(vid uint64, prefix string) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_variant SET release_tag_prefix=?,row_version=row_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?", prefix, vid)
	return e
}
func releaseConflict(e error) error {
	var me *driver.MySQLError
	if errors.As(e, &me) && me.Number == 1062 {
		return httpx.E(409, "RELEASE_CONFLICT", "该版本号或 Tag 已被使用")
	}
	return e
}
func (t *identityTx) CreateRelease(pid, vid, uid uint64, r *d.Release) error {
	r.Updated = time.Now().UTC().Truncate(time.Millisecond)
	res, e := t.tx.ExecContext(t.ctx, "INSERT INTO project_release(project_id,variant_id,name,version_label,tag_name,variant_snapshot,description_md,status,actor_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", pid, vid, r.Name, r.VersionLabel, r.TagName, r.Snapshot, r.Description, r.Status, uid, r.Updated, r.Updated)
	if e != nil {
		return releaseConflict(e)
	}
	id, e := res.LastInsertId()
	r.ID = uint64(id)
	return e
}
func (t *identityTx) UpdateRelease(r *d.Release) error {
	r.Updated = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_release SET name=?,version_label=?,tag_name=?,description_md=?,row_version=?,updated_at=?,status=?,current_manifest_id=?,end_reason=NULLIF(?,''),ended_at=IF(? IN ('archived','terminated'),UTC_TIMESTAMP(3),NULL) WHERE id=?", r.Name, r.VersionLabel, r.TagName, r.Description, r.Version, r.Updated, r.Status, r.Manifest, r.EndReason, r.Status, r.ID)
	return releaseConflict(e)
}
