package sandboxes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Execute creates a durable intent and dispatches it at most once. A duplicate
// token returns the existing execution, without reconnecting to its output.
func (s *Service) Execute(ctx context.Context, lease Lease, token string, spec sandboxcore.ExecSpec, cb sandboxcore.ExecCallbacks) (*Execution, error) {
	if token == "" || spec.Timeout <= 0 {
		return nil, fail("SANDBOX_REQUEST_INVALID")
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	var out *Execution
	fresh := false
	err = s.Transact(ctx, func(r Repository) error {
		_, e := lockLease(r, lease, true)
		if e != nil {
			return e
		}
		out, e = r.ExecutionByToken(token)
		if e != nil {
			return e
		}
		if out != nil {
			if out.InstanceID != lease.InstanceID || out.LeaseID != lease.ID || !bytes.Equal(out.SpecHash, hash[:]) {
				return fail("SANDBOX_TOKEN_CONFLICT")
			}
			return nil
		}
		now := nowUTC()
		out = &Execution{InstanceID: lease.InstanceID, LeaseID: lease.ID, Token: token, Background: spec.Background, Status: "prepared", CWD: spec.CWD, SpecHash: hash[:], ExecutorEpoch: s.Epoch, FenceVersion: 1, Observation: json.RawMessage(`{}`), CreatedAt: now, DeadlineAt: now.Add(spec.Timeout)}
		fresh = true
		return r.InsertExecution(out)
	})
	if err != nil || !fresh {
		return out, err
	}
	_, err = s.Dispatch(ctx, *out, spec, cb)
	read := s.Transact(context.WithoutCancel(ctx), func(r Repository) error { var e error; out, e = r.Execution(out.ID, false); return e })
	return out, errors.Join(err, read)
}

// Dispatch accepts an already authorized intent. Agent callers insert their
// event association in the same transaction as this physical intent.
func (s *Service) Dispatch(ctx context.Context, expected Execution, spec sandboxcore.ExecSpec, cb sandboxcore.ExecCallbacks) (sandboxcore.ExecResult, error) {
	var instance *Instance
	err := s.Transact(ctx, func(r Repository) error {
		v, e := r.Instance(expected.InstanceID, true)
		if e != nil {
			return e
		}
		instance = v
		lease, e := r.Lease(expected.LeaseID, true)
		if e != nil {
			return e
		}
		if lease == nil {
			return fail("SANDBOX_LEASE_FENCED")
		}
		if _, e = lockLease(r, *lease, true); e != nil {
			return e
		}
		row, e := r.Execution(expected.ID, true)
		if e != nil {
			return e
		}
		if row == nil || row.FenceVersion != expected.FenceVersion || row.ExecutorEpoch != s.Epoch || row.Status != "prepared" || row.FinishedAt != nil || row.CancelRequestedAt != nil || row.InstanceID != v.ID || row.LeaseID != lease.ID {
			return fail("SANDBOX_EXECUTION_FENCED")
		}
		raw, e := json.Marshal(spec)
		if e != nil {
			return e
		}
		hash := sha256.Sum256(raw)
		if !bytes.Equal(row.SpecHash, hash[:]) {
			return fail("SANDBOX_TOKEN_CONFLICT")
		}
		if !nowUTC().Before(row.DeadlineAt) {
			return fail("SANDBOX_DEADLINE_EXCEEDED")
		}
		row.Status = "dispatching"
		return r.SaveExecution(row)
	})
	if err != nil {
		return sandboxcore.ExecResult{}, err
	}
	ref, err := s.Resource(instance)
	if err != nil {
		return sandboxcore.ExecResult{}, err
	}
	p, err := s.Open(ctx, instance.BackendGeneration)
	if err != nil {
		return sandboxcore.ExecResult{}, errors.Join(err, s.finishExecution(ctx, expected, sandboxcore.ExecResult{}, err, false))
	}
	result, cause := p.Exec(ctx, ref, spec, sandboxcore.ExecCallbacks{
		Started: func(c context.Context, h sandboxcore.ExecutionHandle) error {
			if h.Resource != ref || h.ID == "" {
				return fail("SANDBOX_EXECUTION_MISMATCH")
			}
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(c), 10*time.Second)
			defer cancel()
			e := s.Transact(cleanup, func(r Repository) error {
				if _, e := r.Instance(instance.ID, true); e != nil {
					return e
				}
				row, e := r.Execution(expected.ID, true)
				if e != nil {
					return e
				}
				if row == nil || row.FenceVersion != expected.FenceVersion || row.FinishedAt != nil {
					return fail("SANDBOX_EXECUTION_FENCED")
				}
				if row.RemoteID != nil && *row.RemoteID != h.ID {
					return fail("SANDBOX_EXECUTION_MISMATCH")
				}
				now := nowUTC()
				row.RemoteID = &h.ID
				row.StartedAt = &now
				row.LastObservedAt = &now
				row.Status = "running"
				if row.CancelRequestedAt != nil {
					row.Status = "cancel_pending"
				}
				return r.SaveExecution(row)
			})
			if e != nil {
				return e
			}
			if cb.Started != nil {
				return cb.Started(c, h)
			}
			return nil
		}, Output: cb.Output, Finished: func(c context.Context, result sandboxcore.ExecResult, cause error) {
			finishErr := s.finishExecution(c, expected, result, cause, true)
			if cb.Finished != nil {
				cb.Finished(c, result, errors.Join(cause, finishErr))
			}
		},
	})
	return result, errors.Join(cause, s.finishExecution(ctx, expected, result, cause, true))
}

