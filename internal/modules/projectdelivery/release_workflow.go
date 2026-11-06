package projectdelivery

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type ReleaseChange struct {
	ID         uint64          `db:"id" json:"id,string"`
	Repo       uint64          `db:"release_repository_id" json:"repo_id,string"`
	Kind       string          `db:"change_kind" json:"kind"`
	Ref        string          `db:"remote_ref" json:"ref"`
	Status     string          `db:"disposition" json:"status"`
	RevertedBy uint64          `db:"reverted_by_change_id" json:"reverted_by,string,omitempty"`
	Evidence   json.RawMessage `db:"evidence" json:"evidence"`
	Note       string          `db:"note" json:"note"`
}
type FrozenRepo struct {
	ReleaseRepo
	SHA      string    `json:"commit_sha"`
	Observed time.Time `json:"observed_at"`
}
type Manifest struct {
	ID       uint64          `db:"id" json:"id,string"`
	Sequence int             `db:"sequence_no" json:"sequence_no"`
	Header   json.RawMessage `db:"header" json:"header"`
	Digest   string          `db:"digest" json:"digest"`
	Decision string          `db:"decision" json:"decision"`
	Note     string          `db:"review_note" json:"review_note"`
	Created  time.Time       `db:"created_at" json:"created_at"`
	Reviewer uint64          `db:"reviewer_id" json:"reviewer_id,string,omitempty"`
	Reviewed *time.Time      `db:"reviewed_at" json:"reviewed_at,omitempty"`
}
type FrozenEntry struct {
	Kind     string          `db:"kind" json:"kind"`
	Subject  uint64          `db:"subject_id" json:"subject_id,string"`
	Revision string          `db:"revision_id" json:"revision_id,omitempty"`
	Position int             `db:"sort_order" json:"sort_order"`
	Data     json.RawMessage `db:"snapshot" json:"snapshot"`
}
type Operation struct {
	ID      uint64    `db:"id" json:"id,string"`
	Actor   uint64    `db:"actor_user_id" json:"actor_id,string"`
	Kind    string    `db:"kind" json:"kind"`
	Status  string    `db:"status" json:"status"`
	Hash    string    `db:"request_digest" json:"-"`
	Key     string    `db:"idempotency_key" json:"-"`
	Created time.Time `db:"created_at" json:"created_at"`
}
type Step struct {
	ID       uint64          `db:"id" json:"id,string"`
	Op       uint64          `db:"operation_id" json:"operation_id,string"`
	Repo     uint64          `db:"release_repository_id" json:"repo_id,string"`
	Kind     string          `db:"kind" json:"kind"`
	Status   string          `db:"status" json:"status"`
	Intent   json.RawMessage `db:"intent" json:"intent"`
	Observed json.RawMessage `db:"observed" json:"observed"`
	Updated  time.Time       `db:"updated_at" json:"updated_at"`
}
type WorkflowStore interface {
	SaveBaseline(uint64, string, string, string, uint64) error
	PriorBaseline(uint64, ReleaseRepo) (string, string, error)
	ActiveRelease(*Release, bool) error
	ReleaseChanges(uint64) ([]ReleaseChange, error)
	SaveChange(uint64, uint64, *ReleaseChange) error
	ReleaseManifests(uint64) ([]Manifest, error)
	FreezeRelease(*Release, *Manifest, []FrozenEntry, uint64) error
	Entries(uint64) ([]FrozenEntry, error)
	ReviewRelease(uint64, string, string, uint64) error
	Operations(uint64) ([]Operation, error)
	Steps(uint64) ([]Step, error)
	StartOperation(uint64, uint64, *Operation, []Step) error
	StepResult(uint64, uint64, string, string, json.RawMessage) error
	EndOperation(uint64, string) error
}
type FlowWrite struct {
	ActorToken string `json:"actor_token"`
	Repo       uint64 `json:"repo_id,string"`
	Ref        string `json:"ref"`
	Change     uint64 `json:"change_id,string"`
	Original   uint64 `json:"original_id,string"`
	Note       string `json:"note"`
	SHA        string `json:"sha"`
	Manifest   uint64 `json:"manifest_id,string"`
	Digest     string `json:"digest"`
	Operation  uint64 `json:"operation_id,string"`
	Decision   string `json:"decision"`
}
type gitTarget struct {
	Repo ReleaseRepo
	Git  i.ReleaseGit
}

