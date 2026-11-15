package mysql

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	s "github.com/ravenmk2/antcdp/internal/modules/sandboxes"
)

// Agent file publication and cloud file browsing retain their own business
// outcome. Their remote hold belongs to the sandbox and is visible to every
// consumer, including callers without an Agent session.
func (t *agentsTx) insertCloudFileHold(v *a.CloudOperationRow) error {
	if !strings.HasPrefix(v.Kind, "workspace_") {
		return nil
	}
	r := t.Sandbox()
	instance, err := r.Instance(v.InstanceID, true)
	if err != nil {
		return err
	}
	if instance == nil {
		return errors.New("file operation instance missing")
	}
	var lease *s.Lease
	if v.RootRunID != nil {
		binding, e := t.Lease(*v.RootRunID, true)
		if e != nil {
			return e
		}
		if binding != nil && binding.SandboxLeaseID != nil {
			lease, e = r.Lease(*binding.SandboxLeaseID, true)
			if e != nil {
				return e
			}
		}
	}
	if lease == nil {
		mode := "shared"
		if v.Kind == "workspace_read" || v.Kind == "workspace_download" || v.Kind == "workspace_verify" {
			mode = "observer"
		}
		leases, e := r.Leases(instance.ID)
		if e != nil {
			return e
		}
		for _, held := range leases {
			if held.Mode == "exclusive" && mode != "observer" {
				return errors.New("sandbox exclusively occupied")
			}
		}
		lease = &s.Lease{InstanceID: instance.ID, ConsumerKind: "cloud_file_operation", ConsumerID: strconv.FormatUint(v.ID, 10), Mode: mode, State: "active", ExecutorEpoch: v.ExecutorEpoch, FenceVersion: 1, AcquiredAt: v.CreatedAt, ExpiresAt: v.DeadlineAt, UpdatedAt: v.UpdatedAt}
		if e = r.InsertLease(lease); e != nil {
			return e
		}
	}
	hash := sha256.Sum256(v.Intent)
	kind := "file_write"
	if v.Kind == "workspace_read" || v.Kind == "workspace_download" || v.Kind == "workspace_verify" {
		kind = "file_read"
	}
	physical := &s.Operation{InstanceID: instance.ID, LeaseID: &lease.ID, Token: v.OperationToken, Kind: kind, Status: v.Status, RequestHash: hash[:], Intent: v.Intent, Observation: json.RawMessage(`null`), ExecutorEpoch: v.ExecutorEpoch, FenceVersion: v.FenceVersion, CreatedAt: v.CreatedAt, StartedAt: v.StartedAt, DeadlineAt: v.DeadlineAt, UpdatedAt: v.UpdatedAt}
	if err = r.InsertOperation(physical); err != nil {
		return err
	}
	v.SandboxOperationID = &physical.ID
	_, err = t.tx.ExecContext(t.ctx, "UPDATE cloud_computer_operation SET sandbox_operation_id=? WHERE id=?", physical.ID, v.ID)
	return err
}

func (t *agentsTx) saveCloudFileHold(v *a.CloudOperationRow) error {
	if v.SandboxOperationID == nil {
		return nil
	}
	r := t.Sandbox()
	if _, err := r.Instance(v.InstanceID, true); err != nil {
		return err
	}
	row, err := r.Operation(*v.SandboxOperationID, true)
	if err != nil {
		return err
	}
	if row == nil {
		return errors.New("file hold missing")
	}
	// A physical reconciler can retire a hold after termination. Its result must
	// never be turned back into running by a delayed business projection.
	if row.FinishedAt == nil {
		row.Status = v.Status
		row.Observation = v.Observation
		row.ErrorCode = v.ErrorCode
		row.StartedAt = v.StartedAt
		row.FinishedAt = v.FinishedAt
		row.UpdatedAt = v.UpdatedAt
		row.DeadlineAt = v.DeadlineAt
		row.ExecutorEpoch = v.ExecutorEpoch
		row.FenceVersion = v.FenceVersion
		if err = r.SaveOperation(row); err != nil {
			return err
		}
	}
	if row.FinishedAt != nil && row.LeaseID != nil {
		lease, e := r.Lease(*row.LeaseID, true)
		if e != nil {
			return e
		}
		if lease == nil {
			return errors.New("file lease missing")
		}
		if lease.ConsumerKind == "cloud_file_operation" && lease.ReleasedAt == nil {
			busy, e := r.Busy(v.InstanceID, &lease.ID)
			if e != nil {
				return e
			}
			if !busy {
				now := time.Now().UTC().Truncate(time.Millisecond)
				lease.State = "released"
				lease.ReleasedAt = &now
				lease.UpdatedAt = now
				lease.FenceVersion++
				return r.SaveLease(lease)
			}
		}
	}
	return nil
}
