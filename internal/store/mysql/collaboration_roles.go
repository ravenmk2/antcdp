package mysql

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
)

const roleSelect = "SELECT r.id,r.scope_kind,r.scope_id,r.name,r.description,r.row_version,r.created_by_user_id,r.created_at,r.updated_at," +
	"(SELECT COUNT(*) FROM `role_binding` b JOIN `user` u ON u.id=b.user_id AND u.deleted_at IS NULL WHERE b.role_id=r.id) AS member_count" +
	" FROM `role` r WHERE r.scope_kind=? AND r.scope_id=?"

func (t *identityTx) Roles(kind c.Kind, scopeID uint64) ([]c.Role, error) {
	roles := []c.Role{}
	err := t.tx.SelectContext(t.ctx, &roles, roleSelect+" ORDER BY r.name,r.id", kind, scopeID)
	return roles, err
}

func (t *identityTx) Role(kind c.Kind, scopeID, roleID uint64) (*c.Role, error) {
	var role c.Role
	err := t.tx.GetContext(t.ctx, &role, roleSelect+" AND r.id=? FOR SHARE", kind, scopeID, roleID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &role, err
}

func (t *identityTx) InsertRole(role *c.Role) error {
	result, err := t.tx.ExecContext(t.ctx, "INSERT INTO `role` (scope_kind,scope_id,name,description,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
		role.ScopeKind, role.ScopeID, role.Name, role.Description, role.Creator, role.CreatedAt, role.UpdatedAt)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	role.ID = uint64(id)
	return err
}

func (t *identityTx) SaveRole(role *c.Role) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE `role` SET name=?,description=?,row_version=?,updated_at=? WHERE id=?",
		role.Name, role.Description, role.Version, role.UpdatedAt, role.ID)
	return err
}

func (t *identityTx) DeleteRole(roleID uint64) error {
	if _, err := t.tx.ExecContext(t.ctx, "DELETE FROM `role_binding` WHERE role_id=?", roleID); err != nil {
		return err
	}
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM `role` WHERE id=?", roleID)
	return err
}

func (t *identityTx) RoleMembers(roleID uint64) ([]c.UserOption, error) {
	members := []c.UserOption{}
	err := t.tx.SelectContext(t.ctx, &members, "SELECT u.id,u.username,u.display_name,u.avatar_file_id FROM `role_binding` b JOIN `user` u ON u.id=b.user_id AND u.deleted_at IS NULL WHERE b.role_id=? ORDER BY u.username,u.id", roleID)
	return members, err
}

func (t *identityTx) AddRoleBinding(role, user, actor uint64, now time.Time) error {
	_, err := t.tx.ExecContext(t.ctx, "INSERT INTO `role_binding` (role_id,user_id,assigned_by_user_id,created_at) VALUES (?,?,?,?)", role, user, actor, now)
	return err
}

func (t *identityTx) RemoveRoleBinding(role, user uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM `role_binding` WHERE role_id=? AND user_id=?", role, user)
	return err
}

func (t *identityTx) MemberRoles(kind c.Kind, scopeID uint64, users []uint64) (map[uint64][]c.RoleSummary, error) {
	query, args, err := sqlx.In("SELECT b.user_id,r.id,r.name FROM `role` r JOIN `role_binding` b ON b.role_id=r.id WHERE r.scope_kind=? AND r.scope_id=? AND b.user_id IN (?) ORDER BY r.name,r.id", kind, scopeID, users)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		UserID uint64 `db:"user_id"`
		c.RoleSummary
	}
	if err := t.tx.SelectContext(t.ctx, &rows, query, args...); err != nil {
		return nil, err
	}
	roles := make(map[uint64][]c.RoleSummary)
	for _, row := range rows {
		roles[row.UserID] = append(roles[row.UserID], row.RoleSummary)
	}
	return roles, nil
}

// A role survives the loss of one membership source while another still grants membership.
func (t *identityTx) pruneProjectRoleBindings(projectID, userID uint64, now time.Time) error {
	predicate := strings.ReplaceAll(projectMembership, "?", "b.user_id")
	query := "SELECT b.role_id,b.user_id FROM `role_binding` b JOIN `role` r ON r.id=b.role_id JOIN `project` o ON o.id=r.scope_id WHERE r.scope_kind='project' AND o.id=? AND NOT " + predicate
	args := []any{projectID}
	if userID != 0 {
		query += " AND b.user_id=?"
		args = append(args, userID)
	}
	var bindings []struct {
		RoleID uint64 `db:"role_id"`
		UserID uint64 `db:"user_id"`
	}
	if err := t.tx.SelectContext(t.ctx, &bindings, query+" ORDER BY b.role_id,b.user_id", args...); err != nil {
		return err
	}
	var updated uint64
	for _, binding := range bindings {
		if updated != binding.RoleID {
			if _, err := t.tx.ExecContext(t.ctx, "UPDATE `role` SET row_version=row_version+1,updated_at=? WHERE id=?", now, binding.RoleID); err != nil {
				return err
			}
			updated = binding.RoleID
		}
		if err := t.RemoveRoleBinding(binding.RoleID, binding.UserID); err != nil {
			return err
		}
	}
	return nil
}
