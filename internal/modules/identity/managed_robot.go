package identity

import "github.com/ravenmk2/antcdp/internal/platform/httpx"

// RobotAccountID resolves the immutable Agent binding. It is used before the
// shared identity transaction acquires account locks, and conveys no authority.
func RobotAccountID(tx Tx, agentID uint64, lock bool) (uint64, error) {
	r, ok := tx.(interface {
		ManagedRobotUserID(uint64, bool) (uint64, error)
	})
	if !ok {
		return 0, httpx.E(503, "SERVICE_UNAVAILABLE", "机器人账号服务暂不可用")
	}
	id, err := r.ManagedRobotUserID(agentID, lock)
	if err != nil {
		return 0, err
	}
	if id == 0 {
		return 0, httpx.E(404, "NOT_FOUND", "服务型智能体不存在")
	}
	return id, nil
}

// AuthorizeRobotManagement preserves the real administrator as audit actor.
// Disabled robots may be configured before their Agent is enabled.
func AuthorizeRobotManagement(tx Tx, actor *Auth, agentID uint64) (*User, error) {
	if actor.User.Role != "admin" {
		return nil, httpx.E(403, "FORBIDDEN", "需要系统管理员权限")
	}
	id, err := RobotAccountID(tx, agentID, true)
	if err != nil {
		return nil, err
	}
	users, err := tx.LockUsers([]uint64{id})
	if err != nil {
		return nil, err
	}
	u := users[id]
	if u == nil || u.AccountType != "robot" || u.DeletedAt != nil || u.ManagedAgentID == nil || *u.ManagedAgentID != agentID {
		return nil, httpx.E(409, "ROBOT_BINDING_CHANGED", "机器人账号绑定已变化")
	}
	return u, nil
}
