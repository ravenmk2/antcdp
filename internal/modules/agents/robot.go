package agents

import (
	"context"

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
