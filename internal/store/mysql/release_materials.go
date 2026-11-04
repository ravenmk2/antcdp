package mysql

import (
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"path"
	"slices"
	"strings"

	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const materialSelect = `SELECT i.id,i.release_id,i.kind,COALESCE(i.sql_position,0) position_no,r.id revision_id,r.revision_no,r.filename,r.description_md,COALESCE(CAST(r.release_repository_id AS CHAR),'') repository_id,COALESCE(r.database_name,'') database_name,COALESCE(r.bucket_name,'') bucket_name,COALESCE(r.target_path,'') target_path,COALESCE(r.config_format,'') config_format,COALESCE(r.config_mode,'') config_mode,r.file_id,f.storage_key,f.size_bytes,LOWER(HEX(f.sha256)) sha256 FROM project_release_item i JOIN project_release_revision r ON r.item_id=i.id JOIN project_release_file f ON f.id=r.file_id AND f.item_id=i.id AND f.state='bound' WHERE i.release_id=?`

func (t *identityTx) MaterialRows(rid uint64) ([]d.Material, error) {
	rows := []d.Material{}
	e := t.tx.SelectContext(t.ctx, &rows, materialSelect+" AND r.id=i.current_revision_id AND i.removed_at IS NULL ORDER BY i.kind,i.sql_position,i.id", rid)
	return rows, e
}
func (t *identityTx) MaterialRevision(rid, id uint64, rev string) (*d.Material, error) {
	where := " AND r.id=i.current_revision_id AND i.removed_at IS NULL"
	args := []any{rid, id}
	if rev != "" {
		where = " AND r.id=?"
		args = append(args, rev)
	}
	var m d.Material
	e := t.tx.GetContext(t.ctx, &m, materialSelect+" AND i.id=?"+where, args...)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return &m, e
}
func (t *identityTx) MaterialRepos(rid uint64) ([]d.ReleaseRepo, error) {
	rows := []d.ReleaseRepo{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT id,repository_path,branch_name,connection_id,repo_id,project_repository_id,COALESCE(baseline_sha,'') baseline_sha,baseline_kind FROM project_release_repository WHERE release_id=? AND in_scope=1 ORDER BY id", rid)
	return rows, e
}
func canonicalReleaseInstance(raw string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Hostname() == "" {
		return "", httpx.Invalid("base_url", "invalid_instance")
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	port := u.Port()
	defaultPort := u.Scheme == "https" && port == "443" || u.Scheme == "http" && port == "80"
	if port != "" && !defaultPort {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	u.Path = path.Clean("/" + strings.TrimPrefix(u.Path, "/"))
	return strings.TrimSuffix(u.String(), "/"), nil
}
func (t *identityTx) SnapshotReleaseRepos(rid uint64, branch string, rows []d.ScopedRepo) error {
	if _, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_repository SET in_scope=0 WHERE release_id=?", rid); e != nil {
		return e
	}
	instances := map[uint64]string{}
	for _, repo := range rows {
		instance, ok := instances[repo.ConnectionID]
		if !ok {
			var raw string
			if e := t.tx.GetContext(t.ctx, &raw, "SELECT JSON_UNQUOTE(JSON_EXTRACT(config,'$.base_url')) FROM service_connection WHERE id=?", repo.ConnectionID); e != nil {
				return e
			}
			var e error
			instance, e = canonicalReleaseInstance(raw)
			if e != nil {
				return e
			}
			instances[repo.ConnectionID] = instance
		}
		_, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_release_repository(release_id,project_repository_id,connection_id,repo_id,repository_path,branch_name,remote_key,in_scope,baseline_kind)
 VALUES(?,?,?,?,?,?,UNHEX(SHA2(JSON_ARRAY(?,?,?),256)),1,'initial')
 ON DUPLICATE KEY UPDATE in_scope=1,baseline_sha=IF(branch_name=VALUES(branch_name),baseline_sha,NULL),baseline_kind=IF(branch_name=VALUES(branch_name),baseline_kind,'initial'),baseline_at=IF(branch_name=VALUES(branch_name),baseline_at,NULL),baseline_ref=IF(branch_name=VALUES(branch_name),baseline_ref,NULL),baseline_actor_id=IF(branch_name=VALUES(branch_name),baseline_actor_id,NULL),repository_path=VALUES(repository_path),remote_key=VALUES(remote_key),branch_name=VALUES(branch_name)`, rid, repo.ID, repo.ConnectionID, repo.RepoID, repo.FullPath, branch, instance, repo.RepoID, branch)
		if e != nil {
			return e
		}
	}
	return nil
}
func (t *identityTx) ReserveMaterial(m *d.Material, uid uint64) error {
	if m.ID == 0 {
		res, e := t.tx.ExecContext(t.ctx, "INSERT INTO project_release_item(release_id,kind,actor_user_id,created_at) VALUES(?,?,?,UTC_TIMESTAMP(3))", m.ReleaseID, m.Kind, uid)
		if e != nil {
			return e
		}
		id, e := res.LastInsertId()
		if e != nil {
			return e
		}
		m.ID = uint64(id)
	}
	var scope struct {
		Project uint64 `db:"project_id"`
		Variant uint64 `db:"variant_id"`
	}
	if e := t.tx.GetContext(t.ctx, &scope, "SELECT project_id,variant_id FROM project_release WHERE id=?", m.ReleaseID); e != nil {
		return e
	}
	dir := map[string]string{"sql": "sql", "object": "objects", "config": "configs", "attachment": "attachments"}[m.Kind]
	m.StorageKey = fmt.Sprintf("releases/%d/%d/%d/%s/%d/%s/payload", scope.Project, scope.Variant, m.ReleaseID, dir, m.ID, m.Revision)
	_, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_release_file(id,release_id,item_id,origin_revision_id,storage_key,size_bytes,sha256,state,actor_user_id,created_at) VALUES(?,?,?,?,?,?,UNHEX(?),'staged',?,UTC_TIMESTAMP(3))`, m.FileID, m.ReleaseID, m.ID, m.Revision, m.StorageKey, m.Size, m.Hash, uid)
	return e
}
func (t *identityTx) BindMaterial(m *d.Material, uid uint64) error {
	_, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_release_revision(id,item_id,revision_no,file_id,release_repository_id,filename,description_md,database_name,bucket_name,target_path,config_format,config_mode,actor_user_id,created_at) VALUES(?,?,?,?,NULLIF(?,''),?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,UTC_TIMESTAMP(3))`, m.Revision, m.ID, m.Number, m.FileID, m.Repository, m.Filename, m.Description, m.Database, m.Bucket, m.Target, m.Format, m.Mode, uid)
	if e != nil {
		return e
	}
	if m.Kind == "sql" && m.Number == 1 {
		if e = t.tx.GetContext(t.ctx, &m.Position, "SELECT COALESCE(MAX(sql_position),0)+1 FROM project_release_item WHERE release_id=? AND removed_at IS NULL", m.ReleaseID); e != nil {
			return e
		}
		if _, e = t.tx.ExecContext(t.ctx, "UPDATE project_release_item SET sql_position=? WHERE id=?", m.Position, m.ID); e != nil {
			return e
		}
	}
	if _, e = t.tx.ExecContext(t.ctx, "UPDATE project_release_file SET state='bound' WHERE item_id=? AND id=?", m.ID, m.FileID); e != nil {
		return e
	}
	_, e = t.tx.ExecContext(t.ctx, "UPDATE project_release_item SET current_revision_id=?,row_version=row_version+1 WHERE release_id=? AND id=?", m.Revision, m.ReleaseID, m.ID)
	return e
}
func (t *identityTx) RemoveMaterial(rid, id uint64) error {
	res, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_item SET removed_at=UTC_TIMESTAMP(3),row_version=row_version+1 WHERE id=? AND release_id=? AND removed_at IS NULL AND current_revision_id IS NOT NULL", id, rid)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if e == nil && n == 0 {
		return httpx.E(404, "NOT_FOUND", "材料不存在")
	}
	return e
}
func (t *identityTx) SortMaterial(rid uint64, ids []uint64) error {
	var current []uint64
	if e := t.tx.SelectContext(t.ctx, &current, "SELECT id FROM project_release_item WHERE release_id=? AND kind='sql' AND current_revision_id IS NOT NULL AND removed_at IS NULL ORDER BY id", rid); e != nil {
		return e
	}
	sorted := slices.Clone(ids)
	slices.Sort(sorted)
	if !slices.Equal(sorted, current) {
		return httpx.Invalid("item_ids", "invalid_order")
	}
	for n, id := range ids {
		if _, e := t.tx.ExecContext(t.ctx, "UPDATE project_release_item SET sql_position=? WHERE id=? AND release_id=?", n+1, id, rid); e != nil {
			return e
		}
	}
	return nil
}

func (t *identityTx) StagedReleaseFiles() (map[string]string, error) {
	var rows []struct {
		ID  string `db:"id"`
		Key string `db:"storage_key"`
	}
	if e := t.tx.SelectContext(t.ctx, &rows, `SELECT f.id,f.storage_key FROM project_release_file f WHERE f.state='staged' AND NOT EXISTS(SELECT 1 FROM project_release_revision r WHERE r.file_id=f.id)`); e != nil {
		return nil, e
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.ID] = r.Key
	}
	return out, nil
}
func (t *identityTx) DiscardStagedReleaseFile(id string) error {
	_, e := t.tx.ExecContext(t.ctx, `DELETE FROM project_release_file WHERE id=? AND state='staged' AND NOT EXISTS(SELECT 1 FROM project_release_revision WHERE file_id=?)`, id, id)
	return e
}

func (t *identityTx) MaterialHistory(rid, id uint64, q d.Query) ([]d.Material, int, error) {
	rows := []d.Material{}
	where := " AND i.removed_at IS NOT NULL AND r.id=i.current_revision_id"
	args := []any{rid}
	if id != 0 {
		where = " AND i.id=?"
		args = append(args, id)
	}
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM ("+materialSelect+where+") history_rows", args...); e != nil {
		return nil, 0, e
	}
	args = append(args, q.Size, (q.Page-1)*q.Size)
	e := t.tx.SelectContext(t.ctx, &rows, materialSelect+where+" ORDER BY i.id DESC,r.revision_no DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
