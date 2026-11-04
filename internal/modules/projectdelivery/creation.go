package projectdelivery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type SourceOverride struct {
	ID     string `json:"repository_id"`
	Branch string `json:"source_branch"`
}
type PrepareWrite struct {
	Selection
	Source    string           `json:"default_source_branch"`
	Overrides []SourceOverride `json:"source_overrides"`
	RetryOf   string           `json:"retry_of_id"`
}
type ExecutionItem struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}
type ExecuteWrite struct {
	Items []ExecutionItem `json:"items"`
}
type ReconcileWrite struct {
	IDs []string `json:"item_ids"`
}
type planSnapshot struct {
	Scope       string `json:"scope_digest"`
	VariantName string `json:"variant_name"`
	VariantCode string `json:"variant_code"`
	VariantKind string `json:"variant_kind"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func hash(v any) []byte { b, _ := json.Marshal(v); h := sha256.Sum256(b); return h[:] }
func (s *Service) Prepare(ctx context.Context, raw string, pid, vid uint64, w PrepareWrite, etag, key string, meta identity.Metadata) (i.Result, *identity.Auth, error) {
	var out i.Result
	if !uuidPattern.MatchString(key) {
		return out, nil, httpx.Invalid("Idempotency-Key", "invalid_format")
	}
	if !ValidBranch(w.Source) {
		return out, nil, httpx.Invalid("default_source_branch", "branch_name_invalid")
	}
	sources := map[string]string{}
	for _, v := range w.Overrides {
		if _, ok := sources[v.ID]; ok || !slices.Contains(w.IDs, v.ID) || !ValidBranch(v.Branch) {
			return out, nil, httpx.Invalid("source_overrides", "invalid_value")
		}
		sources[v.ID] = v.Branch
	}
	slices.Sort(w.IDs)
	slices.SortFunc(w.Overrides, func(a, b SourceOverride) int {
		if a.ID < b.ID {
			return -1
		}
		return 1
	})
	requestHash := hash(struct {
		ID    uint64
		Write PrepareWrite
	}{vid, w})
	var snap selectionSnapshot
	var replay *Creation
	a, e := s.access(ctx, raw, pid, true, func(x *access) error {
		var e error
		replay, e = x.r.CreationByKey(pid, x.auth.User.ID, key)
		if e != nil {
			return e
		}
		if replay != nil {
			if !bytes.Equal(replay.RequestHash, requestHash) {
				return httpx.E(409, "IDEMPOTENCY_CONFLICT", "相同请求标识对应不同内容")
			}
			return nil
		}
		snap, e = s.selectRepos(x, vid, 0, w.Selection, etag, true)
		if e != nil {
			return e
		}
		return x.validateRetry(vid, w)
	})
	if e != nil {
		return out, a, e
	}
	if replay != nil {
		return s.History(ctx, raw, pid, replay.ID, false, Query{Page: 1, Size: 20, Status: "all"})
	}
	work, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	items := make([]CreationItem, len(snap.Rows))
	for n, r := range snap.Rows {
		source := w.Source
		if override, ok := sources[fmt.Sprint(r.Repo.ID)]; ok {
			source = override
		}
		items[n] = CreationItem{RepositoryID: r.Repo.ID, RepositoryVersion: r.Repo.Version, ConnectionID: r.Repo.ConnectionID, RepoID: r.Repo.RepoID, Path: r.Repo.FullPath, Source: source, Preview: "error", PreviewReason: "budget_exceeded", Snapshot: jsonBytes(r.Remote), Status: "pending"}
	}
	parallel(work, len(items), func(n int) {
		r := snap.Rows[n]
		item := &items[n]
		if r.Reason != "" {
			item.PreviewReason = r.Reason
			return
		}
		target := s.Integrations.ReadBranch(work, r.Remote, r.Repo.RepoID, snap.Branch)
		if target.Status == "exists" {
			item.Preview = "existing"
			item.PreviewReason = ""
			item.TargetCommit = target.Commit
			return
		}
		if target.Status != "missing" {
			item.PreviewReason = target.Reason
			return
		}
		source := s.Integrations.ReadBranch(work, r.Remote, r.Repo.RepoID, item.Source)
		if source.Status != "exists" {
			item.PreviewReason = source.Reason
			if source.Status == "missing" {
				item.PreviewReason = "source_missing"
			}
			return
		}
		item.Preview = "ready"
		item.PreviewReason = ""
		item.SourceCommit = source.Commit
	})
	plan := Creation{ProjectID: pid, VariantID: vid, Target: snap.Branch, Source: w.Source, Snapshot: jsonBytes(planSnapshot{snap.Token, snap.Variant.Name, snap.Variant.Code, snap.Variant.Kind}), Key: key, RequestHash: requestHash, Status: "prepared", Version: 1, Actor: snap.Actor, ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}
	if w.RetryOf != "" {
		id, e := parseID(w.RetryOf)
		if e != nil {
			return out, a, e
		}
		plan.RetryOf = &id
	}
	a, e = s.access(ctx, raw, pid, true, func(x *access) error {
		fresh, e := s.selectRepos(x, vid, 0, w.Selection, etag, false)
		if e != nil {
			return e
		}
		if !sameSelection(snap, fresh) {
			return changed()
		}
		existing, e := x.r.CreationByKey(pid, snap.Actor, key)
		if e != nil {
			return e
		}
		if existing != nil {
			if !bytes.Equal(existing.RequestHash, requestHash) {
				return httpx.E(409, "IDEMPOTENCY_CONFLICT", "请求内容不同")
			}
			plan = *existing
			return nil
		}
		if e = x.r.SaveCreation(&plan, true); e != nil {
			return e
		}
		for n := range items {
			items[n].CreationID = plan.ID
			if e = x.r.SaveCreationItem(&items[n], true); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		return out, a, e
	}
	return s.History(ctx, raw, pid, plan.ID, false, Query{Page: 1, Size: 20, Status: "all"})
}
func (x *access) validateRetry(vid uint64, w PrepareWrite) error {
	if w.RetryOf == "" {
		return nil
	}
	id, e := parseID(w.RetryOf)
	if e != nil {
		return e
	}
	p, e := x.r.Creation(x.project.ID, id)
	if e != nil {
		return e
	}
	v, e := x.variant(vid, true, false)
	if e != nil {
		return e
	}
	if p == nil || p.VariantID != vid || p.Target != v.Branch || p.Status == "prepared" || p.Status == "executing" {
		return httpx.Invalid("retry_of_id", "invalid_retry")
	}
	items, e := x.r.CreationItems(p.ID)
	if e != nil {
		return e
	}
	eligible := map[string]bool{}
	for _, item := range items {
		eligible[fmt.Sprint(item.RepositoryID)] = item.Status == "failed" || item.Status == "not_started" || item.Status == "unknown" && len(item.Reconciliation) > 0 && string(item.Reconciliation) != "null"
	}
	for _, id := range w.IDs {
		if !eligible[id] {
			return httpx.Invalid("repository_ids", "retry_ineligible")
		}
	}
	return nil
}
func (s *Service) decoratePlan(x *access, p *Creation) error {
	p.ETag = tag("branch-creation", p.ID, p.Version)
	p.Expired = p.Status == "prepared" && !p.ExpiresAt.After(time.Now())
	p.CanManage = x.manage
	var snap planSnapshot
	if e := json.Unmarshal(p.Snapshot, &snap); e != nil {
		return e
	}
	p.VariantName = snap.VariantName
	rows, e := x.r.CreationItems(p.ID)
	if e != nil {
		return e
	}
	p.Counts = map[string]int{}
	usable := false
	unknown := false
	for _, r := range rows {
		p.Counts[r.Status]++
		usable = usable || r.Preview != "error"
		unknown = unknown || r.Status == "unknown"
	}
	v, e := x.r.Variant(p.ProjectID, p.VariantID)
	if e != nil {
		return e
	}
	writable := x.manage && v != nil && v.ArchivedAt == nil && v.Branch == p.Target
	p.CanExecute = writable && p.Status == "prepared" && !p.Expired && p.Actor == x.auth.User.ID && usable
	p.CanReconcile = writable && p.Status != "prepared" && p.Status != "executing" && unknown
	return nil
}
func (s *Service) History(ctx context.Context, raw string, pid, id uint64, items bool, q Query) (i.Result, *identity.Auth, error) {
	var out i.Result
	if q.Status == "" {
		q.Status = "all"
	}
	if e := validateQuery(&q); e != nil {
		return out, nil, e
	}
	a, e := s.access(ctx, raw, pid, false, func(x *access) error {
		if id == 0 {
			rows, n, e := x.r.Creations(pid, q)
			if e != nil {
				return e
			}
			for j := range rows {
				if e = s.decoratePlan(x, &rows[j]); e != nil {
					return e
				}
			}
			out.Data = Page[Creation]{Items: rows, Total: n, Page: q.Page, Size: q.Size, CanManage: x.manage}
			return nil
		}
		p, e := x.r.Creation(pid, id)
		if e != nil {
			return e
		}
		if p == nil {
			return notFound()
		}
		if items {
			rows, e := x.r.CreationItems(id)
			if e != nil {
				return e
			}
			out.Data = paginate(rows, q)
		} else {
			if e = s.decoratePlan(x, p); e != nil {
				return e
			}
			out.Data = p
		}
		out.Tag = tag("branch-creation", p.ID, p.Version)
		return nil
	})
	return out, a, e
}
func (s *Service) validatePlan(x *access, p *Creation, items []CreationItem, decrypt bool) (selectionSnapshot, error) {
	var snap planSnapshot
	if e := json.Unmarshal(p.Snapshot, &snap); e != nil {
		return selectionSnapshot{}, e
	}
	v, e := x.variant(p.VariantID, true, false)
	if e != nil {
		return selectionSnapshot{}, e
	}
	if v.Branch != p.Target {
		return selectionSnapshot{}, changed()
	}
	ids := make([]string, len(items))
	for n, r := range items {
		ids[n] = fmt.Sprint(r.RepositoryID)
	}
	selected, e := s.selectRepos(x, p.VariantID, 0, Selection{ids, snap.Scope}, tag("project-variant", v.ID, v.Version), decrypt)
	if e != nil {
		return selected, e
	}
	for _, r := range selected.Rows {
		for _, item := range items {
			if item.RepositoryID == r.Repo.ID && (item.RepositoryVersion != r.Repo.Version || digest(r.Remote) != digest(item.Snapshot)) {
				return selected, changed()
			}
		}
	}
	return selected, nil
}
func validateActions(items []CreationItem, w ExecuteWrite) (map[uint64]string, error) {
	if len(items) != len(w.Items) {
		return nil, httpx.Invalid("items", "complete_plan_required")
	}
	out := map[uint64]string{}
	nonSkip := false
	for _, v := range w.Items {
		id, e := parseID(v.ID)
		if e != nil {
			return nil, e
		}
		if _, ok := out[id]; ok {
			return nil, httpx.Invalid("items", "duplicate")
		}
		found := false
		for _, r := range items {
			if r.ID == id {
				found = true
				if v.Action != "skip" && (r.Preview == "ready" && v.Action != "create" || r.Preview == "existing" && v.Action != "use_existing" || r.Preview == "error") {
					return nil, httpx.Invalid("items", "invalid_action")
				}
			}
		}
		if !found {
			return nil, httpx.Invalid("items", "invalid_id")
		}
		out[id] = v.Action
		nonSkip = nonSkip || v.Action != "skip"
	}
	if !nonSkip {
		return nil, httpx.Invalid("items", "all_skipped")
	}
	return out, nil
}
func (s *Service) Execute(ctx context.Context, raw string, pid, id uint64, w ExecuteWrite, etag string, meta identity.Metadata) (i.Result, *identity.Auth, error) {
	var out i.Result
	var items []CreationItem
	var plan *Creation
	replay := false
	slices.SortFunc(w.Items, func(a, b ExecutionItem) int {
		if a.ID < b.ID {
			return -1
		}
		return 1
	})
	eh := hash(w)
	a, e := s.access(ctx, raw, pid, true, func(x *access) error {
		var e error
		plan, e = x.r.Creation(pid, id)
		if e != nil {
			return e
		}
		if plan == nil {
			return notFound()
		}
		if plan.Actor != x.auth.User.ID {
			return httpx.E(403, "FORBIDDEN", "仅计划准备者可执行")
		}
		if plan.Status != "prepared" {
			if !bytes.Equal(plan.ExecutionHash, eh) {
				return httpx.E(409, "IDEMPOTENCY_CONFLICT", "执行内容不同")
			}
			replay = true
			return nil
		}
		if e = match(etag, tag("branch-creation", id, plan.Version)); e != nil {
			return e
		}
		if !plan.ExpiresAt.After(time.Now()) {
			return httpx.E(409, "PLAN_EXPIRED", "计划已过期，请重新预览")
		}
		items, e = x.r.CreationItems(id)
		if e != nil {
			return e
		}
		actions, e := validateActions(items, w)
		if e != nil {
			return e
		}
		if _, e = s.validatePlan(x, plan, items, false); e != nil {
			return e
		}
		if e = x.guard(plan.VariantID, 0); e != nil {
			return e
		}
		now := time.Now().UTC()
		lease := now.Add(90 * time.Second)
		plan.StartedAt = &now
		plan.Lease = &lease
		plan.Status = "executing"
		plan.ExecutionHash = eh
		plan.Version++
		if e = x.r.SaveCreation(plan, false); e != nil {
			return e
		}
		for n := range items {
			items[n].Action = actions[items[n].ID]
			if items[n].Action == "skip" {
				items[n].Status = "skipped"
				items[n].FinishedAt = &now
			}
			if e = x.r.SaveCreationItem(&items[n], false); e != nil {
				return e
			}
		}
		return x.audit("project_branch_creation", id, plan.Target, "started", map[string]any{"project_id": fmt.Sprint(pid), "variant_id": fmt.Sprint(plan.VariantID)}, meta)
	})
	if e != nil {
		return out, a, e
	}
	if replay {
		return s.History(ctx, raw, pid, id, false, Query{Page: 1, Size: 20})
	}
	work, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	// Each worker reauthorizes and claims exactly one pending item before dispatch.
	parallel(work, len(items), func(n int) {
		if items[n].Action == "skip" {
			return
		}
		s.executeItem(work, raw, pid, id, items[n].ID, meta)
	})
	// Persist facts even if the HTTP request or user's access was revoked meanwhile.
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer finishCancel()
	store, e := s.Integrations.Store()
	if e == nil {
		e = store.Transact(finishCtx, func(tx identity.Tx) error {
			r, ok := tx.(Repository)
			if !ok {
				return changed()
			}
			p, e := r.Creation(pid, id)
			if e != nil {
				return e
			}
			if p == nil || p.Status != "executing" {
				return nil
			}
			rows, e := r.CreationItems(id)
			if e != nil {
				return e
			}
			now := time.Now().UTC()
			success, fail := 0, 0
			interrupted := work.Err() != nil
			for n := range rows {
				item := &rows[n]
				if item.Status == "creating" || item.Status == "pending" {
					interrupted = true
					if item.Status == "creating" {
						item.Status = "unknown"
					} else {
						item.Status = "not_started"
					}
					item.Reason = "interrupted"
					item.FinishedAt = &now
					if e = r.SaveCreationItem(item, false); e != nil {
						return e
					}
				}
				switch item.Status {
				case "created", "used_existing":
					success++
				case "skipped":
				default:
					fail++
				}
			}
			p.Status = "failed"
			if success > 0 {
				p.Status = "completed"
				if fail > 0 {
					p.Status = "partial"
				}
			}
			if interrupted {
				p.Status = "interrupted"
			}
			p.FinishedAt = &now
			p.Version++
			return r.SaveCreation(p, false)
		})
	}
	if e != nil {
		return out, a, e
	}
	return s.History(ctx, raw, pid, id, false, Query{Page: 1, Size: 20})
}
func (s *Service) executeItem(ctx context.Context, raw string, pid, id, itemID uint64, meta identity.Metadata) {
	var chosen CreationItem
	var plan *Creation
	var remote selectedRepo
	_, e := s.access(ctx, raw, pid, true, func(x *access) error {
		var e error
		plan, e = x.r.Creation(pid, id)
		if e != nil {
			return e
		}
		if plan == nil || plan.Status != "executing" || plan.Lease == nil || !plan.Lease.After(time.Now()) {
			return changed()
		}
		items, e := x.r.CreationItems(id)
		if e != nil {
			return e
		}
		snap, e := s.validatePlan(x, plan, items, true)
		if e != nil {
			return e
		}
		for _, v := range items {
			if v.ID == itemID {
				chosen = v
			}
		}
		if chosen.Status != "pending" {
			return changed()
		}
		for _, r := range snap.Rows {
			if r.Repo.ID == chosen.RepositoryID {
				remote = r
			}
		}
		if remote.Reason != "" {
			return changed()
		}
		now := time.Now().UTC()
		chosen.Status = "creating"
		chosen.StartedAt = &now
		plan.Version++
		if e = x.r.SaveCreation(plan, false); e != nil {
			return e
		}
		return x.r.SaveCreationItem(&chosen, false)
	})
	if e != nil {
		return
	}
	var result i.BranchResult
	if chosen.Action == "create" {
		reason := s.Integrations.BranchRepository(ctx, remote.Remote, chosen.RepoID)
		if reason == "" {
			_, err := s.access(ctx, raw, pid, true, func(x *access) error {
				p, err := x.r.Creation(pid, id)
				if err != nil {
					return err
				}
				if p == nil || p.Status != "executing" || p.Lease == nil || !p.Lease.After(time.Now()) {
					return changed()
				}
				rows, err := x.r.CreationItems(id)
				if err != nil {
					return err
				}
				_, err = s.validatePlan(x, p, rows, false)
				return err
			})
			if err != nil {
				reason = "state_changed"
			}
		}
		if reason != "" {
			result = i.BranchResult{Status: "failed", Reason: reason}
		} else {
			result = s.Integrations.CreateBranch(ctx, remote.Remote, chosen.RepoID, plan.Target, chosen.SourceCommit)
		}
	} else {
		result = s.Integrations.ReadBranch(ctx, remote.Remote, chosen.RepoID, plan.Target)
		if result.Status == "exists" && result.Commit == chosen.TargetCommit {
			result.Status = "used_existing"
		} else {
			result.Status = "failed"
			result.Reason = "state_changed"
		}
	}
	factCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	store, e := s.Integrations.Store()
	if e != nil {
		return
	}
	_ = store.Transact(factCtx, func(tx identity.Tx) error {
		r, ok := tx.(Repository)
		if !ok {
			return changed()
		}
		p, e := r.Creation(pid, id)
		if e != nil {
			return e
		}
		if p == nil || p.Status != "executing" || p.Lease == nil || !p.Lease.After(time.Now()) {
			return nil
		}
		rows, e := r.CreationItems(id)
		if e != nil {
			return e
		}
		for _, v := range rows {
			if v.ID == itemID && v.Status == "creating" {
				now := time.Now().UTC()
				v.Status = result.Status
				v.Reason = result.Reason
				v.Commit = result.Commit
				v.FinishedAt = &now
				if e = r.SaveCreationItem(&v, false); e != nil {
					return e
				}
				p.Version++
				if e = r.SaveCreation(p, false); e != nil {
					return e
				}
				target := fmt.Sprint(id)
				return tx.Audit(identity.Event{ActorID: &p.Actor, ActorType: "user", Action: "project_branch_creation.item_finished", TargetType: "project_branch_creation", TargetID: &target, TargetLabel: p.Target, OccurredAt: now, Detail: jsonBytes(map[string]any{"item_id": fmt.Sprint(itemID), "status": v.Status, "reason": v.Reason}), RequestID: &meta.RequestID, IP: &meta.IP})
			}
		}
		return nil
	})
}
