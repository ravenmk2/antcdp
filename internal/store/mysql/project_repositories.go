package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

const projectRepoColumns = "r.id,r.project_id,r.connection_id,r.repo_id,r.name,r.namespace_path,r.full_path,r.web_url,r.http_clone_url,r.ssh_clone_url,r.default_branch,r.remote_archived,r.last_synced_at,r.row_version,r.created_by_user_id,r.created_at,r.updated_at,c.name AS connection_name,c.service_type,c.enabled AS connection_enabled"

func (t *identityTx) RepoVersion(pid uint64) (uint64, error) {
	var n uint64
	e := t.tx.GetContext(t.ctx, &n, "SELECT repositories_version FROM project WHERE id=?", pid)
	return n, e
}
func (t *identityTx) ProjectRepos(pid uint64, q i.RepoQuery) (i.RepoPage, error) {
	out := i.RepoPage{Items: []i.ProjectRepo{}, Page: q.Page, Size: q.Size}
	where := "r.project_id=?"
	args := []any{pid}
	if q.ConnectionID != 0 {
		where += " AND r.connection_id=?"
		args = append(args, q.ConnectionID)
	}
	if q.Search != "" {
		where += " AND (r.name LIKE ? ESCAPE '!' OR r.full_path LIKE ? ESCAPE '!')"
		args = append(args, collabSearch(q.Search), collabSearch(q.Search))
	}
	e := t.tx.GetContext(t.ctx, &out.Total, "SELECT COUNT(*) FROM project_repository r WHERE "+where, args...)
	if e != nil {
		return out, e
	}
	args = append(args, q.Size, (q.Page-1)*q.Size)
	e = t.tx.SelectContext(t.ctx, &out.Items, "SELECT "+projectRepoColumns+" FROM project_repository r JOIN service_connection c ON c.id=r.connection_id WHERE "+where+" ORDER BY r.id DESC LIMIT ? OFFSET ?", args...)
	return out, e
}
func (t *identityTx) ProjectRepo(pid, id uint64) (*i.ProjectRepo, error) {
	var v i.ProjectRepo
	e := t.tx.GetContext(t.ctx, &v, "SELECT "+projectRepoColumns+" FROM project_repository r JOIN service_connection c ON c.id=r.connection_id WHERE r.project_id=? AND r.id=?", pid, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, e
}
func (t *identityTx) LinkedRepoIDs(pid, cid uint64) ([]string, error) {
	out := []string{}
	e := t.tx.SelectContext(t.ctx, &out, "SELECT repo_id FROM project_repository WHERE project_id=? AND connection_id=?", pid, cid)
	return out, e
}
func (t *identityTx) InsertProjectRepo(v *i.ProjectRepo) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	v.SyncedAt = v.SyncedAt.Truncate(time.Millisecond)
	r, e := t.tx.NamedExecContext(t.ctx, `INSERT INTO project_repository(project_id,connection_id,repo_id,name,namespace_path,full_path,web_url,http_clone_url,ssh_clone_url,default_branch,remote_archived,last_synced_at,created_by_user_id,created_at,updated_at) VALUES(:project_id,:connection_id,:repo_id,:name,:namespace_path,:full_path,:web_url,:http_clone_url,:ssh_clone_url,:default_branch,:remote_archived,:last_synced_at,:created_by_user_id,:created_at,:updated_at)`, v)
	if e != nil {
		return e
	}
	id, e := r.LastInsertId()
	v.ID = uint64(id)
	return e
}
func (t *identityTx) SaveProjectRepo(v *i.ProjectRepo) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.tx.NamedExecContext(t.ctx, `UPDATE project_repository SET name=:name,namespace_path=:namespace_path,full_path=:full_path,web_url=:web_url,http_clone_url=:http_clone_url,ssh_clone_url=:ssh_clone_url,default_branch=:default_branch,remote_archived=:remote_archived,last_synced_at=:last_synced_at,row_version=:row_version,updated_at=:updated_at WHERE id=:id AND project_id=:project_id`, v)
	return e
}
func (t *identityTx) DeleteProjectRepo(pid, id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_repository WHERE project_id=? AND id=?", pid, id)
	return e
}
func (t *identityTx) BumpRepos(pid uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project SET repositories_version=repositories_version+1 WHERE id=?", pid)
	return e
}
func (t *identityTx) ConnectionRepoCount(cid uint64) (int, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM project_repository WHERE connection_id=?", cid)
	return n, e
}

func (t *identityTx) RepoDiagnostic(id uint64) (json.RawMessage, error) {
	var b []byte
	e := t.tx.GetContext(t.ctx, &b, "SELECT last_sync_check FROM project_repository WHERE id=?", id)
	return b, e
}
func (t *identityTx) SaveRepoDiagnostic(id uint64, b json.RawMessage) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_repository SET last_sync_check=? WHERE id=?", []byte(b), id)
	return e
}
