package mysql

import (
	"errors"
	"strconv"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	s "github.com/ravenmk2/antcdp/internal/modules/sandboxes"
)

// Product allocation and the physical hold commit atomically. Neither a Run's
// completion nor a lease deadline is evidence of remote command completion.
func (t *agentsTx) syncSandboxLease(v *a.CloudLeaseRow) error {
	if v.InstanceID == nil || *v.InstanceID == 0 {
		return nil
	}
	r := t.Sandbox()
	instance, err := r.Instance(*v.InstanceID, true)
	if err != nil {
		return err
	}
	if instance == nil {
		return errors.New("sandbox instance missing")
	}
	var lease *s.Lease
	if v.SandboxLeaseID != nil {
		lease, err = r.Lease(*v.SandboxLeaseID, true)
		if err != nil {
			return err
		}
		if lease == nil || lease.InstanceID != instance.ID {
			return errors.New("sandbox lease instance mismatch")
		}
	}
	if lease == nil {
		if v.ReleasedAt != nil {
			return nil
		}
		others, e := r.Leases(instance.ID)
		if e != nil {
			return e
		}
		for _, other := range others {
			if other.Mode != "observer" && (other.Mode == "exclusive" || v.Mode == "exclusive") {
				return errors.New("sandbox already occupied")
			}
		}
		lease = &s.Lease{InstanceID: instance.ID, ConsumerKind: "agent_run", ConsumerID: strconv.FormatUint(v.RootRunID, 10), Mode: v.Mode, State: v.State, ExecutorEpoch: v.ExecutorEpoch, FenceVersion: 1, AcquiredAt: v.AcquiredAt, ExpiresAt: v.LeaseExpiresAt, UpdatedAt: v.UpdatedAt}
		if e = r.InsertLease(lease); e != nil {
			return e
		}
		v.SandboxLeaseID = &lease.ID
		return nil
	}
	if lease.ReleasedAt != nil {
		v.State, v.ReleasedAt, v.ReleaseReason = lease.State, lease.ReleasedAt, lease.ReleaseReason
		return nil
	}
	if v.ReleasedAt != nil && lease.ReleasedAt == nil {
		busy, e := r.Busy(instance.ID, &lease.ID)
		if e != nil {
			return e
		}
		if busy {
			return errors.New("sandbox work remains unresolved")
		}
		lease.FenceVersion++
	}
	lease.State = v.State
	lease.ExpiresAt = v.LeaseExpiresAt
	lease.ReleasedAt = v.ReleasedAt
	lease.ReleaseReason = v.ReleaseReason
	lease.UpdatedAt = v.UpdatedAt
	return r.SaveLease(lease)
}
