package agents

import (
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) definitionResult(_ Repository, out *Result, v *Definition) error {
	out.Data = v
	out.Tag = s.tag("definition", v.ID, v.RowVersion)
	return nil
}

func (v *SessionRow) personalOwnerID() *uint64 {
	if v.ExecutionMode == "chat" {
		return &v.ExecutorUserID
	}
	return nil
}

// Agent ownership controls entry; resources are authorized against the execution account.
func canUseSessionAgent(r Repository, v *Definition, user *identity.User) (bool, error) {
	if user == nil {
		return false, integrity()
	}
	if v.Mode == "service" && v.RobotUserID != nil && user.ID == *v.RobotUserID {
		return user.AccountType == "robot", nil
	}
	return r.CanUseAgent(v.ID, user.ID, user.Role == "admin")
}

func requireSessionAgent(r Repository, agent *Definition, user *identity.User) error {
	allowed, err := canUseSessionAgent(r, agent, user)
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.E(409, "AGENT_ACCESS_REVOKED", "当前已无此助手的使用权限")
	}
	return nil
}
