package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type environmentOperationResult struct {
	Responses []workspacefs.Response `json:"responses"`
}

func (s *CloudService) environmentToken(access *SandboxAccess, purpose string) string {
	value := fmt.Sprintf("sandbox/environment/%s/%d/%d/%d/%d/%s", purpose, access.ComputerID, access.RuntimeGeneration, access.BindingID, access.OperationID, access.Resource.Ownership.CreationToken)
	return hex.EncodeToString(cryptox.Digest(s.Host.ETag(value)))[:32]
}

// Environment setup is a durable helper operation. Re-entering the same
// binding/maintenance intent returns its committed result; an uncertain helper
// is observed by the workspace reconciler, never invoked a second time.
func (s *CloudService) environmentRequests(ctx context.Context, original *SandboxAccess, kind, purpose string, requests []workspacefs.Request) ([]workspacefs.Response, error) {
	if original == nil || original.Provider == nil {
		return nil, integrity()
	}
	access := *original
	access.ReferenceIDs = nil
	access.HelperOperationID = 0
	access.HelperOperationFence = 0
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
		if w == nil || instance == nil || instance.ID != w.ID || instance.BackendGeneration != access.BackendGeneration || instance.RuntimeGeneration != access.RuntimeGeneration || (instance.State != "ready" && instance.State != "provisioning") {
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
			if (parent.Kind != "create" && parent.Kind != "rebuild") || parent.ComputerID != instance.ID || parent.RuntimeGeneration != instance.RuntimeGeneration {
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
	responses := []workspacefs.Response{}
	for _, request := range requests {
		response, err := s.workspaceHelper(ctx, &access, op.ID, request)
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

func (s *CloudService) InitializeComputer(ctx context.Context, access *SandboxAccess, projectID, agentID uint64) error {
	request := workspacefs.Request{Operation: "initialize"}
	if agentID != 0 {
		request.AgentID = idString(agentID)
	}
	if projectID != 0 {
		request.ProjectID = idString(projectID)
	}
	results, e := s.environmentRequests(ctx, access, "workspace_prepare", fmt.Sprintf("initialize/%d/%d", projectID, agentID), []workspacefs.Request{request})
	if e != nil {
		return e
	}
	var result struct {
		CWD string `json:"cwd"`
	}
	if len(results) != 1 || json.Unmarshal(results[0].Result, &result) != nil {
		return integrity()
	}
	expected := "/data/workspace"
	if projectID != 0 {
		expected = fmt.Sprintf("/data/projects/%d", projectID)
	}
	if result.CWD != expected {
		return integrity()
	}
	return nil
}
func (s *CloudService) VerifyWorkspaceEnvironment(ctx context.Context, access *SandboxAccess) (SandboxCapabilities, []DiagnosticCheck, error) {
	caps := unknownSandboxCapabilities()
	checks := []DiagnosticCheck{}
	results, e := s.environmentRequests(ctx, access, "workspace_verify", "verify-security", []workspacefs.Request{{Operation: "capabilities"}, {Operation: "verify_security"}})
	if e != nil {
		return caps, append(checks, diagnosticCheck("environment_security", "failed", remoteSandboxError(e))), e
	}
	var protocol struct {
		Protocol     int    `json:"protocol"`
		SafeIO       string `json:"safe_io"`
		UID          int    `json:"uid"`
		WorkspaceUID int    `json:"workspace_uid"`
	}
	var security struct {
		WorkloadUID          int  `json:"workload_uid"`
		CommandDenied        bool `json:"command_denied"`
		InitializationDenied bool `json:"initialization_denied"`
		TransferPrivate      bool `json:"transfer_private"`
		HelperImmutable      bool `json:"helper_immutable"`
		ControlPrivate       bool `json:"control_environment_private"`
		CredentialsAbsent    bool `json:"credentials_absent"`
	}
	valid := len(results) == 2 && json.Unmarshal(results[0].Result, &protocol) == nil && json.Unmarshal(results[1].Result, &security) == nil && protocol.Protocol == workspacefs.Version && protocol.SafeIO == "openat2" && protocol.UID == 0 && protocol.WorkspaceUID == 10001 && security.WorkloadUID == 10001 && security.CommandDenied && security.InitializationDenied && security.TransferPrivate && security.HelperImmutable && security.ControlPrivate && security.CredentialsAbsent
	if !valid {
		e = httpx.E(409, "SANDBOX_ENVIRONMENT_UNSAFE", "沙箱运行环境未通过安全检查")
		return caps, append(checks, diagnosticCheck("environment_security", "failed", "workload_control_plane_not_isolated")), e
	}
	caps.Execution = "supported"
	caps.ExecutionInspection = "supported"
	checks = append(checks, diagnosticCheck("trusted_helper", "succeeded", ""), diagnosticCheck("workload_identity", "succeeded", ""), diagnosticCheck("control_authentication", "succeeded", ""), diagnosticCheck("private_transfer_and_environment", "succeeded", ""))
	return caps, checks, nil
}
