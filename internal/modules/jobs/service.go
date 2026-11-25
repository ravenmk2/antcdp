package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/jobcore"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

func repository(tx identity.Tx) (Repository, error) {
	v, ok := tx.(interface{ Jobs() Repository })
	if !ok {
		return nil, httpx.E(503, "FEATURE_UNAVAILABLE", "作业服务暂不可用")
	}
	return v.Jobs(), nil
}
func projectAccess(tx identity.Tx, project, user uint64) (*collaboration.Resource, error) {
	r, ok := tx.(collaboration.Repository)
	if !ok {
		return nil, httpx.E(503, "FEATURE_UNAVAILABLE", "项目服务暂不可用")
	}
	p, err := r.Resource(collaboration.Project, project, user)
	if err != nil {
		return nil, err
	}
	if p == nil || !p.IsMember {
		return nil, httpx.E(404, "NOT_FOUND", "项目不存在或不可见")
	}
	return p, nil
}
func missing() error   { return httpx.E(404, "NOT_FOUND", "作业对象不存在或不可见") }
func forbidden() error { return httpx.E(403, "FORBIDDEN", "没有此操作权限") }
func (s *Service) access(ctx context.Context, raw string, project, job uint64, manage bool, fn func(identity.Tx, Repository, *identity.Auth, *Job, *collaboration.Resource) error) (*identity.Auth, error) {
	return s.accessAccount(ctx, raw, project, job, manage, 0, fn)
}
func (s *Service) accessAccount(ctx context.Context, raw string, project, job uint64, manage bool, account uint64, fn func(identity.Tx, Repository, *identity.Auth, *Job, *collaboration.Resource) error) (*identity.Auth, error) {
	var discover func(identity.Tx) ([]uint64, error)
	if account != 0 {
		discover = func(identity.Tx) ([]uint64, error) { return []uint64{account}, nil }
	}
	return s.Identity.BusinessAccess(ctx, raw, discover, func(tx identity.Tx, a *identity.Auth) error {
		if account != 0 {
			if err := tx.(collaboration.Repository).LockCollaboration(collaboration.Project, project, 0); err != nil {
				return err
			}
		}
		p, err := projectAccess(tx, project, a.User.ID)
		if err != nil {
			return err
		}
		admin := p.Role == "admin" || a.User.Role == "admin"
		if manage && !admin {
			return forbidden()
		}
		if manage && p.EndedAt != nil {
			return httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
		}
		repo, err := repository(tx)
		if err != nil {
			return err
		}
		var j *Job
		if job != 0 {
			j, err = repo.Job(job)
			if err != nil {
				return err
			}
			if j == nil || j.ProjectID != project || j.ScopeKind != "project" {
				return missing()
			}
			j.CanManage = admin
			j.CanRun = admin
			if !admin {
				j.CanRun, err = repo.RunAllowed(j.ID, a.User.ID)
				if err != nil {
					return err
				}
			}
		}
		return fn(tx, repo, a, j, p)
	})
}
func (s *Service) List(ctx context.Context, raw string, project uint64, filter Filter) ([]Job, *identity.Auth, error) {
	out := []Job{}
	a, err := s.access(ctx, raw, project, 0, false, func(_ identity.Tx, r Repository, a *identity.Auth, _ *Job, p *collaboration.Resource) error {
		var err error
		out, err = r.Jobs(project, filter)
		if err != nil {
			return err
		}
		for i := range out {
			out[i].CanManage = p.Role == "admin" || a.User.Role == "admin"
			out[i].CanRun = out[i].CanManage
			if !out[i].CanRun {
				out[i].CanRun, err = r.RunAllowed(out[i].ID, a.User.ID)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	return out, a, err
}
func detail(r Repository, j *Job) (Detail, error) {
	out := Detail{Job: j, Parameters: []Parameter{}}
	if j.RevisionID != nil {
		rev, err := r.Revision(*j.RevisionID)
		if err != nil {
			return out, err
		}
		if rev == nil {
			return out, missing()
		}
		out.Parameters = rev.Parameters
		if j.CanManage {
			out.Config = &rev.Config
		}
	}
	if j.CanManage {
		var err error
		out.Grants, err = r.Grants(j.ID)
		if err != nil {
			return out, err
		}
	}
	return out, nil
}
func (s *Service) Get(ctx context.Context, raw string, project, job uint64) (Detail, *identity.Auth, error) {
	var out Detail
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, _ *identity.Auth, j *Job, _ *collaboration.Resource) error {
		var e error
		out, e = detail(r, j)
		return e
	})
	return out, a, err
}

func (s *Service) configure(tx identity.Tx, r Repository, j *Job, actor uint64, c Config) (*Revision, error) {
	if c.RunAsUserID == 0 {
		return nil, httpx.Invalid("run_as_user_id", "required")
	}
	if _, err := collaboration.AutomationProject(tx, j.ProjectID, c.RunAsUserID); err != nil {
		return nil, err
	}
	normalize(&c)
	if err := validateConfig(c); err != nil {
		return nil, err
	}
	if err := s.Executor.Validate(c.Script); err != nil {
		return nil, httpx.E(422, "INVALID_SCRIPT", err.Error())
	}
	digest, err := hash(c)
	if err != nil {
		return nil, err
	}
	rev := &Revision{JobID: j.ID, Config: c, Hash: digest, Creator: actor, CreatedAt: now()}
	if err = r.SaveRevision(rev); err != nil {
		return nil, err
	}
	return rev, nil
}
func (s *Service) Save(ctx context.Context, raw string, project, job uint64, w Write) (Detail, *identity.Auth, error) {
	var out Detail
	if strings.TrimSpace(w.Name) == "" || utf8.RuneCountInString(w.Name) > 100 || utf8.RuneCountInString(w.Description) > 1000 {
		return out, nil, httpx.Invalid("name", "invalid_length")
	}
	if w.MaxConcurrency == 0 || w.TimeoutMS == 0 || w.TimeoutMS > 9223372036854 || (w.BusyPolicy != "queue" && w.BusyPolicy != "skip") {
		return out, nil, httpx.Invalid("execution", "invalid_settings")
	}
	a, err := s.accessAccount(ctx, raw, project, job, true, w.Config.accountID(), func(tx identity.Tx, r Repository, a *identity.Auth, j *Job, _ *collaboration.Resource) error {
		created := j == nil
		wasEnabled := false
		if created {
			if !resourcecode.Valid(w.Code) {
				return httpx.Invalid("code", "invalid_format")
			}
			j = &Job{Code: w.Code, ProjectID: project, ScopeKind: "project", Creator: a.User.ID, CreatedAt: now(), Version: 1}
		} else {
			if err := version(w.Version, j.Version); err != nil {
				return err
			}
			if w.Code != "" && w.Code != j.Code {
				return httpx.Invalid("code", "immutable")
			}
			wasEnabled = j.Enabled
			j.Version++
		}
		j.Name = strings.TrimSpace(w.Name)
		j.Description = w.Description
		j.Enabled = w.Enabled
		j.MaxConcurrency = w.MaxConcurrency
		j.BusyPolicy = w.BusyPolicy
		j.TimeoutMS = w.TimeoutMS
		j.UpdatedAt = now()
		j.CanManage = true
		j.CanRun = true
		if created {
			if err := r.SaveJob(j); err != nil {
				return err
			}
		}
		if w.Config != nil {
			rev, err := s.configure(tx, r, j, a.User.ID, *w.Config)
			if err != nil {
				return err
			}
			j.RevisionID = &rev.ID
		}
		if j.Enabled && j.RevisionID == nil {
			return httpx.Invalid("config", "required")
		}
		previousGrants, err := r.Grants(j.ID)
		if err != nil {
			return err
		}
		if err := validateGrants(tx, project, w.Grants, previousGrants); err != nil {
			return err
		}
		if err := r.SetGrants(j.ID, a.User.ID, w.Grants); err != nil {
			return err
		}
		if err := r.SaveJob(j); err != nil {
			return err
		}
		if !j.Enabled {
			active, err := r.Active(j.ID)
			if err != nil {
				return err
			}
			for i := range active {
				v := &active[i]
				if v.Status == "queued" && v.Trigger != "debug" {
					if err = finish(r, v, "cancelled", "JOB_DISABLED", "作业已停用"); err != nil {
						return err
					}
				}
			}
		}
		if wasEnabled != j.Enabled {
			zone, err := r.ScheduleTimezone()
			if err != nil {
				return err
			}
			plans, err := r.Schedules(j.ID)
			if err != nil {
				return err
			}
			for i := range plans {
				plan := &plans[i]
				plan.Next = nil
				if j.Enabled && plan.Enabled {
					err = resumePlan(r, plan, zone, now())
					if err != nil {
						return err
					}
				}
				if err = r.SaveSchedule(plan); err != nil {
					return err
				}
			}
		}
		out, err = detail(r, j)
		if err != nil {
			return err
		}
		return audit(tx, a, j, "saved")
	})
	return out, a, err
}
func validateGrants(tx identity.Tx, project uint64, grants, previous []Grant) error {
	r, ok := tx.(collaboration.Repository)
	if !ok {
		return forbidden()
	}
	seen := map[string]bool{}
	for _, g := range grants {
		key := fmt.Sprint(g.Kind, "/", g.ID)
		if seen[key] {
			return httpx.Invalid("grants", "duplicate")
		}
		seen[key] = true
		// Membership is always rechecked when starting. Keeping an existing
		// grant must not prevent editing a job after that member leaves.
		retained := false
		for _, old := range previous {
			if old == g {
				retained = true
				break
			}
		}
		if retained {
			continue
		}
		switch g.Kind {
		case "user":
			p, err := r.Resource(collaboration.Project, project, g.ID)
			if err != nil {
				return err
			}
			if p == nil || !p.IsMember {
				return httpx.Invalid("grants", "not_project_member")
			}
		case "role":
			role, err := r.Role(collaboration.Project, project, g.ID)
			if err != nil {
				return err
			}
			if role == nil {
				return httpx.Invalid("grants", "not_project_role")
			}
		default:
			return httpx.Invalid("grants", "invalid_kind")
		}
	}
	return nil
}
func audit(tx identity.Tx, a *identity.Auth, j *Job, action string) error {
	id := fmt.Sprint(j.ID)
	return tx.Audit(identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: "job." + action, TargetType: "job", TargetID: &id, TargetLabel: j.Name, OccurredAt: now(), Detail: safeJSON(map[string]string{"project_id": fmt.Sprint(j.ProjectID)})})
}
func finish(r Repository, v *Run, status, code, message string) error {
	v.Status = status
	v.ErrorCode = code
	v.ErrorSummary = cut(message, 8192)
	v.FinishedAt = ptr(now())
	label := map[string]string{"succeeded": "运行成功", "failed": "运行失败", "cancelled": "运行已取消", "timed_out": "运行超时"}[status]
	level := "info"
	if status == "failed" || status == "timed_out" {
		level = "error"
	}
	return r.AppendLog(v, &Log{Kind: "execution", Level: level, Message: label, Fields: safeJSON(map[string]string{"code": code, "summary": v.ErrorSummary})})
}

func (s *Service) Start(ctx context.Context, raw string, project, job uint64, w Start, debug bool) (Receipt, *identity.Auth, error) {
	var out Receipt
	if !requestKey.MatchString(w.RequestKey) {
		return out, nil, httpx.Invalid("request_key", "invalid")
	}
	trigger := "manual"
	if debug {
		trigger = "debug"
	}
	digest, err := hash(struct {
		Start   Start
		Trigger string
	}{w, trigger})
	if err != nil {
		return out, nil, err
	}
	a, err := s.accessAccount(ctx, raw, project, job, false, w.Config.accountID(), func(tx identity.Tx, r Repository, a *identity.Auth, j *Job, p *collaboration.Resource) error {
		prior, err := r.Receipt(job, a.User.ID, w.RequestKey)
		if err != nil {
			return err
		}
		if prior != nil {
			if prior.Hash != digest {
				return httpx.E(409, "REQUEST_CONFLICT", "同一请求标识的内容不同")
			}
			out = *prior
			return nil
		}
		if p.EndedAt != nil {
			return httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
		}
		if debug && !j.CanManage || !debug && !j.CanRun {
			return forbidden()
		}
		out = Receipt{JobID: job, Actor: a.User.ID, Key: w.RequestKey, Hash: digest, Trigger: trigger, At: now()}
		reject := func(code string) error { out.Outcome = "rejected"; out.Reason = code; return r.SaveReceipt(&out) }
		if !debug && !j.Enabled {
			return reject("JOB_DISABLED")
		}
		if w.TimeoutMS > 9223372036854 {
			return httpx.Invalid("timeout_ms", "invalid")
		}
		if !debug && (w.Config != nil || w.StateMode != "" || w.TimeoutMS != 0) {
			return httpx.Invalid("debug_options", "not_manual")
		}
		var rev *Revision
		if debug && w.Config != nil {
			rev, err = s.configure(tx, r, j, a.User.ID, *w.Config)
		} else if j.RevisionID != nil {
			rev, err = r.Revision(*j.RevisionID)
		}
		if err != nil {
			return err
		}
		if rev == nil {
			return reject("NO_CONFIGURATION")
		}
		values, err := inputs(rev.Config, w.Inputs)
		if err != nil {
			return reject("INVALID_INPUTS")
		}
		if w.RerunOf != nil {
			previous, err := r.Run(*w.RerunOf)
			if err != nil {
				return err
			}
			if previous == nil || previous.JobID != job {
				return missing()
			}
		}
		mode := "default"
		timeout := j.TimeoutMS
		if debug {
			mode = w.StateMode
			if mode == "" {
				mode = "debug"
			}
			if mode != "debug" && mode != "default" {
				return httpx.Invalid("state_mode", "invalid")
			}
			if w.TimeoutMS > 0 {
				timeout = w.TimeoutMS
			}
		}
		v := &Run{RunAsUserID: rev.RunAsUserID, JobID: job, RevisionID: rev.ID, Trigger: trigger, Actor: &a.User.ID, TriggerContext: json.RawMessage(`{}`), Inputs: values, TimeoutMS: timeout, StateMode: mode, RerunOf: w.RerunOf, Status: "queued", QueuedAt: now()}
		accepted, err := admit(r, j, v)
		if err != nil {
			return err
		}
		if accepted {
			out.Outcome = "accepted"
			out.RunID = &v.ID
		} else {
			out.Outcome = "skipped"
			out.Reason = "JOB_BUSY"
		}
		return r.SaveReceipt(&out)
	})
	return out, a, err
}
func admit(r Repository, j *Job, v *Run) (bool, error) {
	active, err := r.Active(j.ID)
	if err != nil {
		return false, err
	}
	if j.BusyPolicy == "skip" && uint64(len(active)) >= uint64(j.MaxConcurrency) {
		return false, nil
	}
	if err = r.SaveRun(v); err != nil {
		return false, err
	}
	return true, r.AppendLog(v, &Log{Kind: "execution", Level: "info", Message: "运行已受理"})
}

func (s *Service) History(ctx context.Context, raw string, project, job, before uint64) ([]Run, *identity.Auth, error) {
	var out []Run
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *Job, _ *collaboration.Resource) error {
		var err error
		out, err = r.Runs(job, before)
		return err
	})
	return out, a, err
}

