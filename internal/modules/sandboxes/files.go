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

// File runs an authorized, bounded native filesystem action under a durable hold.
// intent must describe the action (including a content digest for uploads), never
// raw file bytes or credentials. mutation=false is reserved for read-only actions.
// A repeated token returns the persisted result and never calls apply again.
func (s *Service) File(ctx context.Context, lease Lease, token string, intent json.RawMessage, mutation bool, apply func(sandboxcore.Filesystem, sandboxcore.ResourceRef) (json.RawMessage, error)) (*Operation, error) {
	if token == "" || !json.Valid(intent) || apply == nil {
		return nil, fail("SANDBOX_REQUEST_INVALID")
	}
	hash := sha256.Sum256(intent)
	var instance *Instance
	var op *Operation
	fresh := false
	kind := "file_read"
	if mutation {
		kind = "file_write"
	}
	err := s.Transact(ctx, func(r Repository) error {
		var e error
		instance, e = lockLease(r, lease, mutation)
		if e != nil {
			return e
		}
		op, e = r.OperationByToken(token)
		if e != nil {
			return e
		}
		if op != nil {
			if op.InstanceID != lease.InstanceID || op.LeaseID == nil || *op.LeaseID != lease.ID || op.Kind != kind || !bytes.Equal(op.RequestHash, hash[:]) {
				return fail("SANDBOX_TOKEN_CONFLICT")
			}
			return nil
		}
		now := nowUTC()
		op = &Operation{InstanceID: lease.InstanceID, LeaseID: &lease.ID, Token: token, Kind: kind, Status: "dispatching", RequestHash: hash[:], Intent: intent, Observation: json.RawMessage(`null`), ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, StartedAt: &now, DeadlineAt: now.Add(time.Minute), UpdatedAt: now}
		fresh = true
		return r.InsertOperation(op)
	})
	if err != nil {
		return op, err
	}
	if !fresh {
		if op.Status == "completed" {
			return op, nil
		}
		return op, fail("SANDBOX_FILE_NOT_REPLAYED")
	}
	ref, cause := s.Resource(instance)
	var result json.RawMessage
	dispatched := false
	if cause == nil {
		var p sandboxcore.Provider
		p, cause = s.Open(ctx, instance.BackendGeneration)
		if cause == nil {
			fs, ok := p.(sandboxcore.Filesystem)
			if !ok {
				cause = fail("SANDBOX_FILESYSTEM_UNSUPPORTED")
			} else {
				dispatched = true
				result, cause = apply(fs, ref)
			}
		}
	}
	if len(result) == 0 {
		result = json.RawMessage(`null`)
	}
	if !json.Valid(result) {
		result = json.RawMessage(`null`)
		cause = errors.Join(cause, fail("SANDBOX_RESULT_INVALID"))
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	save := s.Transact(cleanup, func(r Repository) error {
		if _, e := r.Instance(instance.ID, true); e != nil {
			return e
		}
		row, e := r.Operation(op.ID, true)
		if e != nil {
			return e
		}
		if row == nil || row.FenceVersion != op.FenceVersion || row.FinishedAt != nil {
			return fail("SANDBOX_OPERATION_FENCED")
		}
		now := nowUTC()
		row.UpdatedAt = now
		row.Observation = result
		row.Status = "completed"
		row.FinishedAt = &now
		if cause != nil {
			row.Status = "failed"
			code := errorCode(cause)
			row.ErrorCode = &code
			if dispatched && mutation && uncertain(cause) {
				row.Status = "outcome_unknown"
				row.FinishedAt = nil
			}
		}
		if e = r.SaveOperation(row); e != nil {
			return e
		}
		op = row
		return nil
	})
	return op, errors.Join(cause, save)
}

// ReconcileFiles observes termination, never file content, to discharge uncertain
// writes. Reads interrupted by a process restart cannot leave a remote mutation.
func (s *Service) ReconcileFiles(ctx context.Context, limit int) error {
	cursor := s.recoveryCursor()
	cursor.mu.Lock()
	defer cursor.mu.Unlock()
	if limit < 1 || limit > 100 {
		limit = 25
	}
	return s.reconcileFiles(ctx, limit, cursor)
}

func (s *Service) reconcileFiles(ctx context.Context, limit int, cursor *RecoveryCursor) error {
	var rows []Operation
	err := s.Transact(ctx, func(r Repository) error { var e error; rows, e = r.PendingOperations(cursor.files, limit); return e })
	if err != nil {
		return err
	}
	if len(rows) > 0 {
		cursor.files = rows[len(rows)-1].ID
	}
	var failures []error
	for _, initial := range rows {
		if initial.Kind != "file_read" && initial.Kind != "file_write" {
			continue
		}
		if initial.Status != "outcome_unknown" && initial.ExecutorEpoch == s.Epoch && nowUTC().Before(initial.DeadlineAt) {
			continue
		}
		var instance *Instance
		err = s.Transact(ctx, func(r Repository) error { var e error; instance, e = r.Instance(initial.InstanceID, false); return e })
		if err != nil {
			failures = append(failures, err)
			continue
		}
		confirmed := initial.Kind == "file_read" || instance != nil && instance.FinishedAt != nil
		if !confirmed && instance != nil {
			ref, e := s.Resource(instance)
			if e == nil {
				p, e := s.Open(ctx, instance.BackendGeneration)
				if e == nil {
					actual, e := p.Inspect(ctx, ref)
					confirmed = e == nil && (actual.State == "absent" || actual.State == "terminated")
				}
			}
		}
		err = s.Transact(ctx, func(r Repository) error {
			if _, e := r.Instance(initial.InstanceID, true); e != nil {
				return e
			}
			row, e := r.Operation(initial.ID, true)
			if e != nil {
				return e
			}
			if row == nil || row.FinishedAt != nil || row.FenceVersion != initial.FenceVersion {
				return nil
			}
			now := nowUTC()
			row.UpdatedAt = now
			row.FenceVersion++
			row.ExecutorEpoch = s.Epoch
			code := "SANDBOX_FILE_OUTCOME_UNKNOWN"
			row.Status = "outcome_unknown"
			if confirmed {
				row.Status = "failed"
				row.FinishedAt = &now
				code = "SANDBOX_FILE_INTERRUPTED"
			}
			row.ErrorCode = &code
			return r.SaveOperation(row)
		})
		if err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
