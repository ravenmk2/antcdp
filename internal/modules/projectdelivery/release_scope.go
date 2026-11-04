package projectdelivery

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

func (s *Service) ReleaseActors(ctx context.Context, raw string, cmd Command, rid, repo uint64) (i.Result, *identity.Auth, error) {
	var targets []gitTarget
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		rows, e := x.store.MaterialRepos(rid)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if repo != 0 && r.ID != repo {
				continue
			}
			t, e := x.target(s, r.ID)
			if e != nil {
				return e
			}
			targets = append(targets, t)
		}
		if len(targets) == 0 {
			return notFound()
		}
		return nil
	})
	var out i.Result
	if e != nil {
		return out, a, e
	}
	var names []string
	actors := map[uint64]i.GitActor{}
	for _, t := range targets {
		u, e := t.Git.Actor(ctx)
		if e != nil {
			return out, a, e
		}
		actors[t.Repo.ID] = u
		names = append(names, t.Repo.Path+" · "+u.Username+" (#"+fmt.Sprint(u.ID)+")")
	}
	out.Data = map[string]string{"identity": strings.Join(names, "；"), "token": digest(actors)}
	return out, a, nil
}
func (s *Service) ReleaseScope(ctx context.Context, raw string, cmd Command, rid uint64, token string, save bool) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		if e := x.state("draft"); e != nil {
			return e
		}
		repos, e := x.allRepos()
		if e != nil {
			return e
		}
		fresh := Evaluate(x.variantData.Scope, repos)
		previous, e := x.store.MaterialRepos(rid)
		if e != nil {
			return e
		}
		adds, drops := []string{}, []string{}
		removed := map[uint64]bool{}
		for _, r := range previous {
			if r.Branch != x.variantData.Branch || !slices.ContainsFunc(fresh, func(f ScopedRepo) bool { return f.ID == r.ProjectRepo }) {
				drops = append(drops, r.Path+" / "+r.Branch)
				removed[r.ID] = true
			}
		}
		for _, r := range fresh {
			if !slices.ContainsFunc(previous, func(v ReleaseRepo) bool { return v.ProjectRepo == r.ID && v.Branch == x.variantData.Branch }) {
				adds = append(adds, r.FullPath+" / "+x.variantData.Branch)
			}
		}
		want := digest([]any{rid, x.release.Version, x.variantData.Branch, fresh})
		if !save {
			out.Data = map[string]any{"adds": adds, "drops": drops, "token": want}
			return nil
		}
		if want != token {
			return changed()
		}
		changes, e := x.store.ReleaseChanges(rid)
		if e != nil {
			return e
		}
		for _, v := range changes {
			if removed[v.Repo] && v.Status != "removed" {
				return releaseBlocked("请先移出范围外的变更")
			}
		}
		materials, e := x.store.MaterialRows(rid)
		if e != nil {
			return e
		}
		for _, v := range materials {
			if v.Repository != "" {
				id, e := parseID(v.Repository)
				if e != nil {
					return e
				}
				if removed[id] {
					return releaseBlocked("请先修改材料的仓库归属")
				}
			}
		}
		if e = x.store.SnapshotReleaseRepos(rid, x.variantData.Branch, fresh); e != nil {
			return e
		}
		out.Data = map[string]bool{"saved": true}
		return x.touch(cmd, "scope_refreshed", map[string]int{"repositories": len(fresh)})
	})
	return out, a, e
}
