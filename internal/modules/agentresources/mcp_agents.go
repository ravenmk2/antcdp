package agentresources

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *Service) MCPAgents(ctx context.Context, raw string, id uint64, q Query) (*Result, error) {
	if err := validateQuery(&q); err != nil {
		return nil, err
	}
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		repo, err := mcpRepository(tx)
		if err != nil {
			return err
		}
		server, err := repo.MCPServer(id, false)
		if err != nil {
			return err
		}
		if server == nil {
			return missing()
		}
		rows, total, err := repo.MCPAgents(id, q)
		if err != nil {
			return err
		}
		out.Data = rows
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
