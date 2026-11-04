package projectdelivery

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func parseID(s string) (uint64, error) { return c.ID(s) }

type Selection struct {
	IDs        []string `json:"repository_ids"`
	ScopeToken string   `json:"scope_token"`
}
type selectedRepo struct {
	Repo   i.ProjectRepo
	Remote i.BranchSnapshot
	Reason string
}
type selectionSnapshot struct {
	Rows                []selectedRepo
	Token, Branch, Kind string
	SubjectID           uint64
	Variant             Variant
	Actor               uint64
}

func (s *Service) selectRepos(x *access, vid, eid uint64, selection Selection, etag string, decrypt bool) (selectionSnapshot, error) {
	var snap selectionSnapshot
	v, e := x.variant(vid, true, false)
	if e != nil {
		return snap, e
	}
	if len(selection.IDs) < 1 || len(selection.IDs) > 100 {
		return snap, httpx.Invalid("repository_ids", "invalid_count")
	}
	want := tag("project-variant", v.ID, v.Version)
	if eid != 0 {
		env, e := x.r.Environment(v.ProjectID, vid, eid)
		if e != nil {
			return snap, e
		}
		if env == nil {
			return snap, notFound()
		}
		want = tag("project-environment", env.ID, env.Version)
	}
	if e = match(etag, want); e != nil {
		return snap, e
	}
	rows, token, branch, id, kind, e := x.scope(v, eid)
	if e != nil {
		return snap, e
	}
	if token != selection.ScopeToken {
		return snap, changed()
	}
	byID := map[string]i.ProjectRepo{}
	for _, r := range rows {
		byID[fmt.Sprint(r.ID)] = r.ProjectRepo
	}
	snap = selectionSnapshot{Token: token, Branch: branch, Kind: kind, SubjectID: id, Variant: *v, Actor: x.auth.User.ID}
	seen := map[string]bool{}
	for _, id := range selection.IDs {
		repo, ok := byID[id]
		if !ok || seen[id] {
			return snap, httpx.Invalid("repository_ids", "repository_out_of_scope")
		}
		seen[id] = true
		snap.Rows = append(snap.Rows, selectedRepo{Repo: repo})
	}
	slices.SortFunc(snap.Rows, func(a, b selectedRepo) int {
		if a.Repo.ConnectionID < b.Repo.ConnectionID {
			return -1
		}
		if a.Repo.ConnectionID > b.Repo.ConnectionID {
			return 1
		}
		if a.Repo.ID < b.Repo.ID {
			return -1
		}
		return 1
	})
	for n, r := range snap.Rows {
		remote, e := s.Integrations.BranchSnapshot(x.tx, r.Repo.ConnectionID, decrypt)
		snap.Rows[n].Remote = remote
		if e != nil {
			snap.Rows[n].Reason = i.BranchReason(e)
		}
		if r.Repo.Archived != nil && *r.Repo.Archived {
			snap.Rows[n].Reason = "remote_archived"
		}
	}
	return snap, nil
}
func sameSelection(a, b selectionSnapshot) bool {
	if a.Token != b.Token || a.Branch != b.Branch || a.Actor != b.Actor || len(a.Rows) != len(b.Rows) {
		return false
	}
	for n, r := range a.Rows {
		other := b.Rows[n]
		if r.Repo.ID != other.Repo.ID || r.Repo.Version != other.Repo.Version || r.Reason != other.Reason || digest(r.Remote) != digest(other.Remote) {
			return false
		}
	}
	return true
}
func parallel(ctx context.Context, n int, fn func(int)) {
	var wg sync.WaitGroup
	next := make(chan int)
	for range 4 {
		wg.Go(func() {
			for id := range next {
				if ctx.Err() == nil {
					fn(id)
				}
			}
		})
	}
	for j := 0; j < n; j++ {
		if ctx.Err() != nil {
			break
		}
		next <- j
	}
	close(next)
	wg.Wait()
}
func (s *Service) Check(ctx context.Context, raw string, pid, vid, eid uint64, w Selection, etag string) (i.Result, *identity.Auth, error) {
	var snap selectionSnapshot
	var out i.Result
	a, e := s.access(ctx, raw, pid, true, func(x *access) error { var e error; snap, e = s.selectRepos(x, vid, eid, w, etag, true); return e })
	if e != nil {
		return out, a, e
	}
	work, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	results := make([]Check, len(snap.Rows))
	idBytes := make([]byte, 16)
	if _, e = rand.Read(idBytes); e != nil {
		return out, a, e
	}
	checkID := hex.EncodeToString(idBytes)
	started := time.Now().UTC().Truncate(time.Millisecond)
	for n, r := range snap.Rows {
		results[n] = Check{ProjectID: pid, SubjectKind: snap.Kind, SubjectID: snap.SubjectID, RepositoryID: r.Repo.ID, Branch: snap.Branch, CheckID: checkID, Status: "unchecked", Reason: "budget_exceeded", Actor: snap.Actor, StartedAt: started, Snapshot: checkSnapshot(snap.Token, r.Repo, r.Remote)}
	}
	parallel(work, len(snap.Rows), func(n int) {
		r := snap.Rows[n]
		res := i.BranchResult{Status: "unknown", Reason: r.Reason}
		if r.Reason == "" {
			res = s.Integrations.ReadBranch(work, r.Remote, r.Repo.RepoID, snap.Branch)
		}
		v := &results[n]
		v.Status = res.Status
		v.Reason = res.Reason
		v.Commit = res.Commit
		v.Protected = res.Protected
		v.Default = res.Default
		v.FinishedAt = time.Now().UTC().Truncate(time.Millisecond)
	})
	a, e = s.access(ctx, raw, pid, true, func(x *access) error {
		fresh, e := s.selectRepos(x, vid, eid, w, etag, false)
		if e != nil {
			return e
		}
		if !sameSelection(snap, fresh) {
			return changed()
		}
		for n := range results {
			if results[n].Status != "unchecked" {
				if e = x.r.SaveBranchCheck(&results[n]); e != nil {
					return e
				}
			}
		}
		counts := map[string]int{}
		for _, result := range results {
			counts[result.Status]++
		}
		out.Data = map[string]any{"items": results, "counts": counts}
		return nil
	})
	return out, a, e
}
func Clean(ctx context.Context, store identity.Store, now time.Time) error {
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, ok := tx.(Repository)
		if !ok {
			return nil
		}
		return r.RecoverCreations(now)
	})
}
func jsonBytes(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
