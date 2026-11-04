package projectdelivery

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) Reconcile(ctx context.Context, raw string, pid, id uint64, w ReconcileWrite, etag string, meta identity.Metadata) (i.Result, *identity.Auth, error) {
	var out i.Result
	var plan *Creation
	var items []CreationItem
	var snap selectionSnapshot
	a, e := s.access(ctx, raw, pid, true, func(x *access) error {
		var e error
		plan, e = x.r.Creation(pid, id)
		if e != nil {
			return e
		}
		if plan == nil {
			return notFound()
		}
		if e = match(etag, tag("branch-creation", id, plan.Version)); e != nil {
			return e
		}
		if plan.Status == "executing" || plan.Status == "prepared" {
			return changed()
		}
		if len(w.IDs) == 0 || len(w.IDs) > 100 {
			return httpx.Invalid("item_ids", "invalid_count")
		}
		rows, e := x.r.CreationItems(id)
		if e != nil {
			return e
		}
		seen := map[string]bool{}
		selection := Selection{IDs: []string{}}
		for _, id := range w.IDs {
			if seen[id] {
				return httpx.Invalid("item_ids", "duplicate")
			}
			seen[id] = true
			found := false
			for _, item := range rows {
				if fmt.Sprint(item.ID) == id && item.Status == "unknown" {
					found = true
					items = append(items, item)
					selection.IDs = append(selection.IDs, fmt.Sprint(item.RepositoryID))
				}
			}
			if !found {
				return httpx.Invalid("item_ids", "unknown_item_required")
			}
		}
		v, e := x.variant(plan.VariantID, true, false)
		if e != nil {
			return e
		}
		if v.Branch != plan.Target {
			return changed()
		}
		_, token, _, _, _, e := x.scope(v, 0)
		if e != nil {
			return e
		}
		selection.ScopeToken = token
		snap, e = s.selectRepos(x, v.ID, 0, selection, tag("project-variant", v.ID, v.Version), true)
		return e
	})
	if e != nil {
		return out, a, e
	}
	results := make([]i.BranchResult, len(items))
	for n := range results {
		results[n] = i.BranchResult{Status: "unchecked", Reason: "budget_exceeded"}
	}
	work, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	parallel(work, len(items), func(n int) {
		for _, r := range snap.Rows {
			if r.Repo.ID == items[n].RepositoryID {
				results[n] = i.BranchResult{Status: "unknown", Reason: r.Reason}
				if r.Reason == "" {
					results[n] = s.Integrations.ReadBranch(work, r.Remote, r.Repo.RepoID, plan.Target)
				}
				return
			}
		}
	})
	a, e = s.access(ctx, raw, pid, true, func(x *access) error {
		v, e := x.variant(plan.VariantID, true, false)
		if e != nil {
			return e
		}
		ids := []string{}
		for _, r := range snap.Rows {
			ids = append(ids, fmt.Sprint(r.Repo.ID))
		}
		fresh, e := s.selectRepos(x, v.ID, 0, Selection{ids, snap.Token}, tag("project-variant", v.ID, v.Version), false)
		if e != nil {
			return e
		}
		if !sameSelection(snap, fresh) {
			return changed()
		}
		p, e := x.r.Creation(pid, id)
		if e != nil {
			return e
		}
		if p == nil {
			return notFound()
		}
		if e = match(etag, tag("branch-creation", id, p.Version)); e != nil {
			return e
		}
		for n := range items {
			if !slices.Contains([]string{"exists", "missing", "unknown"}, results[n].Status) {
				continue
			}
			items[n].Reconciliation = jsonBytes(map[string]any{"status": results[n].Status, "reason": results[n].Reason, "commit_id": results[n].Commit, "checked_at": time.Now().UTC(), "checked_by_user_id": fmt.Sprint(x.auth.User.ID)})
			if e = x.r.SaveCreationItem(&items[n], false); e != nil {
				return e
			}
		}
		p.Version++
		if e = x.r.SaveCreation(p, false); e != nil {
			return e
		}
		return x.audit("project_branch_creation", id, p.Target, "reconciled", map[string]any{"item_ids": w.IDs}, meta)
	})
	if e != nil {
		return out, a, e
	}
	return s.History(ctx, raw, pid, id, false, Query{Page: 1, Size: 20})
}
