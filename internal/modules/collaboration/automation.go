package collaboration

import (
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// AutomationProject authorizes a trusted internal command as its real robot.
// The caller must lock all participating users before acquiring resource locks.
func AutomationProject(tx identity.Tx, projectID, actorID uint64) (*Resource, error) {
	users, err := tx.LockUsers([]uint64{actorID})
	if err != nil {
		return nil, err
	}
	u := users[actorID]
	if u == nil || u.AccountType != "robot" || u.Status != "active" || u.DeletedAt != nil {
		return nil, httpx.E(409, "EXECUTOR_UNAVAILABLE", "执行机器人不可用")
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
		return nil, httpx.E(403, "FORBIDDEN", "机器人不是项目成员")
	}
	if p.EndedAt != nil {
		return nil, httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
	}
	return p, nil
}
