package agentresources

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// ResourceOperation reads one common operation identity, then applies the kind's
// content authorization and explicit result projection. It never guesses IDs in
// separate feature tables.
func (s *Service) ResourceOperation(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(id, false)
		if e != nil {
			return e
		}
		if op == nil || op.ContentDomain != "management" {
			return missing()
		}
		switch op.Kind {
		case "skill_validate":
			if !visibleSkillUpload(op, a) {
				return missing()
			}
			view, e := skillUploadView(op)
			if e != nil {
				return e
			}
			if op.Status == "queued" || op.Status == "running" {
				out.Data = skillOperationData(op, nil)
			} else {
				out.Data = skillOperationData(op, &view)
			}
			return nil
		default:
			return missing()
		}
	})
}
