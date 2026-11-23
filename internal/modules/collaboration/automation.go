package collaboration

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// AutomationProject authorizes a trusted internal command as its configured account.
// The caller must lock all participating users before acquiring resource locks.
func AutomationProject(tx identity.Tx, projectID, actorID uint64) (*Resource, error) {
	users, err := tx.LockUsers([]uint64{actorID})
	if err != nil {
		return nil, err
	}
	u := users[actorID]
	if u == nil || (u.AccountType != "human" && u.AccountType != "robot") || u.Status != "active" || u.DeletedAt != nil {
		return nil, httpx.E(409, "EXECUTOR_UNAVAILABLE", "运行账号不可用")
	}
	r, ok := tx.(Repository)
	if !ok {
		return nil, httpx.E(503, "FEATURE_UNAVAILABLE", "项目服务暂不可用")
	}
	if err = r.LockCollaboration(Project, projectID, 0); err != nil {
		return nil, err
	}
	p, err := r.Resource(Project, projectID, actorID)
	if err != nil {
		return nil, err
	}
	if p == nil || !p.IsMember {
		return nil, httpx.E(403, "FORBIDDEN", "运行账号不是项目成员")
	}
	if p.EndedAt != nil {
		return nil, httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
	}
	p.Decorate(Project, u.Role == "admin")
	return p, nil
}

func (s *Service) RunAccountOptions(ctx context.Context, raw string, project uint64) ([]RunAccountOption, *identity.Auth, error) {
	var options []RunAccountOption
	a, err := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		p, err := r.Resource(Project, project, a.User.ID)
		if err != nil {
			return err
		}
		if p == nil || !p.IsMember {
			return httpx.E(404, "NOT_FOUND", "项目不存在或不可见")
		}
		if err = access(p, a, true); err != nil {
			return err
		}
		options, err = r.RunAccountOptions(project)
		return err
	})
	return options, a, err
}
