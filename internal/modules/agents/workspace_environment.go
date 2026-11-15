package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type environmentOperationResult struct {
	Responses []workspace.Response `json:"responses"`
}

func (s *CloudService) environmentToken(access *SandboxAccess, purpose string) string {
	value := fmt.Sprintf("sandbox/environment/%s/%d/%d/%d/%d/%s", purpose, access.ComputerID, access.InstanceID, access.BindingID, access.OperationID, access.Resource.Ownership.CreationToken)
	return hex.EncodeToString(cryptox.Digest(s.Host.ETag(value)))[:32]
}

// Environment setup is a durable workspace operation. Re-entering the same
// binding/maintenance intent returns its committed result; an uncertain operation
// is observed by the workspace reconciler, never invoked a second time.
func (s *CloudService) environmentRequests(ctx context.Context, original *SandboxAccess, kind, purpose string, requests []workspace.Request) ([]workspace.Response, error) {
	if original == nil || original.Provider == nil {
		return nil, integrity()
	}
	access := *original
	access.ReferenceIDs = nil
	access.WorkspaceOperationID = 0
	access.WorkspaceOperationFence = 0
	token := s.environmentToken(&access, purpose)
	var op *CloudOperationRow
	created := false
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		if access.Execution != nil {
			if _, e := s.Host.lockExecution(tx, r, st, *access.Execution, true); e != nil {
				return e
			}
		}
		w, e := repo.Computer(access.ComputerID, true)
		if e != nil {
			return e
		}
		instance, e := repo.Computer(access.ComputerID, true)
		if e != nil {
			return e
		}
		if w == nil || instance == nil || instance.ID != w.ID || instance.BackendGeneration != access.BackendGeneration || instance.InstanceID != access.InstanceID || (instance.State != "ready" && instance.State != "provisioning") {
			return httpx.E(409, "SANDBOX_NOT_READY", "环境初始化目标尚未就绪")
		}
		if access.BindingID != 0 {
			binding, e := repo.Lease(access.BindingID, true)
			if e != nil {
				return e
			}
			if binding == nil || binding.FenceVersion != access.BindingFence || (binding.State != "active" && binding.State != "preparing") {
				return httpx.E(409, "BINDING_FENCED", "环境初始化绑定已变化")
			}
		} else {
			parent, e := repo.CloudOperation(access.OperationID, true)
			if e != nil {
				return e
			}
			if parent == nil || parent.FenceVersion != access.OperationFence || parent.Status != "running" {
				return httpx.E(409, "OPERATION_FENCED", "环境维护操作已变化")
			}
			if (parent.Kind != "create" && parent.Kind != "rebuild") || parent.ComputerID != instance.ID || parent.InstanceID != instance.InstanceID {
				return httpx.E(409, "OPERATION_FENCED", "环境维护目标已变化")
			}
		}
		previous, e := repo.CloudOperationByToken(token, false)
		if e != nil {
			return e
		}
		created = previous == nil
		op, e = s.startWorkspaceOperation(st, repo, &access, kind, "system", "system", requests, token)
		return e
	})
	if e != nil {
		return nil, e
	}
	if !created {
		if op.Status != "completed" {
			if op.FinishedAt == nil {
				return nil, httpx.E(409, "WORKSPACE_RECONCILING", "原环境操作尚未核实")
			}
			reason := "WORKSPACE_INITIALIZATION_FAILED"
			if op.ErrorCode != nil {
				reason = *op.ErrorCode
			}
			return nil, httpx.E(409, reason, "原环境操作失败，请核实实例后再重新运行")
		}
		var observation workspaceOperationObservation
		var result environmentOperationResult
		if json.Unmarshal(op.Observation, &observation) != nil || json.Unmarshal(observation.Result, &result) != nil || len(result.Responses) != len(requests) {
			return nil, integrity()
		}
		return result.Responses, nil
	}
	responses := []workspace.Response{}
	for _, request := range requests {
		response, err := s.workspaceRequest(ctx, &access, op.ID, request)
		responses = append(responses, response)
		if err != nil {
			e = err
			break
		}
	}
	if finish := s.finishWorkspaceOperation(ctx, op.ID, &access, environmentOperationResult{Responses: responses}, e); e == nil {
		e = finish
	}
	return responses, e
}

func (s *CloudService) InitializeComputer(ctx context.Context, access *SandboxAccess, agentID uint64) error {
	if access == nil || !workspace.ValidCWD(access.CWD) {
		return integrity()
	}
	request := workspace.Request{Operation: "initialize", Path: strings.TrimPrefix(access.CWD, "/data/")}
	if agentID != 0 {
		request.AgentID = idString(agentID)
	}
	results, e := s.environmentRequests(ctx, access, "workspace_prepare", fmt.Sprintf("initialize/%s/%d", access.CWD, agentID), []workspace.Request{request})
	if e != nil {
		return e
	}
	var result struct {
		CWD string `json:"cwd"`
	}
	if len(results) != 1 || json.Unmarshal(results[0].Result, &result) != nil {
		return integrity()
	}
	if result.CWD != access.CWD {
		return integrity()
	}
	return nil
}
func (s *CloudService) VerifyWorkspaceEnvironment(ctx context.Context, access *SandboxAccess) (SandboxCapabilities, []DiagnosticCheck, error) {
	caps := unknownSandboxCapabilities()
	_, err := s.environmentRequests(ctx, access, "workspace_verify", "native-v1", []workspace.Request{{Operation: "verify_native"}})
	if err != nil {
		return caps, []DiagnosticCheck{diagnosticCheck("native_filesystem", "failed", remoteSandboxError(err))}, err
	}
	caps.Execution, caps.ExecutionInspection = "supported", "supported"
	return caps, []DiagnosticCheck{diagnosticCheck("native_filesystem", "succeeded", ""), diagnosticCheck("environment_security", "unknown", "provider_managed")}, nil
}
