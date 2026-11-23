package remotehosts

import (
	"context"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/credentials"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *Service) Choices(ctx context.Context, raw string, id, cid uint64, owner CredentialOwnership, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	a, err := s.access(ctx, raw, owner, id, op == "preferred" || op == "clear_preferred", func(tx identity.Tx, r Repository, actor *identity.Auth, v *Host, scope CredentialOwnership) error {
		if op == "list" {
			items, e := credentials.Candidates(r, scope, v.Type)
			if e != nil {
				return e
			}
			out = Result{Data: map[string]any{"items": items}}
			return nil
		}
		entry, p, e := credentials.Selected(r, "remote_host", id, scope, v.Type)
		if e != nil {
			return e
		}
		var current *uint64
		if p != nil {
			current = &p.CredentialID
		}
		version := s.preferredTag(v, scope)
		switch op {
		case "get_preferred":
			out = selection(current, version)
			return nil
		case "diagnostics":
			if entry == nil || entry.ID != cid {
				return fail()
			}
			raw, e := r.Diagnostics("credential", p.ID)
			if e != nil {
				return e
			}
			d, e := diagnosticView(raw, v.Version, v.ConfigVersion, entry.Version, entry.MaterialVersion, 0)
			out.Data = map[string]any{"latest": d}
			return e
		case "preferred", "clear_preferred":
			if e := check(tag, version); e != nil {
				return e
			}
			var next *uint64
			if op == "preferred" {
				value, e := c.ID(input.(SelectionWrite).CredentialID)
				if e != nil {
					return e
				}
				next = &value
			}
			changed, e := credentials.Choose(r, "remote_host", id, scope, v.Type, current, next)
			if e != nil {
				return e
			}
			if changed {
				v.CredentialsVersion++
				if e := r.SaveConnection(v); e != nil {
					return e
				}
				if e := audit(tx, actor, "remote_host", id, v.Name, "preferred_changed", map[string]any{"scope_kind": scope.Type, "scope_id": scope.Owner, "credential_id": next}, meta); e != nil {
					return e
				}
			}
			out = selection(next, s.preferredTag(v, scope))
			return nil
		}
		return fail()
	})
	return out, a, err
}
