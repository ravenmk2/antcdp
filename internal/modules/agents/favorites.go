package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// AgentSummary exposes navigation identity without requiring start availability.
type AgentSummary struct {
	ID        uint64 `json:"id,string"`
	Name      string `json:"name"`
	Favorited bool   `json:"favorited"`
}

type FavoriteState struct {
	AgentID   uint64 `json:"agent_id,string"`
	Favorited bool   `json:"favorited"`
}

func (s *Service) GetAgentSummary(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(_ identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		v, err := r.Definition(id, false)
		if err != nil {
			return err
		}
		if v == nil || (v.Mode != "interactive" && (v.Mode != "service" || a.User.Role != "admin")) {
			return missing()
		}
		allowed, err := r.CanUseAgent(id, a.User.ID, a.User.Role == "admin")
		if err != nil {
			return err
		}
		if !allowed {
			allowed, err = r.CanReadAgentHistory(id, a.User.ID, a.User.Role == "admin")
			if err != nil {
				return err
			}
		}
		if !allowed {
			return missing()
		}
		favorites, err := r.FavoriteAgents(a.User.ID, []uint64{id})
		if err != nil {
			return err
		}
		out.Data = AgentSummary{ID: v.ID, Name: v.Name, Favorited: favorites[id]}
		return nil
	})
}

func (s *Service) ListFavorites(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if err := validateQuery(&q); err != nil {
			return err
		}
		rows, total, err := r.FavoriteDefinitions(a.User.ID, a.User.Role == "admin", q)
		if err != nil {
			return err
		}
		items := make([]CatalogAgent, 0, len(rows))
		for i := range rows {
			item, err := s.catalogAgent(tx, r, &rows[i], false)
			if err != nil {
				return err
			}
			item.Favorited = true
			items = append(items, item)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}

// SetFavorite is an idempotent personal preference; it never emits session events.
func (s *Service) SetFavorite(ctx context.Context, raw string, id uint64, favorite bool) (*Result, error) {
	return s.access(ctx, raw, false, func(_ identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if favorite {
			v, err := r.Definition(id, true)
			if err != nil {
				return err
			}
			if v == nil || v.Mode != "interactive" || v.DeletedAt != nil {
				return missing()
			}
			allowed, err := r.CanUseAgent(id, a.User.ID, a.User.Role == "admin")
			if err != nil {
				return err
			}
			if !allowed {
				return missing()
			}
		}
		if err := r.SaveFavorite(a.User.ID, id, favorite, time.Now().UTC().Truncate(time.Millisecond)); err != nil {
			return err
		}
		out.Data = FavoriteState{AgentID: id, Favorited: favorite}
		return nil
	})
}
