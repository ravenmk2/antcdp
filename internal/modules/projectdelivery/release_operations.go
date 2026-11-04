package projectdelivery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type gitIntent struct {
	Parent  string     `json:"parent_sha,omitempty"`
	Ref     string     `json:"ref"`
	SHA     string     `json:"sha"`
	Branch  string     `json:"branch"`
	Change  uint64     `json:"change_id,string,omitempty"`
	IID     uint64     `json:"iid,string,omitempty"`
	GitUser i.GitActor `json:"git_user"`
}

var releaseKey = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (s *Service) GitOperation(ctx context.Context, raw string, cmd Command, rid uint64, kind, key string, w FlowWrite) (i.Result, *identity.Auth, error) {
	var out i.Result
	if !releaseKey.MatchString(key) {
		return out, nil, httpx.Invalid("idempotency_key", "required")
	}
	op := Operation{Kind: kind, Key: key, Hash: digest([]any{kind, w}), Status: "running"}
	var steps []Step
	var targets map[uint64]gitTarget
	var replay bool
	var mid uint64
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, true, func(x *releaseContext) error {
		ops, e := x.store.Operations(rid)
		if e != nil {
			return e
		}
		op.Actor = x.auth.User.ID
		for _, prev := range ops {
			if prev.Actor == op.Actor && prev.Key == key {
				if prev.Hash != op.Hash {
					return releaseBlocked("同一请求标识的内容不一致")
				}
				replay = true
				out.Data = prev
				return nil
			}
		}
		if e = match(cmd.Tag, x.release.ETag); e != nil {
			return e
		}
		if e = x.noRemoteInFlight(); e != nil {
			return e
		}
		if x.variantData.ArchivedAt != nil {
			return releaseReadOnly()
		}
		targets = map[uint64]gitTarget{}
		add := func(repo uint64, k string, intent gitIntent) error {
			if _, ok := targets[repo]; !ok {
				t, e := x.target(s, repo)
				if e != nil {
					return e
				}
				targets[repo] = t
			}
			steps = append(steps, Step{Repo: repo, Kind: k, Status: "pending", Intent: jsonData(intent)})
			return nil
		}
		if kind == "archive" {
			if e = x.state("accepted", "tagging"); e != nil {
				return e
			}
			if x.release.Manifest == nil || w.Manifest != *x.release.Manifest {
				return changed()
			}
			mid = w.Manifest
			ms, e := x.store.ReleaseManifests(rid)
			if e != nil {
				return e
			}
			if len(ms) == 0 || ms[0].Digest != w.Digest || ms[0].Decision != "pass" {
				return changed()
			}
			entries, e := x.store.Entries(mid)
			if e != nil {
				return e
			}
			for _, entry := range entries {
				if entry.Kind == "repository" {
					var fr FrozenRepo
					if e = json.Unmarshal(entry.Data, &fr); e != nil {
						return e
					}
					if e = add(fr.ID, "tag", gitIntent{Ref: x.release.TagName, SHA: fr.SHA, Branch: fr.Branch}); e != nil {
						return e
					}
				}
			}
			return nil
		}
		if e = x.state("integrating"); e != nil {
			return e
		}
		changes, e := x.store.ReleaseChanges(rid)
		if e != nil {
			return e
		}
		for _, v := range changes {
			if v.ID != w.Change || v.Status == "removed" {
				continue
			}
			var mr i.ReleaseMR
			var iid uint64
			if v.Kind == "mr" {
				if e = json.Unmarshal(v.Evidence, &mr); e != nil {
					return e
				}
				iid = mr.IID
			}
			if kind == "merge" {
				if v.Kind != "mr" || w.SHA != mr.Head || w.SHA == "" {
					return changed()
				}
				return add(v.Repo, "merge", gitIntent{IID: iid, SHA: w.SHA, Change: v.ID})
			}
			if kind != "create-revert" {
				return notFound()
			}
			if v.RevertedBy != 0 {
				return releaseBlocked("该变更已关联回退 MR，请核实已有记录")
			}
			sha := v.Ref
			if v.Kind == "mr" {
				sha = mr.MergeSHA
				if sha == "" {
					sha = mr.SquashSHA
				}
				if sha == "" && mr.State == "merged" {
					sha = mr.Head
				}
			}
			if sha == "" || w.SHA != sha {
				return releaseBlocked("请先刷新已合并的提交信息")
			}
			branch := fmt.Sprintf("antcdp/revert-%d-%d-%s", rid, v.ID, key)
			intent := gitIntent{IID: iid, Ref: branch, SHA: sha, Change: v.ID}
			// Reuse the dedicated branch and completed revert commit after a known failure.
			completed := map[string]bool{}
			for _, prev := range ops {
				if prev.Kind != "create-revert" {
					continue
				}
				prior, e := x.store.Steps(prev.ID)
				if e != nil {
					return e
				}
				for _, step := range prior {
					var old gitIntent
					if e = json.Unmarshal(step.Intent, &old); e != nil {
						return e
					}
					if old.Change != v.ID {
						continue
					}
					if old.Ref != intent.Ref && intent.Ref != branch {
						continue
					}
					intent.Ref = old.Ref
					if step.Kind == "revert_commit" && old.Parent != "" && intent.Parent == "" {
						intent.Parent = old.Parent
					}
					if step.Status == "succeeded" {
						completed[step.Kind] = true
					}
				}
			}
			for _, k := range []string{"revert_branch", "revert_commit", "revert_mr"} {
				if completed[k] {
					continue
				}
				if e = add(v.Repo, k, intent); e != nil {
					return e
				}
			}
			return nil
		}
		return notFound()
	})
	if e != nil || replay {
		return out, a, e
	}
	if len(steps) == 0 {
		return out, a, releaseBlocked("没有可执行的仓库或变更")
	}
	baseHead := ""
	actors := map[uint64]i.GitActor{}
	for index, step := range steps {
		t := targets[step.Repo]
		var in gitIntent
		if e = json.Unmarshal(step.Intent, &in); e != nil {
			return out, a, e
		}
		in.GitUser, e = t.Git.Actor(ctx)
		if e != nil {
			return out, a, e
		}
		actors[step.Repo] = in.GitUser
		in.Branch = t.Repo.Branch
		switch step.Kind {
		case "tag":
			got, e := t.Git.Tag(ctx, in.Ref)
			if e != nil && !remoteMissing(e) {
				return out, a, e
			}
			if e == nil && got != in.SHA {
				return out, a, repoLabel(t.Repo, "同名 Tag 指向其他提交")
			}
		case "merge":
			mr, e := t.Git.MR(ctx, in.IID)
			if e != nil {
				return out, a, e
			}
			if mr.Head != in.SHA || mr.Target != in.Branch || mr.State == "closed" {
				return out, a, changed()
			}
		case "revert_branch":
			in.SHA, e = t.Git.Head(ctx, t.Repo.Branch)
			baseHead = in.SHA
			if e != nil {
				return out, a, e
			}
		}
		if step.Kind == "revert_commit" && baseHead != "" {
			in.Parent = baseHead
		}
		steps[index].Intent = jsonData(in)
	}
	if w.ActorToken != "" && w.ActorToken != digest(actors) {
		return out, a, changed()
	}
	a, e = s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		if err := x.noRemoteInFlight(); err != nil {
			return err
		}
		if e := x.store.StartOperation(rid, mid, &op, steps); e != nil {
			return e
		}
		if kind == "archive" {
			x.release.Status = "tagging"
		}
		return x.touch(cmd, kind+"_requested", map[string]any{"operation_id": op.ID})
	})
	if e != nil {
		return out, a, e
	}
	for _, step := range steps {
		var t gitTarget
		var in gitIntent
		if e = json.Unmarshal(step.Intent, &in); e != nil {
			return out, a, e
		}
		_, e = s.releaseAccess(ctx, raw, cmd, rid, false, true, func(x *releaseContext) error {
			if x.variantData.ArchivedAt != nil {
				return releaseReadOnly()
			}
			var e error
			t, e = x.target(s, step.Repo)
			if e != nil {
				return e
			}
			if !t.Git.SameCredential(targets[step.Repo].Git) {
				return changed()
			}
			return x.store.StepResult(op.ID, step.ID, "pending", "running", nil)
		})
		if e != nil {
			return out, a, e
		}
		status, observed := dispatchGit(ctx, t, step.Kind, in)
		_, e = s.releaseAccess(ctx, raw, cmd, rid, false, false, func(x *releaseContext) error {
			if e := x.store.StepResult(op.ID, step.ID, "running", status, jsonData(observed)); e != nil {
				return e
			}
			if status == "succeeded" {
				return x.applyObserved(in, step, observed)
			}
			return x.store.EndOperation(op.ID, status)
		})
		if e != nil {
			return out, a, e
		}
		if status != "succeeded" {
			out.Data = map[string]any{"id": fmt.Sprint(op.ID), "status": status}
			return out, a, nil
		}
	}
	return s.finishOperation(ctx, raw, cmd, rid, op, targets, steps)
}
func remoteMissing(e error) bool { var h *httpx.Error; return errors.As(e, &h) && h.Status == 404 }