func (s *Service) finishExecution(ctx context.Context, expected Execution, result sandboxcore.ExecResult, cause error, dispatched bool) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.Transact(cleanup, func(r Repository) error {
		if _, e := r.Instance(expected.InstanceID, true); e != nil {
			return e
		}
		row, e := r.Execution(expected.ID, true)
		if e != nil {
			return e
		}
		if row == nil || row.FenceVersion != expected.FenceVersion {
			return fail("SANDBOX_EXECUTION_FENCED")
		}
		if row.FinishedAt != nil {
			return nil
		}
		now := nowUTC()
		row.LastObservedAt = &now
		if cause == nil && result.ExitCode != nil && !result.Running {
			code := int(*result.ExitCode)
			row.ExitCode = &code
			row.Status = "completed"
			row.FinishedAt = &now
		} else if result.Running {
			if row.CancelRequestedAt == nil {
				row.Status = "running"
			} else if row.Status != "cancelling" {
				row.Status = "cancel_pending"
			}
		} else if !dispatched || cause != nil && !uncertain(cause) && row.RemoteID == nil {
			row.Status = "failed"
			row.FinishedAt = &now
		} else {
			row.Status = "outcome_unknown"
		}
		if cause != nil {
			code := errorCode(cause)
			row.ErrorCode = &code
		}
		return r.SaveExecution(row)
	})
}

func (s *Service) ObserveExecution(ctx context.Context, id uint64) (*Execution, error) {
	var row *Execution
	var instance *Instance
	err := s.Transact(ctx, func(r Repository) error {
		var e error
		row, e = r.Execution(id, false)
		if e != nil || row == nil {
			return e
		}
		instance, e = r.Instance(row.InstanceID, false)
		return e
	})
	if err != nil || row == nil || row.FinishedAt != nil {
		return row, err
	}
	ref, err := s.Resource(instance)
	if err != nil {
		return row, err
	}
	p, err := s.Open(ctx, instance.BackendGeneration)
	if err != nil {
		return row, err
	}
	actual, err := p.Inspect(ctx, ref)
	if err != nil {
		return row, err
	}
	if actual.State == "absent" || actual.State == "terminated" {
		err = s.finishExecution(ctx, *row, sandboxcore.ExecResult{}, fail("SANDBOX_INSTANCE_TERMINATED"), false)
	} else if row.RemoteID != nil {
		var result sandboxcore.ExecResult
		result, err = p.InspectExecution(ctx, sandboxcore.ExecutionHandle{Resource: ref, ID: *row.RemoteID})
		if err == nil {
			err = s.finishExecution(ctx, *row, result, nil, true)
		}
	} else {
		return row, fail("SANDBOX_EXECUTION_UNCONFIRMED")
	}
	if err != nil {
		return row, err
	}
	err = s.Transact(ctx, func(r Repository) error { var e error; row, e = r.Execution(id, false); return e })
	return row, err
}

func (s *Service) CancelExecution(ctx context.Context, lease Lease, id uint64) error {
	var row *Execution
	var instance *Instance
	send := false
	err := s.Transact(ctx, func(r Repository) error {
		var e error
		instance, e = r.Instance(lease.InstanceID, true)
		if e != nil {
			return e
		}
		held, e := r.Lease(lease.ID, true)
		if e != nil {
			return e
		}
		if held == nil || held.InstanceID != lease.InstanceID || held.FenceVersion != lease.FenceVersion || held.ReleasedAt != nil {
			return fail("SANDBOX_LEASE_FENCED")
		}
		row, e = r.Execution(id, true)
		if e != nil {
			return e
		}
		if row == nil || row.LeaseID != lease.ID || row.InstanceID != lease.InstanceID {
			return fail("SANDBOX_EXECUTION_NOT_FOUND")
		}
		if row.FinishedAt != nil || row.Status == "cancelling" {
			return nil
		}
		now := nowUTC()
		if row.CancelRequestedAt == nil {
			row.CancelRequestedAt = &now
		}
		send = row.RemoteID != nil
		if row.Status == "prepared" {
			row.Status = "cancelled"
			row.FinishedAt = &now
			send = false
		} else if send {
			row.Status = "cancelling"
		} else {
			row.Status = "cancel_pending"
		}
		return r.SaveExecution(row)
	})
	if err != nil || !send {
		return err
	}
	if row.RemoteID == nil {
		return fail("SANDBOX_EXECUTION_UNCONFIRMED")
	}
	ref, err := s.Resource(instance)
	if err != nil {
		return err
	}
	p, err := s.Open(ctx, instance.BackendGeneration)
	if err != nil {
		return err
	}
	// A cancellation acknowledgement is not process completion.
	if err = p.CancelExecution(ctx, sandboxcore.ExecutionHandle{Resource: ref, ID: *row.RemoteID}); err != nil {
		return err
	}
	_, err = s.ObserveExecution(ctx, id)
	return err
}
