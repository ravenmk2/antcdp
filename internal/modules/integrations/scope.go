package integrations

import (
	"context"
	"fmt"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type scopeKey struct{}

// WithScope selects a route-authorized context, never an owner from a write body.
func WithScope(ctx context.Context, kind string, id uint64) context.Context {
	return context.WithValue(ctx, scopeKey{}, CredentialOwnership{Type: kind, Owner: id})
}

func routeScope(ctx context.Context) CredentialOwnership {
	if scope, ok := ctx.Value(scopeKey{}).(CredentialOwnership); ok {
		return scope
	}
	return CredentialOwnership{Type: "platform"}
}

func authorizeSubject(tx identity.Tx, actor *identity.Auth, subject CredentialOwnership, manage, write bool) error {
	kind := c.Kind(subject.Type)
	if !kind.Valid() || subject.Owner == 0 {
		return forbidden()
	}
	r, ok := tx.(c.Repository)
	if !ok {
		return integrity()
	}
	if err := r.LockCollaboration(kind, subject.Owner, 0); err != nil {
		return err
	}
	v, err := r.Resource(kind, subject.Owner, actor.User.ID)
	if err != nil {
		return err
	}
	if v == nil {
		return fail()
	}
	if actor.User.Role != "admin" && !v.IsMember {
		if manage {
			return forbidden()
		}
		return fail()
	}
	if manage && actor.User.Role != "admin" && v.Role != "admin" {
		return forbidden()
	}
	if write && v.EndedAt != nil {
		return httpx.E(409, "RESOURCE_READ_ONLY", "项目或团队已结束，不能修改")
	}
	return nil
}

// ConnectionAllowed evaluates only the requested scope. Team grants never
// propagate through project_team, nor does possession of a credential grant access.
// Callers lock the connection before using the result for a mutation or call.
func ConnectionAllowed(r Repository, v *ServiceConnection, scope CredentialOwnership) (bool, error) {
	if v == nil {
		return false, nil
	}
	if !v.ValidOwnership() {
		return false, integrity()
	}
	if scope.Type == "platform" {
		return v.Ownership == "platform", nil
	}
	if scope.Type != "project" && scope.Type != "team" || scope.Owner == 0 {
		return false, nil
	}
	// The repository also verifies the subject is active, including owned projects.
	return r.ConnectionGranted(v.ID, scope, true)
}

// JobConnectionAllowed confines project-owned targets to the job's project.
func JobConnectionAllowed(r Repository, v *ServiceConnection, project, account uint64) (bool, error) {
	if v.Ownership == "project" && !sameID(v.ProjectID, &project) {
		return false, nil
	}
	return userConnectionAllowed(r, v, account)
}
func userConnectionAllowed(r Repository, v *ServiceConnection, uid uint64) (bool, error) {
	scopes, err := r.ConnectionUserScopes(uid)
	if err != nil {
		return false, err
	}
	for _, scope := range scopes {
		if scope.Type == "admin" {
			return true, nil
		}
		ok, err := ConnectionAllowed(r, v, scope)
		if err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

func managedConnection(v *ServiceConnection, scope CredentialOwnership) bool {
	return v.Ownership == scope.Type && (scope.Type == "platform" && scope.Owner == 0 || scope.Type == "project" && sameID(v.ProjectID, &scope.Owner))
}

func connectionPath(scope CredentialOwnership, kind string) string {
	if scope.Type == "project" {
		return fmt.Sprintf("/projects/%d/service-connections/%s", scope.Owner, kind)
	}
	return "/admin/service-connections/" + kind
}

type GrantWrite struct {
	Enabled *bool `json:"enabled"`
}

// Grants uses a collection version even for new grants, protecting concurrent
// creation and preserving disabled relationships for explicit reauthorization.
func (s *Service) Grants(ctx context.Context, raw string, id uint64, subject CredentialOwnership, tag string, enabled *bool, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	write := enabled != nil
	if routeScope(ctx).Type != "platform" {
		return out, nil, forbidden()
	}
	a, err := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		if a.User.Role != "admin" {
			return forbidden()
		}
		if write {
			if err := authorizeSubject(tx, a, subject, false, *enabled); err != nil {
				return err
			}
		}
		r, err := repo(tx)
		if err != nil {
			return err
		}
		v, err := r.Connection(id)
		if err != nil {
			return err
		}
		if v == nil || v.Type != s.serviceType() || v.Ownership != "platform" {
			return fail()
		}
		if write {
			if err := check(tag, s.grantsTag(v)); err != nil {
				return err
			}
			rows, err := r.ConnectionGrants(id)
			if err != nil {
				return err
			}
			changed := true
			for _, row := range rows {
				if row.SubjectKind == subject.Type && row.SubjectID == subject.Owner && row.Enabled == *enabled {
					changed = false
				}
			}
			if changed {
				grant := ConnectionGrant{ConnectionID: id, SubjectKind: subject.Type, SubjectID: subject.Owner, Enabled: *enabled, Creator: a.User.ID, Updater: a.User.ID}
				if err := r.SaveConnectionGrant(&grant); err != nil {
					return err
				}
				v.GrantsVersion++
				if err := r.SaveConnection(v); err != nil {
					return err
				}
				if err := audit(tx, a, "service_connection", id, v.Name, "grant_changed", map[string]any{"subject_kind": subject.Type, "subject_id": fmt.Sprint(subject.Owner), "enabled": *enabled}, meta); err != nil {
					return err
				}
			}
		}
		rows, err := r.ConnectionGrants(id)
		out = Result{Data: map[string]any{"items": rows}, Tag: s.grantsTag(v)}
		return err
	})
	return out, a, err
}
