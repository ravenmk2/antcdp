package mysql

import d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"

const releaseNeedsAttention = "EXISTS(SELECT 1 FROM project_release_operation o WHERE o.release_id=r.id AND o.active_slot=1 AND o.status='unknown')"

func (t *identityTx) ProjectReleases(pid uint64, q d.Query) ([]d.ProjectRelease, int, error) {
	rows := []d.ProjectRelease{}
	where := "r.project_id=?"
	args := []any{pid}
	switch q.Status {
	case "active":
		where += " AND r.status NOT IN ('archived','terminated')"
	case "attention":
		where += " AND " + releaseNeedsAttention
	case "", "all":
	default:
		where += " AND r.status=?"
		args = append(args, q.Status)
	}
	if q.VariantID != 0 {
		where += " AND r.variant_id=?"
		args = append(args, q.VariantID)
	}
	if q.Search != "" {
		where += " AND (r.name LIKE ? ESCAPE '!' OR CONVERT(r.version_label USING utf8mb4) COLLATE utf8mb4_0900_bin LIKE ? ESCAPE '!' OR CONVERT(r.tag_name USING utf8mb4) COLLATE utf8mb4_0900_bin LIKE ? ESCAPE '!')"
		args = append(args, collabSearch(q.Search), collabSearch(q.Search), collabSearch(q.Search))
	}
	from := " FROM project_release r JOIN project_variant v ON v.id=r.variant_id AND v.project_id=r.project_id WHERE " + where
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*)"+from, args...); e != nil {
		return nil, 0, e
	}
	args = append(args, q.Size, (q.Page-1)*q.Size)
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT r.id,r.variant_id,v.name variant_name,v.code variant_code,r.name,r.version_label,r.tag_name,r.status,r.updated_at,"+releaseNeedsAttention+" needs_attention"+from+" ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, err
}