type observation struct {
	Reason string       `json:"reason,omitempty"`
	SHA    string       `json:"sha,omitempty"`
	MR     *i.ReleaseMR `json:"mr,omitempty"`
	Actor  *i.GitActor  `json:"git_user,omitempty"`
}

func dispatchGit(ctx context.Context, t gitTarget, kind string, in gitIntent) (string, observation) {
	remote := t.Git
	var e error
	var obs observation
	switch kind {
	case "tag":
		got, err := remote.Tag(ctx, in.Ref)
		if err == nil {
			if got == in.SHA {
				return "succeeded", observation{SHA: got}
			}
			return "failed", observation{Reason: "tag_conflict"}
		}
		if !remoteMissing(err) {
			return "failed", observation{Reason: "preflight_failed"}
		}
		e = remote.CreateTag(ctx, in.Ref, in.SHA)
	case "merge":
		mr, err := remote.MR(ctx, in.IID)
		if err != nil || mr.Head != in.SHA || mr.Target != in.Branch {
			return "failed", observation{Reason: "mr_changed"}
		}
		if mr.State == "merged" {
			return "succeeded", observation{MR: &mr}
		}
		e = remote.Merge(ctx, in.IID, in.SHA)
	case "revert_branch":
		e = remote.CreateRevertBranch(ctx, in.Ref, in.SHA)
	case "revert_commit":
		head, err := remote.Head(ctx, in.Ref)
		if err != nil || head != in.Parent {
			return "failed", observation{Reason: "revert_branch_changed"}
		}
		var sha string
		sha, e = remote.RevertCommit(ctx, in.Ref, in.SHA)
		if e == nil {
			return "succeeded", observation{SHA: sha}
		}
	case "revert_mr":
		var m i.ReleaseMR
		m, e = remote.CreateRevertMR(ctx, in.Ref, in.Branch, "回退 "+in.SHA)
		if e == nil && m.IID != 0 && m.Target == in.Branch && m.Source == in.Ref {
			return "succeeded", observation{MR: &m}
		}
	default:
		return "failed", observation{Reason: "invalid_action"}
	}
	if status, o := observeGit(ctx, t, kind, in); status == "succeeded" {
		return status, o
	}
	if e != nil {
		var h *httpx.Error
		if errors.As(e, &h) {
			obs.Reason = h.Code
			if h.Status >= 400 && h.Status < 500 {
				return "failed", obs
			}
		}
	}
	if obs.Reason == "" {
		obs.Reason = "result_unconfirmed"
	}
	return "unknown", obs
}
func observeGit(ctx context.Context, t gitTarget, kind string, in gitIntent) (string, observation) {
	switch kind {
	case "tag":
		if got, e := t.Git.Tag(ctx, in.Ref); e == nil {
			if got == in.SHA {
				return "succeeded", observation{SHA: got}
			}
			return "failed", observation{Reason: "tag_conflict"}
		}
	case "merge":
		if m, e := t.Git.MR(ctx, in.IID); e == nil && m.Head == in.SHA && m.State == "merged" && m.Target == in.Branch {
			return "succeeded", observation{MR: &m}
		}
	case "revert_branch":
		if got, e := t.Git.Head(ctx, in.Ref); e == nil && got == in.SHA {
			return "succeeded", observation{SHA: got}
		}
	case "revert_commit":
		if got, ok := t.Git.VerifyRevert(ctx, in.Ref, in.SHA, in.Parent); ok {
			return "succeeded", observation{SHA: got}
		}
	case "revert_mr":
		if m, e := t.Git.FindRevertMR(ctx, in.Ref, in.Branch); e == nil && m.IID != 0 {
			return "succeeded", observation{MR: &m}
		}
	}
	return "unknown", observation{Reason: "result_unconfirmed"}
}
func (x *releaseContext) applyObserved(in gitIntent, step Step, obs observation) error {
	if obs.MR == nil {
		return nil
	}
	v := ReleaseChange{Repo: step.Repo, Ref: strconv.FormatUint(obs.MR.IID, 10), Kind: "mr", Evidence: jsonData(obs.MR), Status: "included"}
	if step.Kind == "merge" {
		rows, e := x.store.ReleaseChanges(x.release.ID)
		if e != nil {
			return e
		}
		for _, old := range rows {
			if old.ID == in.Change {
				old.Status = "included"
				old.Evidence = v.Evidence
				return x.store.SaveChange(x.release.ID, x.auth.User.ID, &old)
			}
		}
		return notFound()
	}
	v.Status = "selected"
	if e := x.store.SaveChange(x.release.ID, x.auth.User.ID, &v); e != nil {
		return e
	}
	return x.linkRevert(in.Change, v)
}
func (s *Service) finishOperation(ctx context.Context, raw string, cmd Command, rid uint64, op Operation, targets map[uint64]gitTarget, steps []Step) (i.Result, *identity.Auth, error) {
	var out i.Result
	status := "succeeded"
	if op.Kind == "archive" {
		for _, step := range steps {
			var in gitIntent
			if e := json.Unmarshal(step.Intent, &in); e != nil {
				return out, nil, e
			}
			if state, _ := observeGit(ctx, targets[step.Repo], step.Kind, in); state != "succeeded" {
				status = "failed"
				break
			}
		}
	}
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, true, func(x *releaseContext) error {
		if e := x.store.EndOperation(op.ID, status); e != nil {
			return e
		}
		if op.Kind == "archive" && status == "succeeded" {
			if e := x.state("tagging"); e != nil {
				return e
			}
			x.release.Status = "archived"
			if e := x.store.ActiveRelease(x.release, false); e != nil {
				return e
			}
		}
		if e := x.touch(cmd, op.Kind+"_finished", map[string]any{"operation_id": op.ID, "status": status}); e != nil {
			return e
		}
		out.Data = map[string]any{"id": fmt.Sprint(op.ID), "status": status}
		return nil
	})
	return out, a, e
}
func (s *Service) ReconcileRelease(ctx context.Context, raw string, cmd Command, rid uint64, w FlowWrite) (i.Result, *identity.Auth, error) {
	var op Operation
	var steps []Step
	targets := map[uint64]gitTarget{}
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		rows, e := x.store.Operations(rid)
		if e != nil {
			return e
		}
		if len(rows) == 0 || rows[0].ID != w.Operation {
			return notFound()
		}
		op = rows[0]
		if op.Status != "running" && op.Status != "unknown" {
			return changed()
		}
		steps, e = x.store.Steps(op.ID)
		if e != nil {
			return e
		}
		for _, step := range steps {
			if op.Status == "running" && time.Since(step.Updated) < 2*time.Minute {
				return releaseBlocked("操作仍在执行，请稍后核实")
			}
			t, e := x.target(s, step.Repo)
			if e != nil {
				return e
			}
			targets[step.Repo] = t
		}
		return nil
	})
	if e != nil {
		return out, a, e
	}
	for _, step := range steps {
		if step.Status == "succeeded" {
			continue
		}
		status := "failed"
		obs := observation{Reason: "not_dispatched"}
		var in gitIntent
		if e = json.Unmarshal(step.Intent, &in); e != nil {
			return out, a, e
		}
		if step.Status != "pending" {
			status, obs = observeGit(ctx, targets[step.Repo], step.Kind, in)
		}
		if status == "unknown" && step.Status == "unknown" {
			return i.Result{Data: map[string]string{"status": "unknown"}}, a, nil
		}
		_, e = s.releaseAccess(ctx, raw, cmd, rid, false, true, func(x *releaseContext) error {
			if e := x.store.StepResult(op.ID, step.ID, step.Status, status, jsonData(obs)); e != nil {
				return e
			}
			if status == "succeeded" {
				return x.applyObserved(in, step, obs)
			}
			return x.store.EndOperation(op.ID, status)
		})
		if e != nil {
			return out, a, e
		}
		if status != "succeeded" {
			return i.Result{Data: map[string]string{"status": status}}, a, nil
		}
	}
	return s.finishOperation(ctx, raw, cmd, rid, op, targets, steps)
}
