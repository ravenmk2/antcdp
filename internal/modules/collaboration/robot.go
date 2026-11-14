package collaboration

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// RobotResources returns the same membership projection used for human accounts.
// The caller remains the administrator; no login or impersonation is created.
func (s *Service) RobotResources(ctx context.Context, raw string, agentID uint64, k Kind, q Query) (Page, *identity.Auth, error) {
	var out Page
	if !k.Valid() || q.Page < 1 || q.Page > 1000000 || q.Size < 1 || q.Size > 100 {
		return out, nil, httpx.Invalid("filter", "invalid_value")
	}
	q.Scope, q.Status = "all", "active"
	a, err := s.Identity.BusinessAccess(ctx, raw, func(tx identity.Tx) ([]uint64, error) {
		id, e := identity.RobotAccountID(tx, agentID, false)
		return []uint64{id}, e
	}, func(tx identity.Tx, a *identity.Auth) error {
		u, e := identity.AuthorizeRobotManagement(tx, a, agentID)
		if e != nil {
			return e
		}
		r, e := repo(tx)
		if e != nil {
			return e
		}
		out, e = r.Resources(k, u.ID, q)
		for i := range out.Items {
			out.Items[i].Decorate(k, true)
		}
		return e
	})
	return out, a, err
}

// SetRobotMember edits a direct grant through its owning service Agent. Inherited
// project membership continues to derive from the existing team relations.
func (s *Service) SetRobotMember(ctx context.Context, raw string, agentID uint64, k Kind, id uint64, role, tag string, meta identity.Metadata) (*identity.Auth, error) {
	if !k.Valid() || !slices.Contains([]string{"", "member", "admin"}, role) {
		return nil, httpx.Invalid("role", "invalid_value")
	}
	var locked []uint64
	return s.Identity.BusinessAccess(ctx, raw, func(tx identity.Tx) ([]uint64, error) {
		uid, e := identity.RobotAccountID(tx, agentID, false)
		if e != nil {
			return nil, e
		}
		r, e := repo(tx)
		if e != nil {
			return nil, e
		}
		locked, e = r.CollaborationUsers(k, id)
		locked = append(locked, uid)
		return locked, e
	}, func(tx identity.Tx, a *identity.Auth) error {
		u, e := identity.AuthorizeRobotManagement(tx, a, agentID)
		if e != nil {
			return e
		}
		r, e := repo(tx)
		if e != nil {
			return e
		}
		if e = r.LockCollaboration(k, id, 0); e != nil {
			return e
		}
		actual, e := r.CollaborationUsers(k, id)
		if e != nil {
			return e
		}
		for _, uid := range actual {
			if uid != a.User.ID && !slices.Contains(locked, uid) {
				return conflict()
			}
		}
		obj, e := r.Resource(k, id, u.ID)
		if e != nil {
			return e
		}
		if e = access(obj, a, true); e != nil {
			return e
		}
		obj.Decorate(k, true)
		if e = precondition(tag, obj.MembershipETag); e != nil {
			return e
		}
		changed, e := r.SetMember(k, id, u.ID, role, time.Now().UTC())
		if e != nil || !changed {
			return e
		}
		if e = r.BumpMembers(k, id); e != nil {
			return e
		}
		if e = r.CleanupShortcuts(locked, time.Now().UTC()); e != nil {
			return e
		}
		return audit(tx, a, meta, k, obj, "robot_grant_changed", map[string]any{"agent_id": fmt.Sprint(agentID), "user_id": fmt.Sprint(u.ID), "before": obj.Role, "after": role})
	})
}
