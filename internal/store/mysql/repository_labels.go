package mysql

import (
	"github.com/jmoiron/sqlx"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

func (t *identityTx) RepositoryLabels(pid uint64) ([]i.RepositoryLabelDefinition, error) {
	rows := []i.RepositoryLabelDefinition{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT l.id,l.code,l.name,l.color,(SELECT COUNT(*) FROM project_repository_label_binding b WHERE b.label_id=l.id) AS repository_count FROM project_repository_label l WHERE l.project_id=? ORDER BY l.code,l.id", pid)
	return rows, e
}
func (t *identityTx) loadRepositoryLabels(rows []i.ProjectRepo) error {
	if len(rows) == 0 {
		return nil
	}
	ids := make([]uint64, len(rows))
	index := map[uint64]int{}
	for n := range rows {
		rows[n].Labels = []i.RepositoryLabel{}
		ids[n] = rows[n].ID
		index[rows[n].ID] = n
	}
	var labels []struct {
		i.RepositoryLabel
		RepositoryID uint64 `db:"project_repository_id"`
	}
	query, args, e := sqlx.In("SELECT b.project_repository_id,l.id,l.code,l.name,l.color FROM project_repository_label_binding b JOIN project_repository_label l ON l.id=b.label_id JOIN project_repository r ON r.id=b.project_repository_id AND r.project_id=l.project_id WHERE b.project_repository_id IN (?) ORDER BY l.code,l.id", ids)
	if e != nil {
		return e
	}
	if e = t.tx.SelectContext(t.ctx, &labels, query, args...); e != nil {
		return e
	}
	for _, label := range labels {
		n := index[label.RepositoryID]
		rows[n].Labels = append(rows[n].Labels, label.RepositoryLabel)
	}
	return nil
}
func (t *identityTx) touchLabelRepositories(pid, id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_repository r JOIN project_repository_label_binding b ON b.project_repository_id=r.id SET r.row_version=r.row_version+1,r.updated_at=UTC_TIMESTAMP(3) WHERE r.project_id=? AND b.label_id=?", pid, id)
	return e
}
func (t *identityTx) SaveRepositoryLabel(pid, actor uint64, v *i.RepositoryLabel, create bool) error {
	if create {
		result, e := t.tx.ExecContext(t.ctx, "INSERT INTO project_repository_label(project_id,code,name,color,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", pid, v.Code, v.Name, v.Color, actor)
		if e != nil {
			return e
		}
		id, e := result.LastInsertId()
		v.ID = uint64(id)
		return e
	}
	if e := t.touchLabelRepositories(pid, v.ID); e != nil {
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_repository_label SET name=?,color=?,updated_at=UTC_TIMESTAMP(3) WHERE project_id=? AND id=?", v.Name, v.Color, pid, v.ID)
	return e
}
func (t *identityTx) DeleteRepositoryLabel(pid, id uint64) error {
	if e := t.touchLabelRepositories(pid, id); e != nil {
		return e
	}
	if _, e := t.tx.ExecContext(t.ctx, "DELETE b FROM project_repository_label_binding b JOIN project_repository_label l ON l.id=b.label_id WHERE l.project_id=? AND l.id=?", pid, id); e != nil {
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_repository_label WHERE project_id=? AND id=?", pid, id)
	return e
}
func (t *identityTx) SetRepositoryLabels(pid, rid uint64, ids []uint64) error {
	if _, e := t.tx.ExecContext(t.ctx, "DELETE b FROM project_repository_label_binding b JOIN project_repository r ON r.id=b.project_repository_id WHERE r.project_id=? AND r.id=?", pid, rid); e != nil {
		return e
	}
	for _, id := range ids {
		if _, e := t.tx.ExecContext(t.ctx, "INSERT INTO project_repository_label_binding(project_repository_id,label_id,created_at) VALUES(?,?,UTC_TIMESTAMP(3))", rid, id); e != nil {
			return e
		}
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_repository SET row_version=row_version+1,updated_at=UTC_TIMESTAMP(3) WHERE project_id=? AND id=?", pid, rid)
	return e
}
