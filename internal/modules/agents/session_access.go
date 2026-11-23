package agents

import (
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) definitionResult(r Repository, out *Result, v *Definition) error {
	grants, err := r.UseGrants(v.ID)
	if err != nil {
		return err
	}
	v.UseGrants = grants
	out.Data = v
	out.Tag = s.tag("definition", v.ID, v.RowVersion)
	return nil
}

func (v *SessionRow) personalOwnerID() *uint64 {
	if v.ExecutionMode == "chat" {
		return v.ChatUserID
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

func serviceAutomationOnly() error {
	return httpx.E(403, "SERVICE_AUTOMATION_ONLY", "服务型助手仅允许作业或事件订阅发起运行")
}

func sessionCallerAllowed(tx identity.Tx, r Repository, v *SessionRow, agent *Definition, executor *identity.User) (bool, error) {
	caller := executor
	if v.ChatUserID != nil && executor.ID != *v.ChatUserID {
		users, err := tx.LockUsers([]uint64{*v.ChatUserID})
		if err != nil {
			return false, err
		}
		caller = users[*v.ChatUserID]
	}
	if caller == nil || caller.Status != "active" || caller.DeletedAt != nil {
		return false, nil
	}
	return canUseSessionAgent(r, agent, caller)
}
