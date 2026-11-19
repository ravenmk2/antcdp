package cloudcomputers

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func integrity() error         { return httpx.E(500, "DATA_INTEGRITY_ERROR", "云电脑数据完整性异常") }
func unavailable() error       { return httpx.E(503, "SERVICE_UNAVAILABLE", "云电脑服务暂不可用") }
func idString(v uint64) string { return strconv.FormatUint(v, 10) }
func maintenanceKind(v string) bool {
	return v == "create" || v == "rebuild" || v == "pause" || v == "resume" || v == "delete"
}
func remoteSandboxError(e error) string {
	if e == nil {
		return ""
	}
	var core *sandboxcore.Error
	if errors.As(e, &core) {
		return core.Code
	}
	var public *httpx.Error
	if errors.As(e, &public) {
		return public.Code
	}
	if errors.Is(e, context.DeadlineExceeded) {
		return "SANDBOX_DEADLINE_EXCEEDED"
	}
	if errors.Is(e, context.Canceled) {
		return "SANDBOX_INTERRUPTED"
	}
	return "SANDBOX_UNAVAILABLE"
}

type cloudClaim struct {
	Computer   *Computer
	Operation  *Operation
	Connection Connection
	Intent     OperationIntent
}

func (s *Service) claimCloudOperation(ctx context.Context, id uint64) (*cloudClaim, error) {
	var out *cloudClaim
	e := s.Transact(ctx, func(cr Repository) error {
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
		if connection.MaintenanceState != "normal" || connection.BackendGeneration != op.BackendGeneration || computer.BackendGeneration != op.BackendGeneration || computer.InstanceID != op.InstanceID || computer.StorageGeneration != op.StorageGeneration {
			return httpx.E(409, "CLOUD_OPERATION_FENCED", "云电脑代次已变化")
		}
		c := &cloudClaim{Computer: computer, Operation: op}
		if json.Unmarshal(op.Intent, &c.Intent) != nil {
			return integrity()
		}
		if op.Kind != "delete" || computer.RuntimeID != nil || computer.VolumeID != nil {
			c.Connection, e = s.DecodeConnection(connection)
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
func (s *Service) recordCloudIntent(ctx context.Context, c *cloudClaim) error {
	return s.Transact(ctx, func(cr Repository) error {
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
func (s *Service) createSpec(c *cloudClaim) (sandboxcore.CreateSpec, error) {
	var env Environment
	if json.Unmarshal(c.Operation.TargetEnvironment, &env) != nil {
		return sandboxcore.CreateSpec{}, integrity()
	}
	policy := env.Network
	e := sandboxcore.ValidateSnapshot(policy)
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
	endpoints, e := s.EndpointProtection(c.Connection.Endpoint)
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
	return sandboxcore.CreateSpec{BackendGeneration: v.BackendGeneration, Ownership: sandboxcore.Ownership{InstallationID: installation, InstanceID: v.InstanceID, CreationToken: *v.RuntimeCreationToken}, Config: sandboxcore.EffectiveConfig{RuntimeBackend: "docker", Environment: sandboxcore.Environment{Image: env.Image, CPUMillicores: env.CPU, MemoryMiB: env.Memory}, Network: policy}, Network: compiled, Mount: sandboxcore.MountPlan{Kind: "named_volume", MountPath: "/data", VolumeID: *v.VolumeID, VolumeName: *v.VolumeName, CreateIfMissing: c.Intent.VolumeNew}}, nil
}
func cloudUnknown(code string) error { return &sandboxcore.Error{Code: code, Unknown: true} }

func (s *Service) terminateCloudRuntime(ctx context.Context, c *cloudClaim, _ sandboxcore.Provider) error {
	if c.Intent.OriginalRuntime == nil {
		return nil
	}
	return s.Sandboxes.Transition(ctx, c.Intent.OriginalRuntime.Ownership.InstanceID, "delete", "delete/"+c.Operation.OperationToken, false)
}

func (s *Service) observeCreated(ctx context.Context, c *cloudClaim, actual sandboxcore.Observation) error {
	if actual.Ref.RemoteID == "" {
		return cloudUnknown("CLOUD_CREATION_UNCONFIRMED")
	}
	return s.Transact(ctx, func(cr Repository) error {
		v, e := cr.Computer(c.Computer.ID, true)
		if e != nil {
			return e
		}
		op, e := cr.CloudOperation(c.Operation.ID, true)
		if e != nil {
			return e
		}
		if v == nil || op == nil || op.FenceVersion != c.Operation.FenceVersion || v.BackendGeneration != op.BackendGeneration || v.InstanceID != op.InstanceID || v.StorageGeneration != op.StorageGeneration {
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
func (s *Service) provisionCloud(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
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
	instance, e := s.Sandboxes.Create(ctx, c.Computer.InstanceID, *c.Intent.Create)
	if e != nil {
		return e
	}
	ref, e := s.Sandboxes.Resource(instance)
	if e != nil {
		return e
	}
	actual := sandboxcore.Observation{Ref: ref, State: instance.State, ExpiresAt: instance.ExpiresAt}
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
	access := &Access{Provider: p, Resource: actual.Ref, ComputerID: c.Computer.ID, BackendGeneration: c.Computer.BackendGeneration, InstanceID: c.Computer.InstanceID, StorageGeneration: c.Computer.StorageGeneration, OperationID: c.Operation.ID, OperationFence: c.Operation.FenceVersion, CWD: "/data/home"}
	if s.VerifyEnvironment == nil || s.PrepareWorkspace == nil {
		return unavailable()
	}
	caps, _, e := s.VerifyEnvironment(ctx, access)
	if e != nil {
		return e
	}
	if e = s.PrepareWorkspace(ctx, access, 0); e != nil {
		return e
	}
	caps.Lifecycle, caps.PersistentWorkspace, caps.FileTransfer, caps.Cancellation = "supported", "supported", "supported", "supported"
	if _, ok := p.(sandboxcore.VolumeControl); ok {
		caps.VolumeDeletion = "supported"
	}
	c.Computer.Capabilities, e = json.Marshal(caps)
	return e
}
func (s *Service) transitionCloud(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
	kind := "pause"
	if c.Operation.Kind == "resume" {
		kind = "resume"
	}
	return s.Sandboxes.Transition(ctx, c.Computer.InstanceID, kind, kind+"/"+c.Operation.OperationToken, false)
}

func (s *Service) deleteCloud(ctx context.Context, c *cloudClaim, p sandboxcore.Provider) error {
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
	ref := sandboxcore.VolumeRef{InstallationID: installation, InstanceID: c.Computer.InstanceID, ID: *c.Computer.VolumeID, Name: *c.Computer.VolumeName}
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
func (s *Service) finishCloudOperation(ctx context.Context, c *cloudClaim, cause error) error {
	cause = diagnostic.With(cause, diagnostic.Detail{Source: "sandbox", Stage: c.Operation.Kind, Code: remoteSandboxError(cause), OperationID: idString(c.Operation.ID), InstanceID: idString(c.Operation.InstanceID)})
	return s.Transact(ctx, func(cr Repository) error {
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
		if op == nil || v == nil || connection == nil || op.FenceVersion != c.Operation.FenceVersion || op.FinishedAt != nil || connection.BackendGeneration != op.BackendGeneration || v.BackendGeneration != op.BackendGeneration || v.InstanceID != op.InstanceID || v.StorageGeneration != op.StorageGeneration {
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
		// An uncertain file action can still be executing. Its physical hold keeps
		// this lifecycle operation open until the outcome is known.
		if activity.Operations > 1 || activity.References > 0 || activity.Transfers > 0 || activity.Unknown > 0 {
			status = "outcome_unknown"
			if code == nil {
				reason := "CLOUD_FILESYSTEM_UNCONFIRMED"
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
				v.AppliedSpecID, v.AppliedSpecVersion = op.TargetSpecID, op.TargetSpecVersion
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
				if e = cr.BumpConnectionTopology(); e != nil {
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
		if op.Observation, e = diagnostic.Put(op.Observation, diagnostic.From(cause)); e != nil {
			return e
		}
		if e = cr.SaveCloudOperation(op); e != nil {
			return e
		}
		if maintenanceKind(op.Kind) {
			op.Observation, e = json.Marshal(map[string]any{"cloud_computer_id": idString(v.ID), "state": v.State, "volume_cleanup_state": v.VolumeCleanupState})
			if e != nil {
				return e
			}
			if op.Observation, e = diagnostic.Put(op.Observation, diagnostic.From(cause)); e != nil {
				return e
			}
			return cr.SaveCloudOperation(op)
		}
		return nil
	})
}
func (s *Service) ProcessOperation(ctx context.Context, id uint64) error {
	c, e := s.claimCloudOperation(ctx, id)
	if e != nil || c == nil {
		return e
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	if c.Operation.Kind == "delete" && c.Computer.RuntimeID == nil && c.Computer.VolumeID == nil {
		return s.finishCloudOperation(ctx, c, nil)
	}
	p, e := s.OpenProvider(bounded, c.Connection)
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
