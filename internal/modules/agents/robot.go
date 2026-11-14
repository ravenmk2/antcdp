package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *Service) agentAccess(ctx context.Context, raw string, id uint64, fn func(identity.Tx, Repository, *identity.Auth, *Result) error) (*Result, error) {
	return s.accessWithAgent(ctx, raw, true, id, fn)
}

// Discover the immutable robot binding before locking accounts in ID order.
func robotAccountLocks(tx identity.Tx, agentID uint64) ([]uint64, error) {
	if agentID == 0 {
		return nil, nil
	}
	r, err := RepositoryFor(tx)
	if err != nil {
		return nil, err
	}
	agent, err := r.Definition(agentID, false)
	if err != nil || agent == nil || agent.RobotUserID == nil {
		return nil, err
	}
	return []uint64{*agent.RobotUserID}, nil
}

func syncRobot(tx identity.Tx, agent *Definition) error {
	if agent.Mode != "service" {
		return nil
	}
	if agent.RobotUserID == nil {
		return integrity()
	}
	users, err := tx.LockUsers([]uint64{*agent.RobotUserID})
	if err != nil {
		return err
	}
	u := users[*agent.RobotUserID]
	if u == nil || u.AccountType != "robot" || u.Role != "user" {
		return integrity()
	}
	status := "disabled"
	if agent.Enabled && agent.DeletedAt == nil {
		status = "active"
	}
	if u.Status != status || u.DeletedAt != agent.DeletedAt {
		u.AuthVersion++
	}
	u.DisplayName, u.Status, u.DeletedAt = agent.Name, status, agent.DeletedAt
	u.Version++
	u.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	return tx.SaveUser(u)
}
