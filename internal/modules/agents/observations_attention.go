package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type SessionAttention struct {
	Questions int           `db:"questions" json:"question_interaction_count"`
	Approvals int           `db:"approvals" json:"approval_interaction_count"`
	Unviewed  int           `db:"unviewed" json:"unviewed_run_count"`
	Latest    *RunResultRef `json:"latest_result"`
}
type AttentionRow struct {
	SessionID       uint64     `db:"session_id"`
	AgentID         uint64     `db:"agent_id"`
	Title           string     `db:"title"`
	Questions       int        `db:"questions"`
	Approvals       int        `db:"approvals"`
	Unviewed        int        `db:"unviewed"`
	Viewed          uint64     `db:"viewed"`
	FirstResponse   *time.Time `db:"first_response_at"`
	ApprovalExpires *time.Time `db:"next_approval_expires_at"`
	Activity        time.Time  `db:"last_activity_at"`
}
type attentionRepository interface {
	AttentionFor(uint64, uint64) (SessionAttention, error)
	AttentionPage(uint64, string, ObservationQuery) ([]AttentionRow, int, error)
}

func attentionFor(tx identity.Tx) (attentionRepository, error) {
	r, e := observationsFor(tx)
	if e != nil {
		return nil, e
	}
	v, ok := r.(attentionRepository)
	if !ok {
		return nil, unavailable()
	}
	return v, nil
}
func (s *Service) WorkspaceAttentionSummary(ctx context.Context, raw string) (*Result, error) {
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		repo, e := attentionFor(tx)
		if e != nil {
			return e
		}
		q := ObservationQuery{Page: 1, PageSize: 1}
		_, response, e := repo.AttentionPage(a.User.ID, "response_required", q)
		if e != nil {
			return e
		}
		_, unviewed, e := repo.AttentionPage(a.User.ID, "result_unviewed", q)
		if e != nil {
			return e
		}
		out.Data = map[string]any{"counts": map[string]int{"response_required_sessions": response, "result_unviewed_sessions": unviewed}, "generated_at": time.Now().UTC()}
		return nil
	})
}
func (s *Service) WorkspaceAttention(ctx context.Context, raw, kind string, q ObservationQuery) (*Result, error) {
	if e := validateObservation(&q, ""); e != nil {
		return nil, e
	}
	if kind != "response_required" && kind != "result_unviewed" {
		return nil, httpx.Invalid("kind", "unsupported")
	}
	return s.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		repo, e := attentionFor(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.AttentionPage(a.User.ID, kind, q)
		if e != nil {
			return e
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			item := map[string]any{"kind": kind, "session_id": stringID(&row.SessionID), "agent_id": stringID(&row.AgentID), "title": row.Title}
			if kind == "response_required" {
				item["question_interaction_count"] = row.Questions
				item["approval_interaction_count"] = row.Approvals
				item["first_response_at"] = row.FirstResponse
				item["next_approval_expires_at"] = row.ApprovalExpires
				item["last_activity_at"] = row.Activity
			} else {
				latest, e := st.LatestResult(row.SessionID)
				if e != nil {
					return e
				}
				item["unviewed_run_count"] = row.Unviewed
				item["viewed_through_seq"] = stringID(&row.Viewed)
				item["latest_result"] = latest
			}
			items = append(items, item)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
