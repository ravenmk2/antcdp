package agents

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type cloudClaim struct {
	Computer   *CloudComputerRow
	Operation  *CloudOperationRow
	Connection CloudConnection
	Intent     cloudOperationIntent
}

func (s *CloudService) claimCloudOperation(ctx context.Context, id uint64) (*cloudClaim, error) {
	var out *cloudClaim
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		initial, e := cr.CloudOperation(id, false)
		if e != nil || initial == nil || initial.FinishedAt != nil {
			return e
		}
		connection, e := cr.Connection(true)
		if e != nil {
			return e
		}
		computer, e := cr.Computer(initial.ComputerID, true)
		if e != nil {
			return e
		}
		op, e := cr.CloudOperation(id, true)
		if e != nil {
			return e
		}
		if computer == nil || connection == nil || op == nil {
			return integrity()
		}
		if op.FinishedAt != nil {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if op.Status == "running" && op.ExecutorEpoch == s.Epoch && now.Before(op.DeadlineAt) {
			return nil
		}
		if connection.MaintenanceState != "normal" || connection.BackendGeneration != op.BackendGeneration || computer.BackendGeneration != op.BackendGeneration || computer.RuntimeGeneration != op.RuntimeGeneration || computer.StorageGeneration != op.StorageGeneration {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "云电脑代次已变化")
		}
		c := &cloudClaim{Computer: computer, Operation: op}
		if json.Unmarshal(op.Intent, &c.Intent) != nil {
			return integrity()
		}
		if op.Kind != "delete" || computer.RuntimeID != nil || computer.VolumeID != nil {
			c.Connection, e = s.runtimeConnection(connection)
			if e != nil {
				return e
			}
		}
		op.ExecutorEpoch = s.Epoch
		op.FenceVersion++
		op.Status = "running"
		op.UpdatedAt = now
		op.DeadlineAt = now.Add(5 * time.Minute)
		if op.StartedAt == nil {
			op.StartedAt = &now
		}
		if e = cr.SaveCloudOperation(op); e != nil {
			return e
		}
		out = c
		return nil
	})
	return out, e
}
func (s *CloudService) recordCloudIntent(ctx context.Context, c *cloudClaim) error {
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		v, e := cr.CloudOperation(c.Operation.ID, true)
		if e != nil {
			return e
		}
		if v == nil || v.FinishedAt != nil || v.FenceVersion != c.Operation.FenceVersion {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "维护操作已变化")
		}
		v.Intent, e = json.Marshal(c.Intent)
		if e != nil {
			return e
		}
		v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
		return cr.SaveCloudOperation(v)
	})
}
func (s *CloudService) createSpec(c *cloudClaim) (sandboxcore.CreateSpec, error) {
	var env CloudEnvironment
	if json.Unmarshal(c.Operation.TargetEnvironment, &env) != nil {
		return sandboxcore.CreateSpec{}, integrity()
	}
	policy, e := sandboxcore.SnapshotPolicy(sandboxcore.NetworkPolicy(env.Network))
	if e != nil {
		return sandboxcore.CreateSpec{}, e
	}
	protected := []string{}
	if s.ProtectedTargets != nil {
		protected, e = s.ProtectedTargets()
		if e != nil {
			return sandboxcore.CreateSpec{}, e
		}
	}
	endpoints, e := s.endpointProtection(c.Connection.Endpoint)
	if e != nil {
		return sandboxcore.CreateSpec{}, e
	}
	compiled, e := sandboxcore.CompilePolicy(policy, append(protected, endpoints...))
	if e != nil {
		return sandboxcore.CreateSpec{}, e
	}
	installation, e := s.InstallationID()
	if e != nil {
		return sandboxcore.CreateSpec{}, e
	}
	v := c.Computer
	if v.VolumeID == nil || v.VolumeName == nil || v.RuntimeCreationToken == nil {
		return sandboxcore.CreateSpec{}, integrity()
	}
	return sandboxcore.CreateSpec{BackendGeneration: v.BackendGeneration, Ownership: sandboxcore.Ownership{InstallationID: installation, ComputerID: v.ID, CreationToken: *v.RuntimeCreationToken}, Config: sandboxcore.EffectiveConfig{RuntimeBackend: "docker", Environment: sandboxcore.Environment{Image: env.Image, CPUMillicores: env.CPU, MemoryMiB: env.Memory}, Network: policy}, Network: compiled, Mount: sandboxcore.MountPlan{Kind: "named_volume", MountPath: "/data", VolumeID: *v.VolumeID, VolumeName: *v.VolumeName, CreateIfMissing: c.Intent.VolumeNew}}, nil
}
func cloudUnknown(code string) error { return &sandboxcore.Error{Code: code, Unknown: true} }

