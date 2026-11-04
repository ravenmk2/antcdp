package projectdelivery

import (
	"context"
	"slices"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// ProjectRelease is a bounded, project-scoped read model. Writes still use the
// original variant release endpoints and their permission/version checks.
type ProjectRelease struct {
	ID             uint64    `db:"id" json:"id,string"`
	VariantID      uint64    `db:"variant_id" json:"variant_id,string"`
	VariantName    string    `db:"variant_name" json:"variant_name"`
	VariantCode    string    `db:"variant_code" json:"variant_code"`
	Name           string    `db:"name" json:"name"`
	VersionLabel   string    `db:"version_label" json:"version_label"`
	TagName        string    `db:"tag_name" json:"tag_name"`
	Status         string    `db:"status" json:"status"`
	Updated        time.Time `db:"updated_at" json:"updated_at"`
	NeedsAttention bool      `db:"needs_attention" json:"needs_attention"`
}

type WorkspaceStore interface {
	ProjectReleases(uint64, Query) ([]ProjectRelease, int, error)
}

type Workspace struct {
	RepositoryCount int                  `json:"repository_count"`
	Variants        Page[Variant]        `json:"variants"`
	Releases        Page[ProjectRelease] `json:"releases"`
	Attention       Page[ProjectRelease] `json:"attention"`
}

func projectReleasePage(store WorkspaceStore, pid uint64, q Query, manage bool) (Page[ProjectRelease], error) {
	rows, total, err := store.ProjectReleases(pid, q)
	return Page[ProjectRelease]{Items: rows, Total: total, Page: q.Page, Size: q.Size, CanManage: manage}, err
}

func (s *Service) ProjectReleases(ctx context.Context, raw string, pid uint64, q Query) (i.Result, *identity.Auth, error) {
	var out i.Result
	if q.Status == "" {
		q.Status = "active"
	}
	if err := validateQuery(&q); err != nil {
		return out, nil, err
	}
	if !slices.Contains([]string{"all", "active", "attention", "draft", "integrating", "reviewing", "accepted", "tagging", "archived", "terminated"}, q.Status) {
		return out, nil, httpx.Invalid("status", "invalid_value")
	}
	a, err := s.access(ctx, raw, pid, false, func(x *access) error {
		store, ok := x.tx.(WorkspaceStore)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "项目工作区暂不可用")
		}
		if q.VariantID != 0 {
			if _, e := x.variant(q.VariantID, false, true); e != nil {
				return e
			}
		}
		page, e := projectReleasePage(store, pid, q, x.manage)
		out.Data = page
		return e
	})
	return out, a, err
}

func (s *Service) Workspace(ctx context.Context, raw string, pid uint64) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, err := s.access(ctx, raw, pid, false, func(x *access) error {
		store, ok := x.tx.(WorkspaceStore)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "项目工作区暂不可用")
		}
		repos, e := x.allRepos()
		if e != nil {
			return e
		}
		variants, total, e := x.r.Variants(pid, Query{Page: 1, Size: 10, Status: "active"})
		if e != nil {
			return e
		}
		for n := range variants {
			x.decorateVariant(&variants[n], repos)
		}
		work := Workspace{RepositoryCount: len(repos), Variants: Page[Variant]{Items: variants, Total: total, Page: 1, Size: 10, CanManage: x.manage}}
		work.Releases, e = projectReleasePage(store, pid, Query{Page: 1, Size: 10, Status: "active"}, x.manage)
		if e != nil {
			return e
		}
		work.Attention, e = projectReleasePage(store, pid, Query{Page: 1, Size: 10, Status: "attention"}, x.manage)
		out.Data = work
		return e
	})
	return out, a, err
}
