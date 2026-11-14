package mysql

import (
	"fmt"
	"slices"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const projectMembership = `(EXISTS (SELECT 1 FROM project_member pm WHERE pm.project_id=o.id AND pm.user_id=?) OR EXISTS (SELECT 1 FROM project_team pt JOIN team tm ON tm.id=pt.team_id AND tm.dissolved_at IS NULL JOIN team_member mm ON mm.team_id=tm.id WHERE pt.project_id=o.id AND mm.user_id=?))`

// User deletion keeps the account tombstone but removes its collaboration state
// in the same transaction. The identity command already holds the user lock.
func (t *identityTx) removeCollaborationUser(uid uint64, now time.Time) error {
	for _, entity := range []string{"team", "project"} {
		var ids []uint64
		if err := t.tx.SelectContext(t.ctx, &ids, "SELECT "+entity+"_id FROM "+entity+"_member WHERE user_id=? ORDER BY "+entity+"_id", uid); err != nil {
			return err
		}
		for _, id := range ids {
			var locked uint64
			if err := t.tx.GetContext(t.ctx, &locked, "SELECT id FROM "+entity+" WHERE id=? FOR UPDATE", id); err != nil {
				return err
			}
			if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM "+entity+"_member WHERE "+entity+"_id=? AND user_id=?", id, uid); err != nil {
				return err
			}
			if _, err := t.tx.ExecContext(t.ctx, "UPDATE "+entity+" SET membership_version=membership_version+1 WHERE id=?", id); err != nil {
				return err
			}
		}
	}
	var preference []uint64
	if err := t.tx.SelectContext(t.ctx, &preference, "SELECT user_id FROM user_sidebar_preference WHERE user_id=? FOR UPDATE", uid); err != nil {
		return err
	}
	for _, table := range []string{"user_project_shortcut", "user_team_shortcut", "user_sidebar_preference"} {
		if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM "+table+" WHERE user_id=?", uid); err != nil {
			return err
		}
	}
	return nil
}

