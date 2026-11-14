package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// validateHolder prevents a reference without a durable owner. Maintenance and
// file helpers use their real operation row, never a fabricated tool call.
func validateSandboxHolder(st StateRepository, repo CloudRepository, kind, id string, computerID, bindingID uint64) error {
	n, e := strconv.ParseUint(id, 10, 64)
	if e != nil || n == 0 {
		return integrity()
	}
	switch kind {
	case "cloud_execution":
		v, e := repo.CloudExecution(n, false)
		if e != nil {
			return e
		}
		if v == nil || v.RootRunID != bindingID || v.FinishedAt != nil {
			return httpx.E(409, "EXECUTION_NOT_ACTIVE", "远端执行记录不可用")
		}
		b, e := repo.Lease(v.RootRunID, false)
		if e != nil {
			return e
		}
		if b == nil || b.ComputerID == 0 || b.ComputerID != computerID {
			return integrity()
		}
	case "cloud_operation", "cloud_file_operation":
		v, e := repo.CloudOperation(n, false)
		if e != nil {
			return e
		}
		if v == nil || v.ComputerID == 0 || v.ComputerID != computerID || (v.Status != "queued" && v.Status != "running" && v.Status != "outcome_unknown") {
			return httpx.E(409, "OPERATION_NOT_ACTIVE", "操作已结束或工作空间不匹配")
		}
	case "file_operation":
		v, e := st.FileOperation(n, false)
		if e != nil {
			return e
		}
		if v == nil || v.ComputerID != computerID || (bindingID != 0 && v.BindingID != bindingID) || v.FinishedAt != nil {
			return httpx.E(409, "OPERATION_NOT_ACTIVE", "文件操作已结束或绑定不匹配")
		}
	case "tool_call":
		v, e := st.ToolCall(n, false)
		if e != nil {
			return e
		}
		if v == nil || v.ResultEventSeq != nil || v.DispatchToken == nil {
			return httpx.E(409, "TOOL_NOT_DISPATCHING", "工具尚未派发或已结束")
		}
	default:
		return httpx.Invalid("holder_kind", "unsupported")
	}
	return nil
}

func (s *CloudService) acquireReferences(st StateRepository, repo CloudRepository, access *SandboxAccess, kind, id string) error {
	if e := validateSandboxHolder(st, repo, kind, id, access.ComputerID, access.BindingID); e != nil {
		return e
	}
	previous, e := repo.HolderReferences(kind, id, true)
	if e != nil {
		return e
	}
	resources := []struct {
		kind string
		id   uint64
	}{{"cloud_computer", access.ComputerID}}
	if access.BindingID != 0 {
		resources = append(resources, struct {
			kind string
			id   uint64
		}{"cloud_lease", access.BindingID})
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	for _, resource := range resources {
		var match *ResourceReferenceRow
		for i := range previous {
			if previous[i].ResourceKind == resource.kind && previous[i].ResourceID == resource.id {
				match = &previous[i]
				break
			}
		}
		if match != nil {
			if match.State != "active" || match.ExecutorEpoch != s.Epoch {
				return httpx.E(409, "REFERENCE_NOT_REUSABLE", "原操作引用需要核实，不能重新执行")
			}
			access.ReferenceIDs = append(access.ReferenceIDs, match.ID)
			continue
		}
		v := ResourceReferenceRow{HolderKind: kind, HolderID: id, ResourceKind: resource.kind, ResourceID: resource.id, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		if e := st.InsertResourceReference(&v); e != nil {
			return e
		}
		access.ReferenceIDs = append(access.ReferenceIDs, v.ID)
	}
	return nil
}

func (s *CloudService) AcquireExecutionComputer(ctx context.Context, ref agentcore.ExecutionRef, toolCallID uint64, holderKind, holderID string) (*SandboxAccess, error) {
	var out *SandboxAccess
	var connection CloudConnection
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		call, e := st.ToolCall(toolCallID, true)
		if e != nil {
			return e
		}
		if call == nil || call.RunID != x.Run.ID || call.RootRunID != x.Root.ID || call.ResultEventSeq != nil || call.DispatchToken == nil {
			return httpx.E(409, "TOOL_NOT_DISPATCHING", "工具尚未派发或已结束")
		}
		binding, e := repo.Lease(x.Root.ID, false)
		if e != nil {
			return e
		}
		if binding == nil || binding.ComputerID == 0 {
			return httpx.E(409, "SANDBOX_NOT_READY", "当前执行没有可用沙箱")
		}
		out, connection, e = s.accessRows(repo, binding.ComputerID, binding)
		if e != nil {
			return e
		}
		out.CWD = x.Context.Row.CWD
		out.Execution = &ref
		return s.acquireReferences(st, repo, out, holderKind, holderID)
	})
	if e != nil {
		return nil, e
	}
	out.Provider, e = s.openProvider(ctx, connection)
	if e != nil {
		_ = s.ReleaseReferences(ctx, out, json.RawMessage(`{"physical_request_started":false}`))
		return nil, e
	}
	return out, nil
}