type Observation struct {
	Run       *Run   `json:"run"`
	Logs      []Log  `json:"logs"`
	Calls     []Call `json:"calls"`
	CanCancel bool   `json:"can_cancel"`
}

func (s *Service) Observe(ctx context.Context, raw string, project, job, run, after uint64) (Observation, *identity.Auth, error) {
	var out Observation
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, actor *identity.Auth, j *Job, _ *collaboration.Resource) error {
		var err error
		out.Run, err = r.Run(run)
		if err != nil {
			return err
		}
		if out.Run == nil || out.Run.JobID != job {
			return missing()
		}
		out.CanCancel = j.CanManage || (j.CanRun && out.Run.Trigger == "manual" && out.Run.Actor != nil && *out.Run.Actor == actor.User.ID)
		out.Logs, err = r.Logs(run, after)
		if err != nil {
			return err
		}
		through := after
		if len(out.Logs) > 0 {
			through = out.Logs[len(out.Logs)-1].Seq
		}
		out.Calls, err = r.CallsForLogs(run, after, through)
		if !j.CanManage {
			for i := range out.Calls {
				out.Calls[i].ConfiguredCredential = nil
				out.Calls[i].Credential = nil
				out.Calls[i].CredentialVersion = nil
				out.Calls[i].RobotVersion = nil
			}
		}
		return err
	})
	return out, a, err
}
func (s *Service) Cancel(ctx context.Context, raw string, project, job, run uint64) (*Run, *identity.Auth, error) {
	var out *Run
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, a *identity.Auth, j *Job, _ *collaboration.Resource) error {
		var err error
		out, err = r.Run(run)
		if err != nil {
			return err
		}
		if out == nil || out.JobID != job {
			return missing()
		}
		if !j.CanManage && (!j.CanRun || out.Trigger != "manual" || out.Actor == nil || *out.Actor != a.User.ID) {
			return forbidden()
		}
		if out.Terminal() || out.Status == "cancelling" || out.Status == "stopping" {
			return nil
		}
		out.StopActor = &a.User.ID
		out.StopAt = ptr(now())
		out.StopReason = "USER_CANCELLED"
		if out.Status == "queued" {
			return finish(r, out, "cancelled", "USER_CANCELLED", "用户取消")
		}
		out.Status = "cancelling"
		return r.AppendLog(out, &Log{Kind: "execution", Level: "info", Message: "已请求取消，正在停止本地执行"})
	})
	return out, a, err
}
func (s *Service) Receipts(ctx context.Context, raw string, project, job, before uint64) ([]Receipt, *identity.Auth, error) {
	var out []Receipt
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *Job, _ *collaboration.Resource) error {
		var err error
		out, err = r.Receipts(job, before)
		return err
	})
	return out, a, err
}
func (s *Service) ClearDebug(ctx context.Context, raw string, project, job uint64) (*identity.Auth, error) {
	return s.access(ctx, raw, project, job, true, func(_ identity.Tx, r Repository, _ *identity.Auth, j *Job, _ *collaboration.Resource) error {
		active, err := r.Active(j.ID)
		if err != nil {
			return err
		}
		for _, run := range active {
			if run.StateMode == "debug" {
				return httpx.E(409, "STATE_IN_USE", "仍有使用调试状态的运行")
			}
		}
		backend, err := s.State()
		if err != nil {
			return err
		}
		info, _, err := backend.OpenStore(ctx, fmt.Sprintf("job:%d", job), "debug")
		if err != nil {
			return err
		}
		return backend.DeleteStore(ctx, info.ID)
	})
}

func errorCode(err error) string {
	var e *jobcore.Error
	if errors.As(err, &e) {
		return e.Code
	}
	var h *httpx.Error
	if errors.As(err, &h) {
		return h.Code
	}
	return "EXECUTION_ERROR"
}
