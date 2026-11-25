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
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
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
	a, err := s.access(ctx, raw, project, job, true, func(tx identity.Tx, r Repository, a *identity.Auth, j *Job, _ *collaboration.Resource) error {
		var old *Schedule
		zone, err := r.ScheduleTimezone()
		if err != nil {
			return err
		}
		if id != 0 {
			old, err = r.Schedule(id)
			if err != nil {
				return err
			}
			if old == nil || old.JobID != job {
				return missing()
			}
			if err := version(fmt.Sprint(w.Version), old.Version); err != nil {
				return err
			}
		}
		out = w
		return savePlan(tx, r, a, j, old, &out, zone, true)
	})
	return out, a, err
}

func validatePlanInputs(r Repository, j *Job, raw json.RawMessage) error {
	var provided map[string]json.RawMessage
	if json.Unmarshal(raw, &provided) != nil || provided == nil {
		return httpx.Invalid("inputs", "object_required")
	}
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
	_, err = inputs(rev.Config, provided)
	return err
}

func savePlan(tx identity.Tx, r Repository, a *identity.Auth, j *Job, old, plan *Schedule, zone string, checkInputs bool) error {
	if strings.TrimSpace(plan.Name) == "" || utf8.RuneCountInString(plan.Name) > 100 {
		return httpx.Invalid("name", "required")
	}
	if checkInputs {
		if err := validatePlanInputs(r, j, plan.Inputs); err != nil {
			return err
		}
	}
	at := now()
	plan.JobID = j.ID
	if old == nil {
		plan.ID, plan.Version, plan.FireCount = 0, 1, 0
		plan.Creator, plan.CreatedAt = a.User.ID, at
	} else {
		if plan.Code != "" && plan.Code != old.Code {
			return httpx.Invalid("code", "immutable")
		}
		plan.Code, plan.ID, plan.Version = old.Code, old.ID, old.Version+1
		plan.Creator, plan.CreatedAt, plan.FireCount = old.Creator, old.CreatedAt, old.FireCount
		if !old.Enabled && plan.Enabled {
			plan.FireCount = 0
		}
	}
	if !resourcecode.Valid(plan.Code) {
		return httpx.Invalid("code", "invalid_format")
	}
	plan.UpdatedAt = at
	if err := configureTiming(plan, old, j.Enabled, zone, at); err != nil {
		return err
	}
	if err := r.SaveSchedule(plan); err != nil {
		return err
	}
	return audit(tx, a, j, "schedule_saved")
}

func configureTiming(p, old *Schedule, jobEnabled bool, zone string, at time.Time) error {
	if p.Kind == "" {
		p.Kind = "cron"
	}
	unchanged := old != nil && old.Enabled == p.Enabled && old.Kind == p.Kind
	switch p.Kind {
	case "once":
		if p.RunAt == nil || p.Cron != "" {
			return httpx.Invalid("run_at", "once_requires_time_only")
		}
		if p.MaxFires != nil && *p.MaxFires != 1 {
			return httpx.Invalid("max_fires", "once_requires_one")
		}
		p.MaxFires = ptr(uint32(1))
		p.RunAt = ptr(p.RunAt.UTC().Truncate(time.Millisecond))
		unchanged = unchanged && old.RunAt != nil && p.RunAt.Equal(*old.RunAt)
		if p.RunAt.Year() < 1000 || p.RunAt.Year() > 9999 || (p.Enabled && !unchanged && !p.RunAt.After(at)) {
			return httpx.Invalid("run_at", "future_time_required")
		}
		p.Next = p.RunAt
	case "cron":
		if p.RunAt != nil {
			return httpx.Invalid("run_at", "cron_time_conflict")
		}
		if p.MaxFires != nil && *p.MaxFires == 0 {
			return httpx.Invalid("max_fires", "positive_required")
		}
		next, err := NextCronTime(p.Cron, zone, at)
		if err != nil {
			return err
		}
		p.Next = next
		unchanged = unchanged && old.Cron == p.Cron
	default:
		return httpx.Invalid("schedule_kind", "invalid")
	}
	if unchanged {
		p.Next = old.Next
	}
	if p.MaxFires != nil && p.FireCount >= uint64(*p.MaxFires) {
		p.Enabled = false
	}
	if !p.Enabled || !jobEnabled {
		p.Next = nil
	}
	return nil
}

// resumePlan skips offline occurrences. A missed one-time appointment has no successor.
func resumePlan(r Repository, p *Schedule, zone string, at time.Time) error {
	if p.Kind == "once" {
		if p.RunAt.After(at) {
			p.Next = p.RunAt
			return nil
		}
		p.Enabled, p.Next, p.UpdatedAt = false, nil, at
		p.Version++
		return r.SaveFire(&Fire{ScheduleID: p.ID, ScheduledAt: *p.RunAt, ProcessedAt: at, Outcome: "missed", Reason: "SCHEDULE_MISSED"})
	}
	next, err := NextCronTime(p.Cron, zone, at)
	p.Next = next
	return err
}

func (s *Service) Preview(ctx context.Context, raw string, project, job uint64, cron string) ([]time.Time, *identity.Auth, error) {
	var out []time.Time
	a, err := s.access(ctx, raw, project, job, false, func(_ identity.Tx, r Repository, _ *identity.Auth, _ *Job, _ *collaboration.Resource) error {
		zone, err := r.ScheduleTimezone()
		if err != nil {
			return err
		}
		after := now()
		out = nil
		for range 5 {
			next, err := NextCronTime(cron, zone, after)
			if err != nil {
				return err
			}
			out = append(out, *next)
			after = *next
		}
		return nil
	})
	return out, a, err
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

func (s *Service) fire(r Repository, j *Job, plan *Schedule, zone string, at time.Time) error {
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
			run := &Run{RunAsUserID: rev.RunAsUserID, JobID: j.ID, RevisionID: rev.ID, Trigger: "schedule", TriggerContext: safeJSON(map[string]any{"schedule_id": fmt.Sprint(plan.ID), "scheduled_at": fire.ScheduledAt}), Inputs: values, TimeoutMS: j.TimeoutMS, StateMode: "default", Status: "queued", QueuedAt: at}
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
	plan.FireCount++
	plan.UpdatedAt = at
	if plan.MaxFires != nil && plan.FireCount >= uint64(*plan.MaxFires) {
		plan.Enabled, plan.Next = false, nil
		plan.Version++
		return r.SaveSchedule(plan)
	}
	// A delayed scheduler processes at most one due decision. Advance from
	// observation time so a database outage cannot create a catch-up burst.
	next, err := NextCronTime(plan.Cron, zone, at)
	if err != nil {
		return err
	}
	plan.Next = next
	return r.SaveSchedule(plan)
}