func (t *identityTx) sidebarGroup(uid uint64, kind string, version uint64) (identity.ShortcutGroup, error) {
	out := identity.ShortcutGroup{Items: []identity.Shortcut{}, Version: version, ETag: identity.SidebarTag(kind, uid, version)}
	var q string
	args := []any{uid, uid}
	if kind == "projects" {
		q = "SELECT o.id,o.code,o.name,o.icon_key,o.icon_file_id,IF(o.archived_at IS NULL,'active','archived') AS status,s.sort_order FROM user_project_shortcut s JOIN project o ON o.id=s.project_id WHERE s.user_id=? AND " + projectMembership + " ORDER BY s.sort_order,o.id"
		args = append(args, uid)
	} else {
		q = "SELECT o.id,o.code,o.name,o.icon_key,o.icon_file_id,'active' AS status,s.sort_order FROM user_team_shortcut s JOIN team o ON o.id=s.team_id WHERE s.user_id=? AND o.dissolved_at IS NULL AND EXISTS (SELECT 1 FROM team_member m WHERE m.team_id=o.id AND m.user_id=?) ORDER BY s.sort_order,o.id"
	}
	err := t.tx.SelectContext(t.ctx, &out.Items, q, args...)
	return out, err
}
func (t *identityTx) Sidebar(uid uint64) (identity.Sidebar, error) {
	var v struct {
		Project uint64 `db:"project_version"`
		Team    uint64 `db:"team_version"`
	}
	var out identity.Sidebar
	if err := t.tx.GetContext(t.ctx, &v, "SELECT project_version,team_version FROM user_sidebar_preference WHERE user_id=?", uid); err != nil {
		return out, err
	}
	var err error
	out.Projects, err = t.sidebarGroup(uid, "projects", v.Project)
	if err != nil {
		return out, err
	}
	out.Teams, err = t.sidebarGroup(uid, "teams", v.Team)
	return out, err
}
func (t *identityTx) ReplaceShortcuts(uid uint64, kind string, ids []uint64, tag string, now time.Time) (identity.ShortcutGroup, error) {
	var empty identity.ShortcutGroup
	entity := "project"
	if kind == "teams" {
		entity = "team"
	} else if kind != "projects" {
		return empty, httpx.Invalid("group", "invalid_value")
	}
	// Lock all involved teams before projects, then the preference row. The
	// caller already holds this user's lock, shared with membership mutations.
	teams := append([]uint64{}, ids...)
	if kind == "projects" {
		teams = []uint64{}
		for _, id := range ids {
			var found []uint64
			if err := t.tx.SelectContext(t.ctx, &found, "SELECT team_id FROM project_team WHERE project_id=? ORDER BY team_id", id); err != nil {
				return empty, err
			}
			teams = append(teams, found...)
		}
	}
	slices.Sort(teams)
	teams = slices.Compact(teams)
	for _, id := range teams {
		var rows []uint64
		if err := t.tx.SelectContext(t.ctx, &rows, "SELECT id FROM team WHERE id=? FOR UPDATE", id); err != nil {
			return empty, err
		}
	}
	if kind == "projects" {
		ordered := append([]uint64{}, ids...)
		slices.Sort(ordered)
		for _, id := range ordered {
			var rows []uint64
			if err := t.tx.SelectContext(t.ctx, &rows, "SELECT id FROM project WHERE id=? FOR UPDATE", id); err != nil {
				return empty, err
			}
		}
	}
	var version uint64
	if err := t.tx.GetContext(t.ctx, &version, "SELECT "+entity+"_version FROM user_sidebar_preference WHERE user_id=? FOR UPDATE", uid); err != nil {
		return empty, err
	}
	if tag != identity.SidebarTag(kind, uid, version) {
		return empty, httpx.E(412, "VERSION_CONFLICT", "快捷方式已在其他页面更新，请重新加载")
	}
	for i, id := range ids {
		var count int
		var q string
		args := []any{id, uid}
		if kind == "projects" {
			q = "SELECT COUNT(*) FROM project o WHERE o.id=? AND " + projectMembership
			args = append(args, uid)
		} else {
			q = "SELECT COUNT(*) FROM team o WHERE o.id=? AND o.dissolved_at IS NULL AND EXISTS (SELECT 1 FROM team_member m WHERE m.team_id=o.id AND m.user_id=?)"
		}
		if err := t.tx.GetContext(t.ctx, &count, q, args...); err != nil {
			return empty, err
		}
		if count != 1 {
			return empty, httpx.Invalid(fmt.Sprintf("ids.%d", i), "shortcut_target_unavailable")
		}
	}
	table := "user_" + entity + "_shortcut"
	var old []uint64
	if err := t.tx.SelectContext(t.ctx, &old, "SELECT "+entity+"_id FROM "+table+" WHERE user_id=? ORDER BY sort_order,"+entity+"_id", uid); err != nil {
		return empty, err
	}
	if slices.Equal(old, ids) {
		return t.sidebarGroup(uid, kind, version)
	}
	for _, id := range old {
		if !slices.Contains(ids, id) {
			if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM "+table+" WHERE user_id=? AND "+entity+"_id=?", uid, id); err != nil {
				return empty, err
			}
		}
	}
	for i, id := range ids {
		if slices.Contains(old, id) {
			if _, err := t.tx.ExecContext(t.ctx, "UPDATE "+table+" SET sort_order=? WHERE user_id=? AND "+entity+"_id=?", i+1, uid, id); err != nil {
				return empty, err
			}
		} else {
			if _, err := t.tx.ExecContext(t.ctx, "INSERT INTO "+table+" (user_id,"+entity+"_id,sort_order,created_at) VALUES (?,?,?,?)", uid, id, i+1, now); err != nil {
				return empty, err
			}
		}
	}
	if _, err := t.tx.ExecContext(t.ctx, "UPDATE user_sidebar_preference SET "+entity+"_version="+entity+"_version+1,updated_at=? WHERE user_id=?", now, uid); err != nil {
		return empty, err
	}
	return t.sidebarGroup(uid, kind, version+1)
}
