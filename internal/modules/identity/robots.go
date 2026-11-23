package identity

import (
	"context"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/emailaddress"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RobotCreate struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
}

func (s *Service) CreateRobot(ctx context.Context, raw string, w RobotCreate, meta Metadata) (*User, *Auth, error) {
	if !usernamePattern.MatchString(w.Username) {
		return nil, nil, httpx.Invalid("username", "invalid_format")
	}
	w.DisplayName = strings.TrimSpace(w.DisplayName)
	if err := validateName(w.DisplayName, "display_name", 30); err != nil {
		return nil, nil, err
	}
	email, ok := emailaddress.Normalize(w.Email)
	if !ok {
		return nil, nil, httpx.Invalid("email", "invalid_format")
	}
	var robot *User
	a, err := s.execute(ctx, raw, policy{admin: true, renew: true}, 0, func(tx Tx, a *Auth, _ *User) error {
		var err error
		robot, err = s.insertRobot(tx, a, w.Username, w.DisplayName, email, meta)
		return err
	})
	return robot, a, err
}

// CreateAgentRobot uses the validated assistant display name and participates in its creation transaction.
func (s *Service) CreateAgentRobot(tx Tx, a *Auth, displayName string, meta Metadata) (*User, error) {
	return s.insertRobot(tx, a, "robot_"+cryptox.ID()[:24], displayName, "", meta)
}

func (s *Service) insertRobot(tx Tx, a *Auth, username, displayName, email string, meta Metadata) (*User, error) {
	now := s.now()
	robot := &User{AccountType: "robot", Username: username, DisplayName: displayName, Role: "user", Status: "active", CreatedAt: now, UpdatedAt: now}
	if email != "" {
		robot.Email = &email
	}
	if err := tx.InsertUser(robot); err != nil {
		return nil, err
	}
	if err := s.audit(tx, a.User, "robot.created", "user", strconv.FormatUint(robot.ID, 10), robot.DisplayName, meta, map[string]any{}); err != nil {
		return nil, err
	}
	return robot, nil
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
