package collaboration

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RoleSummary struct {
	ID   uint64 `db:"id" json:"id,string"`
	Name string `db:"name" json:"name"`
}

type Role struct {
	RoleSummary
	ScopeKind   Kind      `db:"scope_kind" json:"scope_kind"`
	ScopeID     uint64    `db:"scope_id" json:"scope_id,string"`
	Description string    `db:"description" json:"description"`
	Version     uint64    `db:"row_version" json:"version,string"`
	Creator     uint64    `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at" json:"updated_at"`
	MemberCount int       `db:"member_count" json:"member_count"`
	ETag        string    `db:"-" json:"etag"`
}

type RoleDetail struct {
	Role
	Members []UserOption `json:"members"`
}

type RoleWrite struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type RoleRepository interface {
	Roles(Kind, uint64) ([]Role, error)
	Role(Kind, uint64, uint64) (*Role, error)
	InsertRole(*Role) error
	SaveRole(*Role) error
	DeleteRole(uint64) error
	RoleMembers(uint64) ([]UserOption, error)
	AddRoleBinding(role, user, actor uint64, now time.Time) error
	RemoveRoleBinding(role, user uint64) error
	MemberRoles(Kind, uint64, []uint64) (map[uint64][]RoleSummary, error)
}

var roleTagPattern = regexp.MustCompile(`^"role-[1-9][0-9]*-v[1-9][0-9]*"$`)

func (r *Role) decorate() {
	r.ETag = fmt.Sprintf(`"role-%d-v%d"`, r.ID, r.Version)
}

func (w *RoleWrite) validate() error {
	w.Name, w.Description = strings.TrimSpace(w.Name), strings.TrimSpace(w.Description)
	if w.Name == "" {
		return httpx.Invalid("name", "required")
	}
	if !utf8.ValidString(w.Name) || utf8.RuneCountInString(w.Name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if !utf8.ValidString(w.Description) || utf8.RuneCountInString(w.Description) > 300 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}

func loadProjectRole(r Repository, projectID, roleID uint64) (*Role, error) {
	role, err := r.Role(Project, projectID, roleID)
	if err != nil {
		return nil, err
	}
	if role == nil {
		return nil, httpx.E(404, "ROLE_NOT_FOUND", "项目角色不存在")
	}
	role.decorate()
	return role, nil
}

func (s *Service) ProjectRoles(ctx context.Context, raw string, projectID uint64) ([]Role, *identity.Auth, error) {
	var roles []Role
	a, err := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		project, err := r.Resource(Project, projectID, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(project, a, false); err != nil {
			return err
		}
		roles, err = r.Roles(Project, projectID)
		for i := range roles {
			roles[i].decorate()
		}
		return err
	})
	return roles, a, err
}

func (s *Service) ProjectRole(ctx context.Context, raw string, projectID, roleID uint64) (RoleDetail, *identity.Auth, error) {
	var detail RoleDetail
	a, err := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		project, err := r.Resource(Project, projectID, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(project, a, false); err != nil {
			return err
		}
		role, err := loadProjectRole(r, projectID, roleID)
		if err != nil {
			return err
		}
		detail.Role = *role
		detail.Members, err = r.RoleMembers(role.ID)
		return err
	})
	return detail, a, err
}

func (s *Service) ProjectRoleMemberOptions(ctx context.Context, raw string, projectID uint64, search string) ([]UserOption, *identity.Auth, error) {
	if utf8.RuneCountInString(search) > 100 {
		return nil, nil, httpx.Invalid("q", "invalid_length")
	}
	q := strings.ToLower(strings.TrimSpace(search))
	out := []UserOption{}
	a, err := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		project, err := r.Resource(Project, projectID, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(project, a, true); err != nil {
			return err
		}
		members, err := r.Members(Project, projectID)
		if err != nil {
			return err
		}
		for _, member := range members {
			if member.Status == "active" && matchesMember(member, q) {
				out = append(out, UserOption{ID: member.ID, Username: member.Username, Name: member.Name, AvatarID: member.AvatarID})
			}
		}
		return nil
	})
	return out, a, err
}

func (s *Service) writeProjectRole(ctx context.Context, raw string, projectID, roleID uint64, tag string, users []uint64, fn func(identity.Tx, Repository, *identity.Auth, *Resource, *Role) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, func(identity.Tx) ([]uint64, error) {
		return users, nil
	}, func(tx identity.Tx, a *identity.Auth) error {
		r, err := repo(tx)
		if err != nil {
			return err
		}
		if err = r.LockCollaboration(Project, projectID, 0); err != nil {
			return err
		}
		project, err := r.Resource(Project, projectID, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(project, a, true); err != nil {
			return err
		}
		var role *Role
		if roleID != 0 {
			role, err = loadProjectRole(r, projectID, roleID)
			if err != nil {
				return err
			}
			if err = checkPrecondition(tag, role.ETag, roleTagPattern); err != nil {
				return err
			}
		}
		return fn(tx, r, a, project, role)
	})
}