func (s *CloudService) terminateCloudRuntime(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
	ref := c.Intent.OriginalRuntime
	if ref == nil {
		return nil
	}
	actual, e := p.Inspect(ctx, *ref)
	if e != nil {
		return cloudUnknown("CLOUD_TERMINATION_UNCONFIRMED")
	}
	if actual.State == "absent" || actual.State == "terminated" {
		return nil
	}
	if !c.Intent.TerminateSent {
		c.Intent.TerminateSent = true
		if e = s.recordCloudIntent(ctx, c); e != nil {
			return e
		}
		if e = p.Terminate(ctx, *ref); e != nil {
			return e
		}
	}
	actual, e = p.Inspect(ctx, *ref)
	if e != nil || actual.State != "absent" && actual.State != "terminated" {
		return cloudUnknown("CLOUD_TERMINATION_UNCONFIRMED")
	}
	return nil
}
func (s *CloudService) observeCreated(ctx context.Context, c *cloudClaim, actual sandboxcore.Observation) error {
	if actual.Ref.RemoteID == "" {
		return cloudUnknown("CLOUD_CREATION_UNCONFIRMED")
	}
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		v, e := cr.Computer(c.Computer.ID, true)
		if e != nil {
			return e
		}
		op, e := cr.CloudOperation(c.Operation.ID, true)
		if e != nil {
			return e
		}
		if v == nil || op == nil || op.FenceVersion != c.Operation.FenceVersion || v.BackendGeneration != op.BackendGeneration || v.RuntimeGeneration != op.RuntimeGeneration || v.StorageGeneration != op.StorageGeneration {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "维护操作已变化")
		}
		if actual.Ref.Ownership != c.Intent.Create.Ownership {
			return cloudUnknown("CLOUD_OWNERSHIP_MISMATCH")
		}
		v.RuntimeID = &actual.Ref.RemoteID
		v.RuntimeExpiresAt = actual.ExpiresAt
		now := time.Now().UTC().Truncate(time.Millisecond)
		v.LastObservedAt = &now
		v.UpdatedAt = now
		if e = cr.SaveComputer(v); e != nil {
			return e
		}
		c.Computer = v
		return nil
	})
}
func (s *CloudService) provisionCloud(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
	if c.Operation.Kind == "rebuild" && c.Intent.Phase == "start" {
		if e := s.terminateCloudRuntime(ctx, c, p); e != nil {
			return e
		}
		c.Intent.Phase = "create"
		if e := s.recordCloudIntent(ctx, c); e != nil {
			return e
		}
	}
	if c.Intent.Create == nil {
		spec, e := s.createSpec(c)
		if e != nil {
			return e
		}
		c.Intent.Create = &spec
		if e = s.recordCloudIntent(ctx, c); e != nil {
			return e
		}
	}
	var actual sandboxcore.Observation
	var e error
	if c.Computer.RuntimeID != nil {
		ref, e := s.resource(c.Computer)
		if e != nil {
			return e
		}
		actual, e = p.Inspect(ctx, ref)
		if e != nil {
			return cloudUnknown("CLOUD_CREATION_UNCONFIRMED")
		}
	} else if c.Intent.CreateSent {
		found, e := p.Find(ctx, c.Intent.Create.Ownership, 1, 2)
		if e != nil || found.HasMore || len(found.Items) != 1 {
			return cloudUnknown("CLOUD_CREATION_UNCONFIRMED")
		}
		actual = found.Items[0]
	} else {
		c.Intent.CreateSent = true
		if e = s.recordCloudIntent(ctx, c); e != nil {
			return e
		}
		actual, e = p.Create(ctx, *c.Intent.Create)
		if actual.Ref.RemoteID != "" {
			if save := s.observeCreated(context.WithoutCancel(ctx), c, actual); save != nil {
				// A remote resource exists even if its identifier could not be saved.
				// Keep the operation open so recovery finds the original token.
				return cloudUnknown("CLOUD_CREATION_UNCONFIRMED")
			}
		}
		if e != nil {
			if actual.Ref.RemoteID != "" {
				return cloudUnknown(remoteSandboxError(e))
			}
			return e
		}
	}
	if e = s.observeCreated(ctx, c, actual); e != nil {
		return cloudUnknown("CLOUD_CREATION_UNCONFIRMED")
	}
	if actual.State == "starting" || actual.State == "unknown" {
		return cloudUnknown("CLOUD_STARTING")
	}
	if actual.State != "ready" {
		return &sandboxcore.Error{Code: "CLOUD_RUNTIME_UNAVAILABLE"}
	}
	if actual.ExpiresAt != nil {
		return &sandboxcore.Error{Code: "CLOUD_PERSISTENT_LIFETIME_UNSUPPORTED"}
	}
	access := &SandboxAccess{Provider: p, Resource: actual.Ref, ComputerID: c.Computer.ID, BackendGeneration: c.Computer.BackendGeneration, RuntimeGeneration: c.Computer.RuntimeGeneration, StorageGeneration: c.Computer.StorageGeneration, OperationID: c.Operation.ID, OperationFence: c.Operation.FenceVersion, CWD: "/data/workspace"}
	if s.VerifyEnvironment == nil || s.PrepareWorkspace == nil {
		return unavailable()
	}
	caps, _, e := s.VerifyEnvironment(ctx, access)
	if e != nil {
		return e
	}
	if e = s.PrepareWorkspace(ctx, access, 0, 0); e != nil {
		return e
	}
	caps.Lifecycle, caps.PersistentWorkspace, caps.FileTransfer, caps.Cancellation = "supported", "supported", "supported", "supported"
	if _, ok := p.(sandboxcore.VolumeControl); ok {
		caps.VolumeDeletion = "supported"
	}
	c.Computer.Capabilities, e = json.Marshal(caps)
	return e
}
func (s *CloudService) transitionCloud(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
	if c.Intent.OriginalRuntime == nil {
		return &sandboxcore.Error{Code: "CLOUD_RUNTIME_MISSING"}
	}
	ref := *c.Intent.OriginalRuntime
	actual, e := p.Inspect(ctx, ref)
	if e != nil {
		if c.Intent.TransitionSent {
			return cloudUnknown("CLOUD_TRANSITION_UNCONFIRMED")
		}
		return e
	}
	target := "paused"
	if c.Operation.Kind == "resume" {
		target = "ready"
	}
	if actual.State == target {
		return nil
	}
	control, ok := p.(sandboxcore.LifecycleControl)
	if !ok {
		return &sandboxcore.Error{Code: "CLOUD_PAUSE_UNSUPPORTED"}
	}
	if !c.Intent.TransitionSent {
		c.Intent.TransitionSent = true
		if e = s.recordCloudIntent(ctx, c); e != nil {
			return e
		}
		if target == "paused" {
			e = control.Pause(ctx, ref)
		} else {
			e = control.Resume(ctx, ref)
		}
		if e != nil {
			return e
		}
	}
	actual, e = p.Inspect(ctx, ref)
	if e != nil || actual.State != target {
		return cloudUnknown("CLOUD_TRANSITION_UNCONFIRMED")
	}
	return nil
}
func (s *CloudService) deleteCloud(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
	if e := s.terminateCloudRuntime(ctx, c, p); e != nil {
		return e
	}
	if c.Computer.VolumeID == nil {
		return nil
	}
	control, ok := p.(sandboxcore.VolumeControl)
	if !ok {
		return &sandboxcore.Error{Code: "CLOUD_VOLUME_DELETION_UNSUPPORTED"}
	}
	installation, e := s.InstallationID()
	if e != nil {
		return e
	}
	ref := sandboxcore.VolumeRef{InstallationID: installation, ComputerID: c.Computer.ID, ID: *c.Computer.VolumeID, Name: *c.Computer.VolumeName}
	exists, e := control.VolumeExists(ctx, ref)
	if e != nil {
		return cloudUnknown("CLOUD_VOLUME_DELETION_UNCONFIRMED")
	}
	if !exists {
		return nil
	}
	if c.Intent.Phase != "volume_delete_sent" {
		c.Intent.Phase = "volume_delete_sent"
		if e = s.recordCloudIntent(ctx, c); e != nil {
			return e
		}
		if e = control.DeleteVolume(ctx, ref); e != nil {
			return e
		}
	}
	exists, e = control.VolumeExists(ctx, ref)
	if e != nil || exists {
		return cloudUnknown("CLOUD_VOLUME_DELETION_UNCONFIRMED")
	}
	return nil
}
func (s *CloudService) finishCloudOperation(ctx context.Context, c *cloudClaim, cause error) error {
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, cr CloudRepository) error {
		connection, e := cr.Connection(true)
		if e != nil {
			return e
		}
		v, e := cr.Computer(c.Computer.ID, true)
		if e != nil {
			return e
		}
		op, e := cr.CloudOperation(c.Operation.ID, true)
		if e != nil {
			return e
		}
		if op == nil || v == nil || connection == nil || op.FenceVersion != c.Operation.FenceVersion || op.FinishedAt != nil || connection.BackendGeneration != op.BackendGeneration || v.BackendGeneration != op.BackendGeneration || v.RuntimeGeneration != op.RuntimeGeneration || v.StorageGeneration != op.StorageGeneration {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "维护操作已变化")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		status := "succeeded"
		var code *string
		var uncertain *sandboxcore.Error
		if cause != nil {
			status = "failed"
			reason := remoteSandboxError(cause)
			code = &reason
			if errors.As(cause, &uncertain) && uncertain.Unknown {
				status = "outcome_unknown"
			}
		}
		activity, e := cr.CloudActivity(v.ID)
		if e != nil {
			return e
		}
		// A failed helper can still be executing. Its physical hold must keep
		// this lifecycle operation open, even when the helper returned an error.
		if activity.Operations > 1 || activity.References > 0 || activity.Transfers > 0 || activity.Unknown > 0 {
			status = "outcome_unknown"
			if code == nil {
				reason := "CLOUD_HELPER_UNCONFIRMED"
				code = &reason
			}
		}
		op.Status, op.ErrorCode, op.UpdatedAt = status, code, now
		if status != "outcome_unknown" {
			op.FinishedAt = &now
		}
		v.ErrorCode, v.UpdatedAt = code, now
		v.RowVersion++
		switch status {
		case "succeeded":
			switch op.Kind {
			case "create", "rebuild":
				v.State = "ready"
				v.VolumeState = "ready"
				v.AppliedTemplateVersion = op.TargetTemplateVersion
				v.EffectiveEnvironment = op.TargetEnvironment
				v.Capabilities = c.Computer.Capabilities
			case "pause":
				v.State = "paused"
			case "resume":
				v.State = "ready"
			case "delete":
				v.State = "deleted"
				v.DeletedAt = &now
				v.RuntimeID = nil
				v.RuntimeCreationToken = nil
				v.VolumeState = "deleted"
				v.VolumeCleanupState = "completed"
				connection.TopologyVersion++
				connection.UpdatedAt = now
				if e = cr.SaveConnection(connection); e != nil {
					return e
				}
			}
		case "failed":
			if op.Kind == "delete" {
				v.State = "deleting"
				v.VolumeCleanupState = "failed"
			} else {
				v.State = "unavailable"
			}
		}
		if e = cr.SaveComputer(v); e != nil {
			return e
		}
		if e = cr.SaveCloudOperation(op); e != nil {
			return e
		}
		if op.PublicOperationID != nil {
			public, e := st.PublicOperation(*op.PublicOperationID, true)
			if e != nil {
				return e
			}
			if public == nil {
				return integrity()
			}
			public.Status, public.ErrorCode, public.StartedAt, public.FinishedAt, public.UpdatedAt = status, code, op.StartedAt, op.FinishedAt, now
			public.Result, e = json.Marshal(map[string]any{"cloud_computer_id": idString(v.ID), "state": v.State, "volume_cleanup_state": v.VolumeCleanupState})
			if e != nil {
				return e
			}
			return st.SavePublicOperation(public)
		}
		return nil
	})
}
func (s *CloudService) processCloudOperation(ctx context.Context, id uint64) error {
	c, e := s.claimCloudOperation(ctx, id)
	if e != nil || c == nil {
		return e
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	if c.Operation.Kind == "delete" && c.Computer.RuntimeID == nil && c.Computer.VolumeID == nil {
		return s.finishCloudOperation(ctx, c, nil)
	}
	p, e := s.openProvider(bounded, c.Connection)
	if e == nil {
		switch c.Operation.Kind {
		case "create", "rebuild":
			e = s.provisionCloud(bounded, c, p)
		case "pause", "resume":
			e = s.transitionCloud(bounded, c, p)
		case "delete":
			e = s.deleteCloud(bounded, c, p)
		default:
			e = integrity()
		}
	}
	cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer done()
	return s.finishCloudOperation(cleanup, c, e)
}
func (s *CloudService) ProcessPending(ctx context.Context, limit int) error {
	var rows []CloudOperationRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		var e error
		rows, e = cr.PendingCloudOperations(s.Epoch, time.Now().UTC(), limit)
		return e
	})
	if e != nil {
		return e
	}
	var errs []error
	for _, row := range rows {
		if e = s.processCloudOperation(ctx, row.ID); e != nil {
			errs = append(errs, e)
		}
	}
	if e = s.reconcileCloudLeases(ctx, limit*4); e != nil {
		errs = append(errs, e)
	}
	return errors.Join(errs...)
}
func (s *CloudService) CancelFamily(ctx context.Context, x agentcore.ExecutionContext) error {
	var rows []CloudExecutionRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		var e error
		rows, e = cr.LeaseExecutions(uint64(x.Ref.RootRunID))
		return e
	})
	if e != nil {
		return e
	}
	var errs []error
	for _, row := range rows {
		if row.FinishedAt == nil {
			if e = s.reconcileCommand(ctx, row, true); e != nil {
				errs = append(errs, e)
			}
		}
	}
	return errors.Join(errs...)
}
func (s *CloudService) Reconcile(ctx context.Context, x agentcore.ExecutionContext) error {
	if s.ExecutionReconciler != nil {
		return s.ExecutionReconciler(ctx, uint64(x.Ref.RootRunID))
	}
	return nil
}
