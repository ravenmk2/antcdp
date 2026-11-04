package mysql

import (
	"database/sql"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"

	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
)

func (t *identityTx) InitDelivery(pid, actor uint64) error {
	now := time.Now().UTC()
	if _, e := t.tx.ExecContext(t.ctx, "INSERT INTO project_branch_model(project_id,created_at,updated_at) VALUES(?,?,?)", pid, now, now); e != nil {
		return e
	}
	for _, r := range d.Defaults() {
		if _, e := t.tx.ExecContext(t.ctx, "INSERT INTO project_branch_rule(project_id,branch_type,enabled,rule_mode,rule_pattern) VALUES(?,?,?,?,?)", pid, r.Type, r.Enabled, r.Rule.Mode, r.Rule.Pattern); e != nil {
			return e
		}
	}
	return t.SaveVariant(&d.Variant{ProjectID: pid, Code: "standard", Name: "标准版", Kind: "standard", Branch: "main", Scope: d.DefaultScope(false), Creator: actor, Version: 1, EnvironmentsVersion: 1}, true)
}
func (t *identityTx) DeliveryModel(pid uint64) (*d.Model, error) {
	var m d.Model
	e := t.tx.GetContext(t.ctx, &m, "SELECT project_id,row_version,variants_version FROM project_branch_model WHERE project_id=?", pid)
	if e != nil {
		return nil, e
	}
	var rows []struct {
		Type    string  `db:"branch_type"`
		Enabled bool    `db:"enabled"`
		Mode    *string `db:"rule_mode"`
		Pattern *string `db:"rule_pattern"`
	}
	if e = t.tx.SelectContext(t.ctx, &rows, "SELECT branch_type,enabled,rule_mode,rule_pattern FROM project_branch_rule WHERE project_id=? ORDER BY branch_type", pid); e != nil {
		return nil, e
	}
	for _, typ := range d.Types {
		for _, r := range rows {
			if typ.Type != r.Type {
				continue
			}
			v := d.BranchRule{Type: r.Type, Enabled: r.Enabled}
			if r.Mode != nil && r.Pattern != nil {
				v.Rule = &d.Rule{Mode: *r.Mode, Pattern: *r.Pattern}
			}
			m.Rules = append(m.Rules, v)
		}
	}
	return &m, nil
}
func (t *identityTx) SaveDeliveryModel(m *d.Model) error {
	for _, r := range m.Rules {
		var mode, pattern any
		if r.Rule != nil {
			mode = r.Rule.Mode
			pattern = r.Rule.Pattern
		}
		if _, e := t.tx.ExecContext(t.ctx, "UPDATE project_branch_rule SET enabled=?,rule_mode=?,rule_pattern=? WHERE project_id=? AND branch_type=?", r.Enabled, mode, pattern, m.ProjectID, r.Type); e != nil {
			return e
		}
	}
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_branch_model SET row_version=?,updated_at=? WHERE project_id=?", m.Version, time.Now().UTC(), m.ProjectID)
	return e
}

const variantColumns = "v.id,v.project_id,v.code,v.name,v.summary,v.kind,v.main_branch,COALESCE(v.release_tag_prefix,'') AS release_tag_prefix,v.repository_scope,v.row_version,v.environments_version,v.created_by_user_id,v.created_at,v.updated_at,v.archived_at,(SELECT COUNT(*) FROM project_environment e WHERE e.variant_id=v.id) AS environment_count"

