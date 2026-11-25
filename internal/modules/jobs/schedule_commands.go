package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

// ScheduleTarget is scoped to a project. ActorID must come from an authenticated
// principal or a trusted internal caller, never from a public request body.
type ScheduleTarget struct {
	ProjectID, ActorID    uint64
	JobCode, ScheduleCode string
}

// ScheduleUpdate patches the current mode. Nil fields are preserved. A non-nil
// Inputs map replaces all inputs (an empty map restores job defaults).
type ScheduleUpdate struct {
	ExpectedVersion uint64
	RequestKey      string
	Enabled         *bool
	RunAt           *time.Time
	Cron, Timezone  *string
	Inputs          map[string]json.RawMessage
}

type ScheduleCommandReceipt struct {
	Hash    string `db:"payload_hash" json:"-"`
	Version uint64 `db:"result_version" json:"version,string"`
}

func (s *Service) accessScheduleCode(ctx context.Context, target ScheduleTarget, fn func(identity.Tx, Repository, *identity.User, *Job, *Schedule) error) error {
	if !resourcecode.Valid(target.JobCode) {
		return httpx.Invalid("job_code", "invalid_format")
	}
	if !resourcecode.Valid(target.ScheduleCode) {
		return httpx.Invalid("schedule_code", "invalid_format")
	}
	return s.transaction(ctx, func(tx identity.Tx, r Repository) error {
		users, err := tx.LockUsers([]uint64{target.ActorID})
		if err != nil {
			return err
		}
		user := users[target.ActorID]
		if user == nil || user.DeletedAt != nil || user.Status != "active" {
			return forbidden()
		}
		if err = tx.(collaboration.Repository).LockCollaboration(collaboration.Project, target.ProjectID, 0); err != nil {
			return err
		}
		project, err := projectAccess(tx, target.ProjectID, user.ID)
		if err != nil {
			return err
		}
		if project.Role != "admin" && user.Role != "admin" {
			return forbidden()
		}
		if project.EndedAt != nil {
			return httpx.E(409, "RESOURCE_READ_ONLY", "项目已归档")
		}
		j, err := r.JobByCode(target.ProjectID, target.JobCode)
		if err != nil {
			return err
		}
		if j == nil {
			return missing()
		}
		p, err := r.ScheduleByCode(j.ID, target.ScheduleCode)
		if err != nil {
			return err
		}
		if p == nil {
			return missing()
		}
		return fn(tx, r, user, j, p)
	})
}

// ScheduleByCode reads the current configuration and version for a management command.
func (s *Service) ScheduleByCode(ctx context.Context, target ScheduleTarget) (Schedule, error) {
	var out Schedule
	err := s.accessScheduleCode(ctx, target, func(_ identity.Tx, _ Repository, _ *identity.User, _ *Job, p *Schedule) error {
		out = *p
		return nil
	})
	return out, err
}

// UpdateScheduleByCode atomically enables, disables, retimes, or replaces
// inputs. Replaying an accepted command returns its original version.
func (s *Service) UpdateScheduleByCode(ctx context.Context, target ScheduleTarget, w ScheduleUpdate) (ScheduleCommandReceipt, error) {
	var out ScheduleCommandReceipt
	if !automationRequestKey.MatchString(w.RequestKey) {
		return out, httpx.Invalid("request_key", "invalid")
	}
	if w.Enabled == nil && w.Cron == nil && w.Timezone == nil && w.RunAt == nil && w.Inputs == nil {
		return out, httpx.Invalid("schedule", "empty_update")
	}
	if w.RunAt != nil {
		w.RunAt = ptr(w.RunAt.UTC().Truncate(time.Millisecond))
	}
	digest, err := hash(w)
	if err != nil {
		return out, httpx.Invalid("inputs", "invalid")
	}
	err = s.accessScheduleCode(ctx, target, func(tx identity.Tx, r Repository, user *identity.User, j *Job, p *Schedule) error {
		prior, err := r.ScheduleCommand(p.ID, user.ID, w.RequestKey)
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
		if w.ExpectedVersion != p.Version {
			conflict := httpx.E(412, "VERSION_CONFLICT", "计划已更新")
			info := map[string]any{"version": fmt.Sprint(p.Version), "enabled": p.Enabled, "fire_count": p.FireCount}
			if p.Kind == "once" && !p.Enabled {
				fires, err := r.Fires(p.ID, 0)
				if err != nil {
					return err
				}
				if len(fires) > 0 && fires[0].ScheduledAt.Equal(*p.RunAt) {
					info["fire"] = fires[0]
				}
			}
			conflict.Details = []httpx.Detail{{Field: "version", Code: "conflict", Context: info}}
			return conflict
		}
		next := *p
		if err := w.apply(&next); err != nil {
			return err
		}
		if err := savePlan(tx, r, &identity.Auth{User: user}, j, p, &next, w.Inputs != nil || (!p.Enabled && next.Enabled)); err != nil {
			return err
		}
		out = ScheduleCommandReceipt{Hash: digest, Version: next.Version}
		return r.SaveScheduleCommand(p.ID, user.ID, w.RequestKey, out)
	})
	if err != nil {
		return ScheduleCommandReceipt{}, err
	}
	return out, nil
}

func (w ScheduleUpdate) apply(p *Schedule) error {
	if w.RunAt != nil {
		if p.Kind != "once" {
			return httpx.Invalid("run_at", "once_required")
		}
		p.RunAt = w.RunAt
	}
	if w.Cron != nil || w.Timezone != nil {
		if p.Kind != "cron" {
			return httpx.Invalid("cron", "cron_required")
		}
		if w.Cron != nil {
			p.Cron = *w.Cron
		}
		if w.Timezone != nil {
			p.Timezone = *w.Timezone
		}
	}
	if w.Enabled != nil {
		p.Enabled = *w.Enabled
	}
	if w.Inputs != nil {
		raw, err := json.Marshal(w.Inputs)
		if err != nil {
			return httpx.Invalid("inputs", "invalid")
		}
		p.Inputs = raw
	}
	return nil
}
