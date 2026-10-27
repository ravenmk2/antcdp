package mysql

import (
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func collabTable(k c.Kind) string {
	if k == c.Team {
		return "team"
	}
	return "project"
}
func collabEnd(k c.Kind) string {
	if k == c.Team {
		return "dissolved_at"
	}
	return "archived_at"
}
func membership(k c.Kind, uid uint64) (string, []any) {
	if k == c.Project {
		return projectMembership, []any{uid, uid}
	}
	return "(o.dissolved_at IS NULL AND EXISTS (SELECT 1 FROM team_member m WHERE m.team_id=o.id AND m.user_id=?))", []any{uid}
}
func collabColumns(k c.Kind) string {
	table := collabTable(k)
	return "o.id,o.code,o.name,o.summary,o.description,o.icon_key,o.icon_file_id,o.created_by_user_id,o.row_version,o.membership_version,o." + collabEnd(k) + " AS ended_at,o.created_at,o.updated_at,COALESCE((SELECT role FROM " + table + "_member WHERE " + table + "_id=o.id AND user_id=?),'') AS direct_role"
}
func (t *identityTx) Resource(k c.Kind, id, uid uint64) (*c.Resource, error) {
	p, args := membership(k, uid)
	q := "SELECT " + collabColumns(k) + "," + p + " AS is_member FROM " + collabTable(k) + " o WHERE o.id=?"
	all := append([]any{uid}, args...)
	all = append(all, id)
	var out c.Resource
	err := t.tx.GetContext(t.ctx, &out, q, all...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ms, err := t.Members(k, id)
	if err != nil {
		return nil, err
	}
	out.MemberCount = len(ms)
	return &out, nil
}
func collabSearch(q string) string {
	return "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q) + "%"
}
func (t *identityTx) Resources(k c.Kind, uid uint64, f c.Query) (c.Page, error) {
	out := c.Page{Items: []c.Resource{}, Page: f.Page, PageSize: f.Size}
	table := collabTable(k)
	where := "1=1"
	args := []any{}
	if f.Scope == "mine" {
		p, a := membership(k, uid)
		where += " AND " + p
		args = append(args, a...)
	}
	if f.Status != "all" {
		where += " AND o." + collabEnd(k)
		if f.Status == "active" {
			where += " IS NULL"
		} else {
			where += " IS NOT NULL"
		}
	}
	if f.Unmanaged {
		where += " AND NOT EXISTS (SELECT 1 FROM " + table + "_member m JOIN `user` u ON u.id=m.user_id WHERE m." + table + "_id=o.id AND m.role='admin' AND u.status='active' AND u.deleted_at IS NULL)"
	}
	if f.Search != "" {
		where += " AND (o.code LIKE ? ESCAPE '!' OR o.name LIKE ? ESCAPE '!' OR o.summary LIKE ? ESCAPE '!')"
		q := collabSearch(f.Search)
		args = append(args, q, q, q)
	}
	if err := t.tx.GetContext(t.ctx, &out.Total, "SELECT COUNT(*) FROM "+table+" o WHERE "+where, args...); err != nil {
		return out, err
	}
	var ids []uint64
	a := append(append([]any{}, args...), f.Size, (f.Page-1)*f.Size)
	if err := t.tx.SelectContext(t.ctx, &ids, "SELECT o.id FROM "+table+" o WHERE "+where+" ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?", a...); err != nil {
		return out, err
	}
	for _, id := range ids {
		o, err := t.Resource(k, id, uid)
		if err != nil {
			return out, err
		}
		if o != nil {
			o.Description = ""
			out.Items = append(out.Items, *o)
		}
	}
	return out, nil
}
func (t *identityTx) CollaborationUsers(k c.Kind, id uint64) ([]uint64, error) {
	table := collabTable(k)
	q := "SELECT user_id FROM " + table + "_member WHERE " + table + "_id=? UNION SELECT user_id FROM user_" + table + "_shortcut WHERE " + table + "_id=?"
	args := []any{id, id}
	if k == c.Project {
		q += " UNION SELECT m.user_id FROM project_team pt JOIN team_member m ON m.team_id=pt.team_id WHERE pt.project_id=?"
		args = append(args, id)
	} else {
		q += " UNION SELECT s.user_id FROM user_project_shortcut s JOIN project_team pt ON pt.project_id=s.project_id WHERE pt.team_id=?"
		args = append(args, id)
	}
	var out []uint64
	err := t.tx.SelectContext(t.ctx, &out, q, args...)
	return out, err
}
func (t *identityTx) LockCollaboration(k c.Kind, id, extraTeam uint64) error {
	var teams, projects []uint64
	if k == c.Team {
		teams = []uint64{id}
	} else {
		projects = []uint64{id}
		if err := t.tx.SelectContext(t.ctx, &teams, "SELECT team_id FROM project_team WHERE project_id=? ORDER BY team_id", id); err != nil {
			return err
		}
	}
	if extraTeam != 0 {
		teams = append(teams, extraTeam)
	}
	slices.Sort(teams)
	teams = slices.Compact(teams)
	for _, v := range teams {
		var found []uint64
		if err := t.tx.SelectContext(t.ctx, &found, "SELECT id FROM team WHERE id=? FOR UPDATE", v); err != nil {
			return err
		}
	}
	if k == c.Team {
		if err := t.tx.SelectContext(t.ctx, &projects, "SELECT project_id FROM project_team WHERE team_id=? ORDER BY project_id", id); err != nil {
			return err
		}
	}
	for _, g := range []struct {
		table string
		ids   []uint64
	}{{"project", projects}} {
		for _, v := range g.ids {
			var found []uint64
			if err := t.tx.SelectContext(t.ctx, &found, "SELECT id FROM "+g.table+" WHERE id=? FOR UPDATE", v); err != nil {
				return err
			}
		}
	}
	return nil
}
func (t *identityTx) TeamProjects(id, uid uint64, admin bool) ([]c.Resource, error) {
	var ids []uint64
	out := []c.Resource{}
	if err := t.tx.SelectContext(t.ctx, &ids, "SELECT project_id FROM project_team WHERE team_id=? ORDER BY project_id", id); err != nil {
		return out, err
	}
	for _, v := range ids {
		o, err := t.Resource(c.Project, v, uid)
		if err != nil {
			return out, err
		}
		if o != nil && (admin || o.IsMember) {
			o.Description = ""
			o.Decorate(c.Project, admin)
			out = append(out, *o)
		}
	}
	return out, nil
}
func (t *identityTx) InsertResource(k c.Kind, o *c.Resource, admins []uint64) error {
	table := collabTable(k)
	r, err := t.tx.ExecContext(t.ctx, "INSERT INTO "+table+" (code,name,summary,description,icon_key,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", o.Code, o.Name, o.Summary, o.Description, o.IconKey, o.Creator, o.CreatedAt, o.UpdatedAt)
	if err != nil {
		return err
	}
	id, err := r.LastInsertId()
	if err != nil {
		return err
	}
	o.ID = uint64(id)
	for _, uid := range admins {
		if _, err = t.tx.ExecContext(t.ctx, "INSERT INTO "+table+"_member ("+table+"_id,user_id,role,created_at,updated_at) VALUES (?,?,'admin',?,?)", o.ID, uid, o.CreatedAt, o.CreatedAt); err != nil {
			return err
		}
	}
	return nil
}
func (t *identityTx) SaveResource(k c.Kind, o *c.Resource) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE "+collabTable(k)+" SET name=?,summary=?,description=?,icon_key=?,icon_file_id=?,row_version=?,membership_version=?,"+collabEnd(k)+"=?,updated_at=? WHERE id=?", o.Name, o.Summary, o.Description, o.IconKey, o.IconFileID, o.Version, o.MembershipVersion, o.EndedAt, o.UpdatedAt, o.ID)
	return err
}
func (t *identityTx) Members(k c.Kind, id uint64) ([]c.Member, error) {
	rows := []c.Member{}
	table := collabTable(k)
	q := "SELECT u.id,u.username,u.display_name,u.status,m.role,0 AS team_id,'' AS team_name FROM " + table + "_member m JOIN `user` u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE m." + table + "_id=?"
	args := []any{id}
	if k == c.Project {
		q += " UNION ALL SELECT u.id,u.username,u.display_name,u.status,'' AS role,tm.id AS team_id,tm.name AS team_name FROM project_team pt JOIN team tm ON tm.id=pt.team_id AND tm.dissolved_at IS NULL JOIN team_member m ON m.team_id=tm.id JOIN `user` u ON u.id=m.user_id AND u.deleted_at IS NULL WHERE pt.project_id=?"
		args = append(args, id)
	}
	q += " ORDER BY id,team_id"
	if err := t.tx.SelectContext(t.ctx, &rows, q, args...); err != nil {
		return nil, err
	}
	out := []c.Member{}
	indices := map[uint64]int{}
	for _, m := range rows {
		i, ok := indices[m.ID]
		if !ok {
			i = len(out)
			indices[m.ID] = i
			m.Sources = []c.Source{}
			m.EffectiveRole = "member"
			out = append(out, m)
		}
		if m.Role != "" {
			out[i].Role = m.Role
			if m.Role == "admin" {
				out[i].EffectiveRole = "admin"
			}
			out[i].Sources = append(out[i].Sources, c.Source{Type: "direct"})
		} else {
			out[i].Sources = append(out[i].Sources, c.Source{Type: "team", TeamID: m.TeamID, Name: m.TeamName})
		}
	}
	return out, nil
}
func (t *identityTx) SetMember(k c.Kind, id, uid uint64, role string, now time.Time) (bool, error) {
	table := collabTable(k)
	var old []string
	if err := t.tx.SelectContext(t.ctx, &old, "SELECT role FROM "+table+"_member WHERE "+table+"_id=? AND user_id=?", id, uid); err != nil {
		return false, err
	}
	if len(old) == 0 && role == "" || len(old) > 0 && old[0] == role {
		return false, nil
	}
	var err error
	if role == "" {
		_, err = t.tx.ExecContext(t.ctx, "DELETE FROM "+table+"_member WHERE "+table+"_id=? AND user_id=?", id, uid)
	} else if len(old) == 0 {
		_, err = t.tx.ExecContext(t.ctx, "INSERT INTO "+table+"_member ("+table+"_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)", id, uid, role, now, now)
	} else {
		_, err = t.tx.ExecContext(t.ctx, "UPDATE "+table+"_member SET role=?,updated_at=? WHERE "+table+"_id=? AND user_id=?", role, now, id, uid)
	}
	return err == nil, err
}
func (t *identityTx) BumpMembers(k c.Kind, id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE "+collabTable(k)+" SET membership_version=membership_version+1 WHERE id=?", id)
	return err
}
func (t *identityTx) ProjectTeams(id, uid uint64) ([]c.Resource, error) {
	var ids []uint64
	out := []c.Resource{}
	if err := t.tx.SelectContext(t.ctx, &ids, "SELECT team_id FROM project_team WHERE project_id=? ORDER BY team_id", id); err != nil {
		return out, err
	}
	for _, v := range ids {
		o, err := t.Resource(c.Team, v, uid)
		if err != nil {
			return out, err
		}
		if o != nil {
			o.Description = ""
			o.Decorate(c.Team, false)
			out = append(out, *o)
		}
	}
	return out, nil
}
func (t *identityTx) SetProjectTeam(id, team uint64, add bool, now time.Time) (bool, error) {
	var count int
	if err := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM project_team WHERE project_id=? AND team_id=?", id, team); err != nil {
		return false, err
	}
	if (count > 0) == add {
		return false, nil
	}
	var err error
	if add {
		_, err = t.tx.ExecContext(t.ctx, "INSERT INTO project_team(project_id,team_id,created_at) VALUES (?,?,?)", id, team, now)
	} else {
		_, err = t.tx.ExecContext(t.ctx, "DELETE FROM project_team WHERE project_id=? AND team_id=?", id, team)
	}
	return err == nil, err
}
func (t *identityTx) EndTeam(id uint64, now time.Time) error {
	var projects []uint64
	if err := t.tx.SelectContext(t.ctx, &projects, "SELECT project_id FROM project_team WHERE team_id=? ORDER BY project_id", id); err != nil {
		return err
	}
	for _, p := range projects {
		var locked uint64
		if err := t.tx.GetContext(t.ctx, &locked, "SELECT id FROM project WHERE id=? FOR UPDATE", p); err != nil {
			return err
		}
		if err := t.BumpMembers(c.Project, p); err != nil {
			return err
		}
	}
	for _, q := range []string{"DELETE FROM project_team WHERE team_id=?", "DELETE FROM team_member WHERE team_id=?"} {
		if _, err := t.tx.ExecContext(t.ctx, q, id); err != nil {
			return err
		}
	}
	return nil
}
func (t *identityTx) CleanupShortcuts(users []uint64, now time.Time) error {
	users = append([]uint64{}, users...)
	slices.Sort(users)
	users = slices.Compact(users)
	for _, uid := range users {
		if uid == 0 {
			continue
		}
		var pref []uint64
		if err := t.tx.SelectContext(t.ctx, &pref, "SELECT user_id FROM user_sidebar_preference WHERE user_id=? FOR UPDATE", uid); err != nil {
			return err
		}
		if len(pref) == 0 {
			continue
		}
		for _, k := range []c.Kind{c.Project, c.Team} {
			table := collabTable(k)
			p, args := membership(k, uid)
			all := append([]any{uid}, args...)
			var ids []uint64
			q := "SELECT s." + table + "_id FROM user_" + table + "_shortcut s JOIN " + table + " o ON o.id=s." + table + "_id WHERE s.user_id=? AND NOT " + p
			if err := t.tx.SelectContext(t.ctx, &ids, q, all...); err != nil {
				return err
			}
			if len(ids) == 0 {
				continue
			}
			for _, id := range ids {
				if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM user_"+table+"_shortcut WHERE user_id=? AND "+table+"_id=?", uid, id); err != nil {
					return err
				}
			}
			var remaining []uint64
			if err := t.tx.SelectContext(t.ctx, &remaining, "SELECT "+table+"_id FROM user_"+table+"_shortcut WHERE user_id=? ORDER BY sort_order,"+table+"_id", uid); err != nil {
				return err
			}
			for i, id := range remaining {
				if _, err := t.tx.ExecContext(t.ctx, "UPDATE user_"+table+"_shortcut SET sort_order=? WHERE user_id=? AND "+table+"_id=?", i+1, uid, id); err != nil {
					return err
				}
			}
			if _, err := t.tx.ExecContext(t.ctx, "UPDATE user_sidebar_preference SET "+table+"_version="+table+"_version+1,updated_at=? WHERE user_id=?", now, uid); err != nil {
				return err
			}
		}
	}
	return nil
}
func (t *identityTx) UserOptions(q string) ([]c.UserOption, error) {
	out := []c.UserOption{}
	search := collabSearch(q)
	err := t.tx.SelectContext(t.ctx, &out, "SELECT id,username,display_name FROM `user` WHERE status='active' AND deleted_at IS NULL AND (username LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!') ORDER BY username LIMIT 50", search, search)
	return out, err
}

// Keep schema-specific errors from escaping the adapter boundary.
func collaborationDuplicate(message string) error {
	if strings.Contains(message, "uq_project_code") || strings.Contains(message, "uq_team_code") {
		return httpx.E(409, "CODE_CONFLICT", "编码已被使用")
	}
	if strings.Contains(message, "uq_project_name") || strings.Contains(message, "uq_team_name") {
		return httpx.E(409, "NAME_CONFLICT", "名称已被使用")
	}
	return httpx.E(409, "USERNAME_TAKEN", "用户名已被使用")
}
