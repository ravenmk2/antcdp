package sandboxes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Reserve records an immutable instance identity before any remote creation.
// A token identifies the same request, never a request to repeat a side effect.
func (s *Service) Reserve(ctx context.Context, connection, generation uint64, token string, config json.RawMessage) (*Instance, error) {
	if connection == 0 || generation == 0 || token == "" || !json.Valid(config) {
		return nil, fail("SANDBOX_REQUEST_INVALID")
	}
	var out *Instance
	err := s.Transact(ctx, func(r Repository) error {
		previous, err := r.InstanceByToken(token)
		if err != nil {
			return err
		}
		if previous != nil {
			if previous.ConnectionID != connection || previous.BackendGeneration != generation || !sameJSON(previous.EffectiveConfig, config) {
				return fail("SANDBOX_TOKEN_CONFLICT")
			}
			out = previous
			return nil
		}
		now := nowUTC()
		out = &Instance{ConnectionID: connection, BackendGeneration: generation, CreationToken: token, State: "reserved", EffectiveConfig: config, Capabilities: json.RawMessage(`{}`), ExecutorEpoch: s.Epoch, FenceVersion: 1, RowVersion: 1, CreatedAt: now, UpdatedAt: now}
		return r.InsertInstance(out)
	})
	return out, err
}

func sameJSON(a, b json.RawMessage) bool {
	var av, bv any
	if json.Unmarshal(a, &av) != nil || json.Unmarshal(b, &bv) != nil {
		return false
	}
	aa, _ := json.Marshal(av)
	bb, _ := json.Marshal(bv)
	return bytes.Equal(aa, bb)
}

func (s *Service) Acquire(ctx context.Context, id uint64, consumerKind, consumerID, mode string, ttl time.Duration) (*Lease, error) {
	if consumerKind == "" || consumerID == "" || len(consumerKind) > 32 || len(consumerID) > 128 || (mode != "shared" && mode != "exclusive" && mode != "observer") || ttl <= 0 {
		return nil, fail("SANDBOX_REQUEST_INVALID")
	}
	var out *Lease
	err := s.Transact(ctx, func(r Repository) error {
		v, err := r.Instance(id, true)
		if err != nil {
			return err
		}
		if v == nil || v.State != "ready" || v.FinishedAt != nil {
			return fail("SANDBOX_NOT_READY")
		}
		leases, err := r.Leases(id)
		if err != nil {
			return err
		}
		for _, l := range leases {
			if l.ConsumerKind == consumerKind && l.ConsumerID == consumerID && l.Mode == mode && l.State == "active" && nowUTC().Before(l.ExpiresAt) {
				out = &l
				return nil
			}
			if l.Mode != "observer" && mode != "observer" && (l.Mode == "exclusive" || mode == "exclusive") {
				return fail("SANDBOX_BUSY")
			}
		}
		now := nowUTC()
		out = &Lease{InstanceID: id, ConsumerKind: consumerKind, ConsumerID: consumerID, Mode: mode, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, AcquiredAt: now, ExpiresAt: now.Add(ttl), UpdatedAt: now}
		return r.InsertLease(out)
	})
	return out, err
}

func (s *Service) Release(ctx context.Context, expected Lease, reason string) error {
	return s.Transact(ctx, func(r Repository) error {
		if _, err := r.Instance(expected.InstanceID, true); err != nil {
			return err
		}
		l, err := r.Lease(expected.ID, true)
		if err != nil {
			return err
		}
		if l == nil || l.InstanceID != expected.InstanceID || l.FenceVersion != expected.FenceVersion {
			return fail("SANDBOX_LEASE_FENCED")
		}
		if l.ReleasedAt != nil {
			return nil
		}
		busy, err := r.Busy(l.InstanceID, &l.ID)
		if err != nil {
			return err
		}
		if busy {
			return fail("SANDBOX_BUSY")
		}
		now := nowUTC()
		l.State = "released"
		l.ReleasedAt = &now
		l.ReleaseReason = &reason
		l.UpdatedAt = now
		l.FenceVersion++
		return r.SaveLease(l)
	})
}

func lockLease(r Repository, expected Lease, mutation bool) (*Instance, error) {
	v, err := r.Instance(expected.InstanceID, true)
	if err != nil {
		return nil, err
	}
	l, err := r.Lease(expected.ID, true)
	if err != nil {
		return nil, err
	}
	if v == nil || v.State != "ready" || v.FinishedAt != nil || l == nil || l.InstanceID != v.ID || l.FenceVersion != expected.FenceVersion || l.State != "active" || mutation && l.Mode == "observer" || l.ReleasedAt != nil || !nowUTC().Before(l.ExpiresAt) {
		return nil, fail("SANDBOX_LEASE_FENCED")
	}
	return v, nil
}

