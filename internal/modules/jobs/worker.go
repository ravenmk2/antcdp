package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/jobcore"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) transaction(ctx context.Context, fn func(identity.Tx, Repository) error) error {
	store, err := s.Store()
	if err != nil {
		return err
	}
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, err := repository(tx)
		if err != nil {
			return err
		}
		return fn(tx, r)
	})
}

// Work must have exactly one owner per application instance. Startup recovery
// completes before scheduling or claiming any queued run.
func (s *Service) Work(ctx context.Context, logger *slog.Logger) {
	type activity struct {
		job    uint64
		cancel context.CancelFunc
	}
	active := map[uint64]activity{}
	done := make(chan uint64, 64)
	var workers sync.WaitGroup
	defer func() {
		for _, a := range active {
			a.cancel()
		}
		workers.Wait()
	}()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	recovered := false
	var lastError time.Time
	report := func(err error) {
		if err != nil && ctx.Err() == nil && time.Since(lastError) > 10*time.Second {
			logger.Error("job worker failed", "error", err)
			lastError = time.Now()
		}
	}
	for {
		if ctx.Err() != nil {
			return
		}
		if !recovered {
			if err := s.recover(ctx); err != nil {
				report(err)
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					continue
				}
			}
			recovered = true
		}
		for id, a := range active {
			var stop bool
			err := s.transaction(ctx, func(_ identity.Tx, r Repository) error {
				if _, err := r.Job(a.job); err != nil {
					return err
				}
				run, err := r.Run(id)
				if err != nil {
					return err
				}
				stop = run == nil || run.Status != "running"
				return nil
			})
			report(err)
			if err == nil && stop {
				a.cancel()
			}
		}
		var ids []uint64
		err := s.transaction(ctx, func(_ identity.Tx, r Repository) error { var e error; ids, e = r.WorkJobs(); return e })
		report(err)
		for _, id := range ids {
			started := []Run{}
			err = s.transaction(ctx, func(tx identity.Tx, r Repository) error {
				started = nil
				// HTTP access locks the actor before the job. Claims use the same
				// order; actors newly queued after this read wait until the next scan.
				actors, e := r.QueuedActors(id)
				if e != nil {
					return e
				}
				users, e := tx.LockUsers(actors)
				if e != nil {
					return e
				}
				locked := map[uint64]bool{}
				for _, actor := range actors {
					locked[actor] = true
				}
				j, e := r.Job(id)
				if e != nil {
					return e
				}
				if j == nil {
					return nil
				}
				// An archived project cannot admit scheduled work.
				project, e := tx.(collaboration.Repository).Resource(collaboration.Project, j.ProjectID, 0)
				if e != nil {
					return e
				}
				plans, e := r.Schedules(id)
				if e != nil {
					return e
				}
				at := now()
				for i := range plans {
					plan := &plans[i]
					if plan.Enabled && plan.Next != nil && !plan.Next.After(at) {
						if project == nil || project.EndedAt != nil {
							plan.Next = nil
							if e = r.SaveSchedule(plan); e != nil {
								return e
							}
							continue
						}
						if e = s.fire(r, j, plan, at); e != nil {
							return e
						}
					}
				}
				runs, e := r.Active(id)
				if e != nil {
					return e
				}
				count := uint64(0)
				for _, v := range runs {
					if v.Status != "queued" {
						count++
					}
				}
				for i := range runs {
					v := &runs[i]
					if v.Status != "queued" {
						continue
					}
					var actor *identity.User
					if v.Actor != nil {
						if !locked[*v.Actor] {
							break
						}
						actor = users[*v.Actor]
					}
					allowed, e := s.startAllowed(tx, r, j, v, actor)
					if e != nil {
						return e
					}
					if !allowed {
						if e = finish(r, v, "cancelled", "START_NOT_ALLOWED", "启动资格已失效"); e != nil {
							return e
						}
						continue
					}
					if count >= uint64(j.MaxConcurrency) {
						continue
					}
					v.Status = "running"
					v.StartedAt = ptr(at)
					if e = r.AppendLog(v, &Log{Kind: "execution", Level: "info", Message: "运行开始"}); e != nil {
						return e
					}
					started = append(started, *v)
					count++
				}
				return nil
			})
			report(err)
			if err != nil {
				continue
			}
			for _, run := range started {
				work, cancel := context.WithCancel(ctx)
				active[run.ID] = activity{id, cancel}
				workers.Go(func() {
					defer cancel()
					s.execute(work, ctx, run, logger)
					select {
					case done <- run.ID:
					case <-ctx.Done():
					}
				})
			}
		}
		select {
		case <-ctx.Done():
			return
		case id := <-done:
			delete(active, id)
		case <-ticker.C:
		}
	}
}
func (s *Service) startAllowed(tx identity.Tx, r Repository, j *Job, v *Run, u *identity.User) (bool, error) {
	if !j.Enabled && v.Trigger != "debug" {
		return false, nil
	}
	if v.Trigger == "schedule" {
		p, err := tx.(collaboration.Repository).Resource(collaboration.Project, j.ProjectID, 0)
		return p != nil && p.EndedAt == nil, err
	}
	if v.Actor == nil {
		return false, nil
	}
	if u == nil || u.Status != "active" || u.DeletedAt != nil {
		return false, nil
	}
	p, err := projectAccess(tx, j.ProjectID, *v.Actor)
	if err != nil {
		var e *httpx.Error
		if errors.As(err, &e) && e.Code == "NOT_FOUND" {
			return false, nil
		}
		return false, err
	}
	if p.EndedAt != nil {
		return false, nil
	}
	admin := p.Role == "admin" || u.Role == "admin"
	if v.Trigger == "debug" {
		return admin, nil
	}
	if admin {
		return true, nil
	}
	return r.RunAllowed(j.ID, *v.Actor)
}
func (s *Service) recover(ctx context.Context) error {
	baseline := now()
	var ids []uint64
	if err := s.transaction(ctx, func(_ identity.Tx, r Repository) error { var err error; ids, err = r.RecoveryJobs(); return err }); err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.transaction(ctx, func(tx identity.Tx, r Repository) error {
			j, err := r.Job(id)
			if err != nil || j == nil {
				return err
			}
			runs, err := r.Active(id)
			if err != nil {
				return err
			}
			for i := range runs {
				v := &runs[i]
				if v.Status != "queued" {
					if err = settlePending(r, v); err != nil {
						return err
					}
					if err = finish(r, v, "failed", "SERVICE_INTERRUPTED", "服务中断，运行未自动重试"); err != nil {
						return err
					}
				}
			}
			plans, err := r.Schedules(id)
			if err != nil {
				return err
			}
			for i := range plans {
				p := &plans[i]
				if !p.Enabled || p.Next == nil || p.Next.After(baseline) {
					continue
				}
				old := p.Next
				p.Next = nil
				if j.Enabled {
					p.Next, err = nextTime(*p, baseline)
					if err != nil {
						return err
					}
				}
				if err = r.SaveSchedule(p); err != nil {
					return err
				}
				target := fmt.Sprint(id)
				if err = tx.Audit(identity.Event{ActorType: "system", ActorName: "Job scheduler", Action: "job.schedule_missed", TargetType: "job", TargetID: &target, TargetLabel: j.Name, OccurredAt: baseline, Detail: safeJSON(map[string]any{"schedule_id": fmt.Sprint(p.ID), "from": old, "recovered_at": baseline, "next": p.Next})}); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}
func settlePending(r Repository, run *Run) error {
	calls, err := r.Calls(run.ID)
	if err != nil {
		return err
	}
	for i := range calls {
		c := &calls[i]
		if c.Outcome != "pending" {
			continue
		}
		c.Outcome = "unknown"
		c.ErrorCode = "RESOURCE_RESULT_UNKNOWN"
		c.FinishedAt = ptr(now())
		if err = r.SaveCall(c); err != nil {
			return err
		}
		if err = r.AppendLog(run, &Log{Kind: "resource", Level: "warn", Message: "资源调用结果未知", CallID: &c.ID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) execute(ctx, lifecycle context.Context, run Run, logger *slog.Logger) {
	deadline := run.StartedAt.Add(time.Duration(run.TimeoutMS) * time.Millisecond)
	work, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	var revision *Revision
	var job *Job
	err := s.transaction(work, func(_ identity.Tx, r Repository) error {
		var e error
		job, e = r.Job(run.JobID)
		if e != nil {
			return e
		}
		revision, e = r.Revision(run.RevisionID)
		return e
	})
	result := jobcore.Result{}
	if err == nil && (revision == nil || job == nil) {
		err = missing()
	}
	if err == nil {
		var values any
		err = json.Unmarshal(run.Inputs, &values)
		if err == nil {
			backend, e := s.State()
			err = e
			if e == nil {
				info, kv, e := backend.OpenStore(work, fmt.Sprintf("job:%d", run.JobID), run.StateMode)
				err = e
				if e == nil {
					err = s.transaction(work, func(_ identity.Tx, r Repository) error {
						if _, e := r.Job(run.JobID); e != nil {
							return e
						}
						current, e := r.Run(run.ID)
						if e != nil {
							return e
						}
						if current == nil || current.Status != "running" {
							return jobcore.Failure("RUN_STOPPING", "运行正在停止")
						}
						current.StateStoreID = ptr(uint64(info.ID))
						return r.SaveRun(current)
					})
				}
				if err == nil {
					host := &runHost{s: s, job: *job, run: run, revision: *revision, kv: kv}
					var actor any
					if run.Actor != nil {
						actor = fmt.Sprint(*run.Actor)
					}
					result, err = s.Executor.Execute(work, jobcore.Input{Script: revision.Script, Inputs: values, Run: map[string]any{"id": fmt.Sprint(run.ID), "jobId": fmt.Sprint(run.JobID), "revisionId": fmt.Sprint(run.RevisionID), "triggerKind": run.Trigger, "actorUserId": actor, "triggerContext": run.TriggerContext, "stateMode": run.StateMode}, OnStopping: func(cause error) {
						code := errorCode(cause)
						if errors.Is(work.Err(), context.DeadlineExceeded) {
							code = "RUN_TIMEOUT"
						} else if ctx.Err() != nil {
							code = "SERVICE_INTERRUPTED"
						}
						if stopErr := s.stopping(run, code, cause.Error()); stopErr != nil {
							logger.Error("job stop intent failed", "run_id", run.ID, "error", stopErr)
						}
					}}, host)
				}
			}
		}
	}
	for {
		persist, stop := context.WithTimeout(context.Background(), 10*time.Second)
		finalErr := s.transaction(persist, func(_ identity.Tx, r Repository) error {
			if _, e := r.Job(run.JobID); e != nil {
				return e
			}
			v, e := r.Run(run.ID)
			if e != nil || v == nil {
				return e
			}
			if v.Terminal() {
				return nil
			}
			if e = settlePending(r, v); e != nil {
				return e
			}
			if v.Status == "cancelling" {
				return finish(r, v, "cancelled", "USER_CANCELLED", "用户取消")
			}
			if v.Status == "stopping" {
				status := "failed"
				if v.StopReason == "RUN_TIMEOUT" {
					status = "timed_out"
				}
				return finish(r, v, status, v.StopReason, v.ErrorSummary)
			}
			if errors.Is(work.Err(), context.DeadlineExceeded) {
				return finish(r, v, "timed_out", "RUN_TIMEOUT", "运行超时")
			}
			if ctx.Err() != nil {
				return finish(r, v, "failed", "SERVICE_INTERRUPTED", "服务中断")
			}
			if err != nil {
				return finish(r, v, "failed", errorCode(err), err.Error())
			}
			v.Result = result.Value
			v.HasResult = result.HasValue
			return finish(r, v, "succeeded", "", "")
		})
		stop()
		if finalErr == nil {
			return
		}
		logger.Error("job finalization failed; retaining concurrency slot", "run_id", run.ID, "error", finalErr)
		select {
		case <-lifecycle.Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (s *Service) stopping(run Run, code, message string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.transaction(ctx, func(_ identity.Tx, r Repository) error {
		if _, err := r.Job(run.JobID); err != nil {
			return err
		}
		current, err := r.Run(run.ID)
		if err != nil {
			return err
		}
		if current == nil || current.Status != "running" {
			return nil
		}
		current.Status = "stopping"
		current.StopReason = code
		current.ErrorCode = code
		current.ErrorSummary = cut(message, 8192)
		return r.AppendLog(current, &Log{Kind: "execution", Level: "warn", Message: "正在停止执行并等待本地调用收尾", Fields: safeJSON(map[string]string{"code": code})})
	})
}