func (x *releaseContext) target(s *Service, id uint64) (gitTarget, error) {
	rows, e := x.store.MaterialRepos(x.release.ID)
	if e != nil {
		return gitTarget{}, e
	}
	for _, r := range rows {
		if r.ID == id {
			g, e := s.Integrations.ReleaseGit(x.tx, x.auth.User.ID, r.Connection, r.RemoteID)
			return gitTarget{r, g}, e
		}
	}
	return gitTarget{}, notFound()
}
func (x *releaseContext) state(status ...string) error {
	if !slices.Contains(status, x.release.Status) {
		return releaseReadOnly()
	}
	return nil
}
func (x *releaseContext) touch(cmd Command, action string, data any) error {
	x.release.Version++
	if e := x.store.UpdateRelease(x.release); e != nil {
		return e
	}
	return x.audit("project_release", x.release.ID, x.release.TagName, action, data, cmd.Meta)
}
func jsonData(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func (s *Service) Workflow(ctx context.Context, raw string, cmd Command, rid uint64) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, false, func(x *releaseContext) error {
		changes, e := x.store.ReleaseChanges(rid)
		if e != nil {
			return e
		}
		manifests, e := x.store.ReleaseManifests(rid)
		if e != nil {
			return e
		}
		ops, e := x.store.Operations(rid)
		if e != nil {
			return e
		}
		steps := []Step{}
		if len(ops) > 0 {
			steps, e = x.store.Steps(ops[0].ID)
			if e != nil {
				return e
			}
		}
		out = i.Result{Data: map[string]any{"changes": changes, "manifests": manifests, "operations": ops, "steps": steps, "can_manage": x.manage && x.variantData.ArchivedAt == nil}, Tag: x.release.ETag}
		return nil
	})
	return out, a, e
}
func (s *Service) GitInput(ctx context.Context, raw string, cmd Command, rid uint64, op string, w FlowWrite) (i.Result, *identity.Auth, error) {
	var out i.Result
	var target gitTarget
	if op == "mr-options" {
		if err := validateQuery(&cmd.Query); err != nil {
			return out, nil, err
		}
	}
	admin := op != "mr-options" && op != "select-mr"
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, admin, func(x *releaseContext) error {
		if e := x.state("draft", "integrating"); e != nil {
			return e
		}
		if op == "baseline" && x.release.Status != "draft" {
			return releaseReadOnly()
		}
		var e error
		target, e = x.target(s, w.Repo)
		return e
	})
	if e != nil {
		return out, a, e
	}
	if op == "mr-options" {
		rows, e := target.Git.MRs(ctx, target.Repo.Branch, cmd.Query.Page, cmd.Query.Size)
		return i.Result{Data: rows}, a, e
	}
	var change ReleaseChange
	var base, kind string
	switch op {
	case "baseline":
		head, e := target.Git.Head(ctx, target.Repo.Branch)
		if e != nil {
			return out, a, e
		}
		base, kind = head, "initial"
		if w.Ref == "" && target.Repo.Baseline != "" {
			base, kind = target.Repo.Baseline, target.Repo.BaselineKind
		}
		if w.Ref != "" {
			c, e := target.Git.Commit(ctx, w.Ref)
			if e != nil {
				return out, a, e
			}
			if _, e = target.Git.Range(ctx, c.ID, head); e != nil {
				return out, a, e
			}
			base, kind = c.ID, "custom"
		}
	case "select-mr", "link-revert":
		iid, e := strconv.ParseUint(w.Ref, 10, 64)
		if e != nil || iid == 0 {
			return out, a, httpx.Invalid("ref", "invalid_iid")
		}
		m, e := target.Git.MR(ctx, iid)
		if e != nil {
			return out, a, e
		}
		if m.Target != target.Repo.Branch || m.State == "closed" {
			return out, a, httpx.Invalid("ref", "wrong_target_or_closed")
		}
		change = ReleaseChange{Repo: w.Repo, Kind: "mr", Ref: strconv.FormatUint(iid, 10), Status: "selected", Evidence: jsonData(m), Note: w.Note}
	case "include-commit":
		if strings.TrimSpace(w.Note) == "" {
			return out, a, httpx.Invalid("note", "required")
		}
		c, e := target.Git.Commit(ctx, w.Ref)
		if e != nil {
			return out, a, e
		}
		if c.ID != w.Ref {
			return out, a, httpx.Invalid("ref", "full_sha_required")
		}
		change = ReleaseChange{Repo: w.Repo, Kind: "commit", Ref: c.ID, Status: "included", Evidence: jsonData(c), Note: w.Note}
	default:
		return out, a, httpx.Invalid("action", "invalid_value")
	}
	a, e = s.releaseAccess(ctx, raw, cmd, rid, true, admin, func(x *releaseContext) error {
		if op == "baseline" {
			prior, pk, e := x.store.PriorBaseline(x.variantData.ID, target.Repo)
			if e != nil {
				return e
			}
			if prior != "" {
				base, kind = prior, pk
			}
			if e = x.store.SaveBaseline(w.Repo, base, kind, w.Ref, x.auth.User.ID); e != nil {
				return e
			}
		} else {
			if e := x.store.SaveChange(rid, x.auth.User.ID, &change); e != nil {
				return e
			}
			if op == "link-revert" {
				if e := x.linkRevert(w.Original, change); e != nil {
					return e
				}
			}
		}
		if e := x.touch(cmd, op, map[string]any{"repository": w.Repo, "ref": w.Ref}); e != nil {
			return e
		}
		out = i.Result{Data: map[string]any{"change": change, "baseline_sha": base}, Tag: tag("release", rid, x.release.Version)}
		return nil
	})
	return out, a, e
}
func (x *releaseContext) linkRevert(original uint64, revert ReleaseChange) error {
	rows, e := x.store.ReleaseChanges(x.release.ID)
	if e != nil {
		return e
	}
	for _, v := range rows {
		if v.ID == original && v.ID != revert.ID && v.Repo == revert.Repo {
			v.RevertedBy = revert.ID
			v.Status = "revert_pending"
			return x.store.SaveChange(x.release.ID, x.auth.User.ID, &v)
		}
	}
	return httpx.Invalid("original_id", "invalid_change")
}
func (x *releaseContext) start(cmd Command) error {
	if e := x.state("draft"); e != nil {
		return e
	}
	if Classify(x.model.Rules, x.variantData.Branch, x.variantData.Type(), false).Validity != "valid" {
		return httpx.Invalid("main_branch", "invalid_binding")
	}
	repos, e := x.allRepos()
	if e != nil {
		return e
	}
	raw := Evaluate(x.variantData.Scope, repos)
	rows, e := x.store.MaterialRepos(x.release.ID)
	if e != nil {
		return e
	}
	if len(rows) == 0 {
		return httpx.Invalid("repositories", "required")
	}
	if len(raw) != len(rows) {
		return changed()
	}
	if e = x.store.SnapshotReleaseRepos(x.release.ID, x.variantData.Branch, raw); e != nil {
		return e
	}
	ids := map[uint64]bool{}
	for _, r := range raw {
		ids[r.ID] = true
	}
	for _, r := range rows {
		if !ids[r.ProjectRepo] || r.Branch != x.variantData.Branch {
			return changed()
		}
		if r.Baseline == "" {
			return httpx.Invalid("baseline", "required")
		}
		prev, _, e := x.store.PriorBaseline(x.variantData.ID, r)
		if e != nil {
			return e
		}
		if prev != "" && r.Baseline != prev {
			return httpx.E(409, "BASELINE_CHANGED", "上一份发布基线已变化，请重新核对")
		}
	}
	x.release.Status = "integrating"
	if e = x.store.ActiveRelease(x.release, true); e != nil {
		return e
	}
	return x.touch(cmd, "started", map[string]int{"repositories": len(rows)})
}
func (x *releaseContext) review(cmd Command, w FlowWrite, op string) error {
	if x.release.Manifest == nil || *x.release.Manifest != w.Manifest {
		return changed()
	}
	rows, e := x.store.ReleaseManifests(x.release.ID)
	if e != nil {
		return e
	}
	if len(rows) == 0 || rows[0].Digest != w.Digest {
		return changed()
	}
	if op == "return" {
		if e = x.state("accepted"); e != nil {
			return e
		}
		if strings.TrimSpace(w.Note) == "" {
			return httpx.Invalid("note", "required")
		}
		x.release.Status = "integrating"
	} else {
		if e = x.state("reviewing"); e != nil {
			return e
		}
		switch w.Decision {
		case "pass":
			x.release.Status = "accepted"
		case "return":
			if strings.TrimSpace(w.Note) == "" {
				return httpx.Invalid("note", "required")
			}
			x.release.Status = "integrating"
		default:
			return httpx.Invalid("decision", "invalid_value")
		}
		if e = x.store.ReviewRelease(w.Manifest, w.Decision, w.Note, x.auth.User.ID); e != nil {
			return e
		}
	}
	return x.touch(cmd, op, map[string]any{"manifest_id": w.Manifest, "decision": w.Decision})
}
func (s *Service) LocalFlow(ctx context.Context, raw string, cmd Command, rid uint64, op string, w FlowWrite) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		ops, e := x.store.Operations(rid)
		if e != nil {
			return e
		}
		if len(ops) > 0 && slices.Contains([]string{"running", "unknown"}, ops[0].Status) {
			return httpx.E(409, "OPERATION_PENDING", "请先核实进行中的远端操作")
		}
		switch op {
		case "start":
			e = x.start(cmd)
		case "review", "return":
			e = x.review(cmd, w, op)
		case "terminate":
			if e = x.state("draft", "integrating", "reviewing", "accepted", "tagging"); e == nil {
				if strings.TrimSpace(w.Note) == "" {
					return httpx.Invalid("note", "required")
				}
				x.release.Status = "terminated"
				x.release.EndReason = w.Note
				if e = x.store.ActiveRelease(x.release, false); e == nil {
					e = x.touch(cmd, "terminated", map[string]string{"reason": w.Note})
				}
			}
		case "remove-change":
			if e = x.editing(); e == nil {
				rows, err := x.store.ReleaseChanges(rid)
				if err != nil {
					return err
				}
				for _, v := range rows {
					if v.ID == w.Change && v.Status == "selected" {
						v.Status = "removed"
						if err = x.store.SaveChange(rid, x.auth.User.ID, &v); err != nil {
							return err
						}
						if err = x.touch(cmd, op, map[string]any{"change_id": w.Change}); err != nil {
							return err
						}
						out.Data = map[string]bool{"removed": true}
						return nil
					}
				}
				return notFound()
			}
		default:
			return httpx.Invalid("action", "invalid_value")
		}
		if e == nil {
			out = i.Result{Data: map[string]string{"status": x.release.Status}, Tag: tag("release", rid, x.release.Version)}
		}
		return e
	})
	return out, a, e
}
func releaseBlocked(msg string) error { return httpx.E(409, "RELEASE_BLOCKED", msg) }
func repoLabel(r ReleaseRepo, reason string) error {
	return releaseBlocked(fmt.Sprintf("%s · %s", r.Path, reason))
}