func (s *Service) Create(ctx context.Context, id uint64, spec sandboxcore.CreateSpec) (*Instance, error) {
	installation, err := s.InstallationID()
	if err != nil {
		return nil, err
	}
	var v *Instance
	var op *Operation
	fresh := false
	err = s.Transact(ctx, func(r Repository) error {
		var e error
		v, e = r.Instance(id, true)
		if e != nil {
			return e
		}
		if v == nil {
			return fail("SANDBOX_NOT_FOUND")
		}
		spec.Ownership = sandboxcore.Ownership{InstallationID: installation, InstanceID: v.ID, CreationToken: v.CreationToken}
		spec.BackendGeneration = v.BackendGeneration
		intent, e := json.Marshal(spec)
		if e != nil {
			return e
		}
		hash := sha256.Sum256(intent)
		op, e = r.OperationByToken("create/" + v.CreationToken)
		if e != nil {
			return e
		}
		if op != nil {
			if !bytes.Equal(op.RequestHash, hash[:]) {
				return fail("SANDBOX_TOKEN_CONFLICT")
			}
			return nil
		}
		if v.State != "reserved" {
			return fail("SANDBOX_STATE_CONFLICT")
		}
		now := nowUTC()
		op = &Operation{InstanceID: id, Token: "create/" + v.CreationToken, Kind: "create", Status: "dispatching", RequestHash: hash[:], Intent: intent, Observation: json.RawMessage(`{}`), ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, StartedAt: &now, DeadlineAt: now.Add(5 * time.Minute), UpdatedAt: now}
		if e = r.InsertOperation(op); e != nil {
			return e
		}
		v.State = "creating"
		v.UpdatedAt = now
		v.RowVersion++
		fresh = true
		return r.SaveInstance(v)
	})
	if err != nil {
		return nil, err
	}
	if op.FinishedAt != nil {
		if op.Status != "completed" {
			return v, fail("SANDBOX_CREATION_FAILED")
		}
		return v, nil
	}
	p, err := s.Open(ctx, v.ConnectionID, v.BackendGeneration)
	if err != nil {
		return v, err
	}
	var actual sandboxcore.Observation
	if fresh {
		actual, err = p.Create(ctx, spec)
	} else {
		// A lost response cannot authorize a second POST, even if Find is empty.
		var found sandboxcore.ResourcePage
		found, err = p.Find(ctx, spec.Ownership, 1, 2)
		if err == nil && !found.HasMore && len(found.Items) == 1 {
			actual = found.Items[0]
			// Backend generations are local configuration fences, not remote metadata.
			actual.Ref.BackendGeneration = v.BackendGeneration
		} else {
			err = &sandboxcore.Error{Code: "SANDBOX_CREATION_UNCONFIRMED", Unknown: true}
		}
	}
	if actual.Ref.RemoteID != "" && (actual.Ref.Ownership != spec.Ownership || actual.Ref.BackendGeneration != v.BackendGeneration) {
		err = &sandboxcore.Error{Code: "SANDBOX_OWNERSHIP_MISMATCH", Unknown: true}
	}
	if err == nil && actual.State != "ready" {
		err = &sandboxcore.Error{Code: "SANDBOX_STARTING", Unknown: true}
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	save := s.Transact(cleanup, func(r Repository) error {
		current, e := r.Instance(id, true)
		if e != nil {
			return e
		}
		if current == nil || current.CreationToken != v.CreationToken {
			return fail("SANDBOX_INSTANCE_FENCED")
		}
		row, e := r.Operation(op.ID, true)
		if e != nil {
			return e
		}
		if row == nil || row.FenceVersion != op.FenceVersion || row.FinishedAt != nil {
			return fail("SANDBOX_OPERATION_FENCED")
		}
		now := nowUTC()
		current.LastObservedAt = &now
		current.UpdatedAt = now
		current.RowVersion++
		if actual.Ref.RemoteID != "" && actual.Ref.Ownership == spec.Ownership {
			current.RemoteID = &actual.Ref.RemoteID
			current.ExpiresAt = actual.ExpiresAt
		}
		current.State = "ready"
		row.Status = "completed"
		row.FinishedAt = &now
		if err != nil {
			code := errorCode(err)
			current.ErrorCode = &code
			row.ErrorCode = &code
			current.State = "failed"
			row.Status = "failed"
			if uncertain(err) || current.RemoteID != nil {
				current.State = "unknown"
				row.Status = "outcome_unknown"
				row.FinishedAt = nil
			}
		}
		row.Observation, _ = json.Marshal(actual)
		row.UpdatedAt = now
		if e = r.SaveOperation(row); e != nil {
			return e
		}
		if e = r.SaveInstance(current); e != nil {
			return e
		}
		v = current
		return nil
	})
	return v, errors.Join(err, save)
}

func uncertain(err error) bool {
	var remote *sandboxcore.Error
	if errors.As(err, &remote) {
		return remote.Unknown
	}
	return err != nil
}
func errorCode(err error) string {
	var e *sandboxcore.Error
	if errors.As(err, &e) {
		return e.Code
	}
	return "SANDBOX_UNAVAILABLE"
}

// NewToken is only for new intents. Retrying a call must reuse its original token.
func NewToken() string { return cryptox.ID() }