// Personal contents are always owner-only, even for administrators. Admin
// instance maintenance uses the separate metadata-only operation entry points.
func (s *CloudService) AcquireWorkspaceAccess(ctx context.Context, raw string, computerID uint64, holderKind, holderID string, maintenance bool) (*SandboxAccess, error) {
	var out *SandboxAccess
	var connection CloudConnection
	_, e := s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository, a *identity.Auth, result *Result) error {
		w, e := repo.Computer(computerID, true)
		if e != nil {
			return e
		}
		if e = workspaceContentAccess(w, a); e != nil {
			return e
		}
		out, connection, e = s.accessRows(repo, computerID, nil)
		if e != nil {
			return e
		}
		if maintenance {
			activity, e := repo.CloudActivity(computerID)
			if e != nil {
				return e
			}
			if activity.Leases > 0 || activity.References > 0 || activity.Unknown > 0 {
				return httpx.E(409, "WORKSPACE_BUSY", "工作空间仍有运行或待核实引用")
			}
		}
		return s.acquireReferences(st, repo, out, holderKind, holderID)
	})
	if e != nil {
		return nil, e
	}
	out.Provider, e = s.openProvider(ctx, connection)
	if e != nil {
		_ = s.ReleaseReferences(ctx, out, json.RawMessage(`{"physical_request_started":false}`))
		return nil, e
	}
	return out, nil
}

func (s *CloudService) finishReferences(ctx context.Context, access *SandboxAccess, state, reason string, evidence json.RawMessage) error {
	if access == nil || len(access.ReferenceIDs) == 0 {
		return nil
	}
	if len(evidence) == 0 || !json.Valid(evidence) || len(evidence) > 64<<10 {
		return integrity()
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.cloudBackground(cleanup, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		// Lock the same resource before references: maintenance/GC cannot slip
		// between the verification and reference transition.
		if _, e := repo.Computer(access.ComputerID, true); e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		for _, id := range access.ReferenceIDs {
			v, e := st.ResourceReference(id, true)
			if e != nil {
				return e
			}
			if v == nil {
				return integrity()
			}
			if v.State == "released" {
				continue
			}
			if v.ResourceKind == "cloud_computer" && v.ResourceID != access.ComputerID {
				return integrity()
			}
			if v.ResourceKind == "cloud_lease" && v.ResourceID != access.BindingID {
				return integrity()
			}
			v.State = state
			v.UpdatedAt = now
			v.FenceVersion++
			v.ReleaseReason = &reason
			v.ReleaseEvidence = evidence
			if state == "released" {
				v.ReleasedAt = &now
				v.LastVerifiedAt = &now
			}
			if e = st.SaveResourceReference(v); e != nil {
				return e
			}
		}
		return nil
	})
}

// ReleaseReferences is called only by trusted host code after verified physical
// completion, or when it knows no remote request was sent. Run termination alone
// is not sufficient evidence. Unknown references may be released by reconciliation.
func (s *CloudService) ReleaseReferences(ctx context.Context, access *SandboxAccess, evidence json.RawMessage) error {
	return s.finishReferences(ctx, access, "released", "physical_completion_verified", evidence)
}
func (s *CloudService) MarkReferencesUnknown(ctx context.Context, access *SandboxAccess, reason string, evidence json.RawMessage) error {
	return s.finishReferences(ctx, access, "unknown", reason, evidence)
}
