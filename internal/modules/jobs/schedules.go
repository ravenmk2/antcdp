package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) Schedules(ctx context.Context, raw string, project, job uint64) ([]Schedule, *identity.Auth, error) {
	var out []Schedule
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *Job, _ *collaboration.Resource) error {
		var err error
		out, err = r.Schedules(job)
		return err
	})
	return out, a, err
}
func (s *Service) SaveSchedule(ctx context.Context, raw string, project, job, id uint64, w Schedule) (Schedule, *identity.Auth, error) {
	var out Schedule
	if strings.TrimSpace(w.Name) == "" || utf8.RuneCountInString(w.Name) > 100 {
		return out, nil, httpx.Invalid("name", "required")
	}
	if w.Timezone == "" {
		w.Timezone = "UTC"
	}
	next, err := nextTime(w, now())
	if err != nil {
		return out, nil, err
	}
	var provided map[string]json.RawMessage
	if json.Unmarshal(w.Inputs, &provided) != nil || provided == nil {
		return out, nil, httpx.Invalid("inputs", "object_required")
	}
	a, err := s.access(ctx, raw, project, job, true, func(tx identity.Tx, r Repository, a *identity.Auth, j *Job, _ *collaboration.Resource) error {
		if j.RevisionID == nil {
			return httpx.Invalid("job", "no_configuration")
		}
		rev, err := r.Revision(*j.RevisionID)
		if err != nil {
			return err
		}
		if rev == nil {
			return missing()
		}
		if _, err = inputs(rev.Config, provided); err != nil {
			return err
		}
		out = w
		out.ID = id
		out.JobID = job
		out.UpdatedAt = now()
		out.Next = next
		if id == 0 {
			out.Version = 1
			out.Creator = a.User.ID
			out.CreatedAt = now()
		} else {
			old, err := r.Schedule(id)
			if err != nil {
				return err
			}
			if old == nil || old.JobID != job {
				return missing()
			}
			if old.Version != w.Version {
				return httpx.E(412, "VERSION_CONFLICT", "计划已更新")
			}
			out.Creator = old.Creator
			out.CreatedAt = old.CreatedAt
			out.Version = old.Version + 1
			if old.Cron == w.Cron && old.Timezone == w.Timezone && old.Enabled == w.Enabled {
				out.Next = old.Next
			}
		}
		if !out.Enabled || !j.Enabled {
			out.Next = nil
		}
		if err = r.SaveSchedule(&out); err != nil {
			return err
		}
		return audit(tx, a, j, "schedule_saved")
	})
	return out, a, err
}
func Preview(cron, zone string) ([]time.Time, error) {
	out := []time.Time{}
	after := now()
	for range 5 {
		next, err := nextTime(Schedule{Cron: cron, Timezone: zone}, after)
		if err != nil {
			return nil, err
		}
		out = append(out, *next)
		after = *next
	}
	return out, nil
}
func (s *Service) Fires(ctx context.Context, raw string, project, job, schedule, before uint64) ([]Fire, *identity.Auth, error) {
	var out []Fire
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *Job, _ *collaboration.Resource) error {
		plan, err := r.Schedule(schedule)
		if err != nil {
			return err
		}
		if plan == nil || plan.JobID != job {
			return missing()
		}
		out, err = r.Fires(schedule, before)
		return err
	})
	return out, a, err
}

func (s *Service) fire(r Repository, j *Job, plan *Schedule, at time.Time) error {
	fire := Fire{ScheduleID: plan.ID, ScheduledAt: *plan.Next, ProcessedAt: at, Outcome: "rejected", Reason: "NO_CONFIGURATION"}
	if !j.Enabled {
		plan.Next = nil
		return r.SaveSchedule(plan)
	}
	if j.RevisionID != nil {
		rev, err := r.Revision(*j.RevisionID)
		if err != nil {
			return err
		}
		if rev == nil {
			return missing()
		}
		var provided map[string]json.RawMessage
		if json.Unmarshal(plan.Inputs, &provided) != nil {
			return httpx.Invalid("inputs", "invalid")
		}
		values, validation := inputs(rev.Config, provided)
		if validation != nil {
			fire.Reason = "INVALID_INPUTS"
		} else {
			run := &Run{JobID: j.ID, RevisionID: rev.ID, Trigger: "schedule", TriggerContext: safeJSON(map[string]any{"schedule_id": fmt.Sprint(plan.ID), "scheduled_at": fire.ScheduledAt}), Inputs: values, TimeoutMS: j.TimeoutMS, StateMode: "default", Status: "queued", QueuedAt: at}
			accepted, err := admit(r, j, run)
			if err != nil {
				return err
			}
			if accepted {
				fire.Outcome = "accepted"
				fire.Reason = ""
				fire.RunID = &run.ID
			} else {
				fire.Outcome = "skipped"
				fire.Reason = "JOB_BUSY"
			}
		}
	}
	if err := r.SaveFire(&fire); err != nil {
		return err
	}
	// A delayed scheduler processes at most one due decision. Advance from
	// observation time so a database outage cannot create a catch-up burst.
	next, err := nextTime(*plan, at)
	if err != nil {
		return err
	}
	plan.Next = next
	return r.SaveSchedule(plan)
}
