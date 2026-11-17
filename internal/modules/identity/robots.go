package identity

import (
	"context"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RobotCreate struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

func (s *Service) CreateRobot(ctx context.Context, raw string, w RobotCreate, meta Metadata) (*User, *Auth, error) {
	if !usernamePattern.MatchString(w.Username) {
		return nil, nil, httpx.Invalid("username", "invalid_format")
	}
	w.DisplayName = strings.TrimSpace(w.DisplayName)
	if err := validateName(w.DisplayName, "display_name", 30); err != nil {
		return nil, nil, err
	}
	var robot *User
	a, err := s.execute(ctx, raw, policy{admin: true, renew: true}, 0, func(tx Tx, a *Auth, _ *User) error {
		now := s.now()
		robot = &User{AccountType: "robot", Username: w.Username, DisplayName: w.DisplayName, Role: "user", Status: "active", CreatedAt: now, UpdatedAt: now}
		if err := tx.InsertUser(robot); err != nil {
			return err
		}
		return s.audit(tx, a.User, "robot.created", "user", strconv.FormatUint(robot.ID, 10), robot.DisplayName, meta, map[string]any{})
	})
	return robot, a, err
}

// AuthorizeRobotAccount checks account ownership independently of Agent bindings.
func AuthorizeRobotAccount(tx Tx, actor *Auth, id uint64) (*User, error) {
	if actor.User.Role != "admin" {
		return nil, httpx.E(403, "FORBIDDEN", "需要系统管理员权限")
	}
	users, err := tx.LockUsers([]uint64{id})
	if err != nil {
		return nil, err
	}
	u := users[id]
	if u == nil || u.AccountType != "robot" || u.DeletedAt != nil {
		return nil, httpx.E(404, "NOT_FOUND", "机器人账号不存在")
	}
	return u, nil
}