func (t *identityTx) Variants(pid uint64, q d.Query) ([]d.Variant, int, error) {
	rows := []d.Variant{}
	where := "v.project_id=?"
	args := []any{pid}
	switch q.Status {
	case "active":
		where += " AND v.archived_at IS NULL"
	case "archived":
		where += " AND v.archived_at IS NOT NULL"
	}
	if q.Search != "" {
		where += " AND (v.name LIKE ? ESCAPE '!' OR CONVERT(v.code USING utf8mb4) LIKE ? ESCAPE '!')"
		args = append(args, collabSearch(q.Search), collabSearch(q.Search))
	}
	var count int
	if e := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM project_variant v WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	sql := "SELECT " + variantColumns + " FROM project_variant v WHERE " + where + " ORDER BY v.standard_slot DESC,v.id"
	if q.Size > 0 {
		sql += " LIMIT ? OFFSET ?"
		args = append(args, q.Size, (q.Page-1)*q.Size)
	}
	e := t.tx.SelectContext(t.ctx, &rows, sql, args...)
	return rows, count, e
}
func (t *identityTx) Variant(pid, id uint64) (*d.Variant, error) {
	var v d.Variant
	e := t.tx.GetContext(t.ctx, &v, "SELECT "+variantColumns+" FROM project_variant v WHERE v.project_id=? AND v.id=?", pid, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, e
}
func (t *identityTx) SaveVariant(v *d.Variant, create bool) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	if create {
		v.CreatedAt = v.UpdatedAt
		var slot any
		if v.Kind == "standard" {
			slot = 1
		}
		r, e := t.tx.ExecContext(t.ctx, `INSERT INTO project_variant(project_id,code,name,summary,kind,standard_slot,main_branch,repository_scope,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, v.ProjectID, v.Code, v.Name, v.Summary, v.Kind, slot, v.Branch, v.Scope, v.Creator, v.CreatedAt, v.UpdatedAt)
		if e != nil {
			return e
		}
		id, e := r.LastInsertId()
		v.ID = uint64(id)
		return e
	}
	_, e := t.tx.NamedExecContext(t.ctx, `UPDATE project_variant SET name=:name,summary=:summary,main_branch=:main_branch,repository_scope=:repository_scope,row_version=:row_version,archived_at=:archived_at,updated_at=:updated_at WHERE id=:id AND project_id=:project_id`, v)
	return e
}
func (t *identityTx) DeleteVariant(pid, id uint64) error {
	var used bool
	if e := t.tx.GetContext(t.ctx, &used, "SELECT EXISTS(SELECT 1 FROM project_release WHERE variant_id=?)", id); e != nil {
		return e
	}
	if used {
		return httpx.E(409, "VARIANT_HAS_RELEASES", "产品分支已有发布历史，不能删除")
	}
	if _, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_branch_check WHERE project_id=? AND subject_kind='variant' AND subject_id=?", pid, id); e != nil {
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_variant WHERE project_id=? AND id=?", pid, id)
	return e
}

const environmentColumns = "id,project_id,variant_id,code,name,summary,branch_type,branch_name,repository_scope,row_version,created_by_user_id,created_at,updated_at"

func (t *identityTx) Environments(pid, vid uint64) ([]d.Environment, error) {
	rows := []d.Environment{}
	q := "SELECT " + environmentColumns + " FROM project_environment WHERE project_id=?"
	args := []any{pid}
	if vid != 0 {
		q += " AND variant_id=?"
		args = append(args, vid)
	}
	e := t.tx.SelectContext(t.ctx, &rows, q+" ORDER BY id", args...)
	return rows, e
}
func (t *identityTx) Environment(pid, vid, id uint64) (*d.Environment, error) {
	var v d.Environment
	e := t.tx.GetContext(t.ctx, &v, "SELECT "+environmentColumns+" FROM project_environment WHERE project_id=? AND variant_id=? AND id=?", pid, vid, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, e
}
func (t *identityTx) SaveEnvironment(v *d.Environment, create bool) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	if create {
		v.CreatedAt = v.UpdatedAt
		r, e := t.tx.NamedExecContext(t.ctx, `INSERT INTO project_environment(project_id,variant_id,code,name,summary,branch_type,branch_name,repository_scope,created_by_user_id,created_at,updated_at) VALUES(:project_id,:variant_id,:code,:name,:summary,:branch_type,:branch_name,:repository_scope,:created_by_user_id,:created_at,:updated_at)`, v)
		if e != nil {
			return e
		}
		id, e := r.LastInsertId()
		v.ID = uint64(id)
		return e
	}
	_, e := t.tx.NamedExecContext(t.ctx, `UPDATE project_environment SET name=:name,summary=:summary,branch_type=:branch_type,branch_name=:branch_name,repository_scope=:repository_scope,row_version=:row_version,updated_at=:updated_at WHERE id=:id AND variant_id=:variant_id AND project_id=:project_id`, v)
	return e
}
func (t *identityTx) DeleteEnvironment(pid, vid, id uint64) error {
	if _, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_branch_check WHERE project_id=? AND subject_kind='environment' AND subject_id=?", pid, id); e != nil {
		return e
	}
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM project_environment WHERE project_id=? AND variant_id=? AND id=?", pid, vid, id)
	return e
}
func (t *identityTx) BumpVariants(pid uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_branch_model SET variants_version=variants_version+1 WHERE project_id=?", pid)
	return e
}
func (t *identityTx) BumpEnvironments(vid uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE project_variant SET environments_version=environments_version+1 WHERE id=?", vid)
	return e
}
func (t *identityTx) DeliveryBusy(pid, vid, rid uint64) (bool, error) {
	if busy, e := t.releaseOccupies(pid, vid, rid); busy || e != nil {
		return busy, e
	}
	q := "SELECT COUNT(*) FROM project_branch_creation c WHERE c.project_id=? AND c.active_slot=1"
	args := []any{pid}
	if vid != 0 {
		q += " AND c.variant_id=?"
		args = append(args, vid)
	}
	if rid != 0 {
		q += " AND EXISTS(SELECT 1 FROM project_branch_creation_item i WHERE i.creation_id=c.id AND i.project_repository_id=?)"
		args = append(args, rid)
	}
	var n int
	e := t.tx.GetContext(t.ctx, &n, q, args...)
	return n > 0, e
}