func (s *Service) SaveProjectRole(ctx context.Context, raw string, projectID, roleID uint64, tag string, w RoleWrite, meta identity.Metadata) (Role, *identity.Auth, error) {
	var out Role
	if err := w.validate(); err != nil {
		return out, nil, err
	}
	a, err := s.writeProjectRole(ctx, raw, projectID, roleID, tag, nil, func(tx identity.Tx, r Repository, a *identity.Auth, project *Resource, role *Role) error {
		now := time.Now().UTC()
		action := "role_created"
		if role == nil {
			out = Role{RoleSummary: RoleSummary{Name: w.Name}, ScopeKind: Project, ScopeID: projectID, Description: w.Description, Version: 1, Creator: a.User.ID, CreatedAt: now, UpdatedAt: now}
			if err := r.InsertRole(&out); err != nil {
				return err
			}
		} else {
			out = *role
			if out.Name == w.Name && out.Description == w.Description {
				return nil
			}
			out.Name, out.Description = w.Name, w.Description
			out.Version++
			out.UpdatedAt = now
			if err := r.SaveRole(&out); err != nil {
				return err
			}
			action = "role_updated"
		}
		out.decorate()
		return audit(tx, a, meta, Project, project, action, roleAudit(&out))
	})
	return out, a, err
}

func (s *Service) DeleteProjectRole(ctx context.Context, raw string, projectID, roleID uint64, tag string, meta identity.Metadata) (*identity.Auth, error) {
	return s.writeProjectRole(ctx, raw, projectID, roleID, tag, nil, func(tx identity.Tx, r Repository, a *identity.Auth, project *Resource, role *Role) error {
		if err := r.DeleteRole(role.ID); err != nil {
			return err
		}
		detail := roleAudit(role)
		detail["member_count"] = role.MemberCount
		return audit(tx, a, meta, Project, project, "role_deleted", detail)
	})
}

func roleAudit(role *Role) map[string]any {
	return map[string]any{"role_id": strconv.FormatUint(role.ID, 10), "role_name": role.Name}
}

func (s *Service) SetProjectRoleMembers(ctx context.Context, raw string, projectID, roleID uint64, tag string, userIDs []string, meta identity.Metadata) (*identity.Auth, error) {
	if userIDs == nil {
		return nil, httpx.Invalid("user_ids", "required")
	}
	ids := make([]uint64, 0, len(userIDs))
	requested := make(map[uint64]bool, len(userIDs))
	for _, id := range userIDs {
		uid, err := ID(id)
		if err != nil || requested[uid] {
			return nil, httpx.Invalid("user_ids", "invalid_value")
		}
		requested[uid] = true
		ids = append(ids, uid)
	}
	return s.writeProjectRole(ctx, raw, projectID, roleID, tag, ids, func(tx identity.Tx, r Repository, a *identity.Auth, project *Resource, role *Role) error {
		current, err := r.RoleMembers(role.ID)
		if err != nil {
			return err
		}
		currentIDs := make(map[uint64]bool, len(current))
		var removed []uint64
		for _, member := range current {
			currentIDs[member.ID] = true
			if !requested[member.ID] {
				removed = append(removed, member.ID)
			}
		}
		added := slices.DeleteFunc(slices.Clone(ids), func(id uint64) bool { return currentIDs[id] })
		if len(removed)+len(added) == 0 {
			return nil
		}
		if len(added) > 0 {
			if err := checkRoleCandidates(r, project.ID, added); err != nil {
				return err
			}
		}
		now := time.Now().UTC()
		for _, id := range removed {
			if err := r.RemoveRoleBinding(role.ID, id); err != nil {
				return err
			}
		}
		for _, id := range added {
			if err := r.AddRoleBinding(role.ID, id, a.User.ID, now); err != nil {
				return err
			}
		}
		role.Version++
		role.UpdatedAt = now
		if err := r.SaveRole(role); err != nil {
			return err
		}
		detail := roleAudit(role)
		detail["added_user_ids"], detail["removed_user_ids"] = stringIDs(added), stringIDs(removed)
		return audit(tx, a, meta, Project, project, "role_members_changed", detail)
	})
}

func checkRoleCandidates(r Repository, projectID uint64, ids []uint64) error {
	members, err := r.Members(Project, projectID)
	if err != nil {
		return err
	}
	active := make(map[uint64]bool, len(members))
	for _, member := range members {
		active[member.ID] = member.Status == "active"
	}
	for _, id := range ids {
		if !active[id] {
			return httpx.E(422, "ROLE_MEMBER_UNAVAILABLE", "选择的用户必须是当前项目的有效成员")
		}
	}
	return nil
}

func stringIDs(ids []uint64) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, strconv.FormatUint(id, 10))
	}
	return out
}
