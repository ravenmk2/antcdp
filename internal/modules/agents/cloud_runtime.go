package agents

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type SandboxCapabilities struct {
	Lifecycle           string `json:"lifecycle"`
	Execution           string `json:"execution"`
	ExecutionInspection string `json:"execution_inspection"`
	Cancellation        string `json:"cancellation"`
	FileTransfer        string `json:"file_transfer"`
	PersistentWorkspace string `json:"persistent_workspace"`
	NetworkEnforcement  string `json:"network_enforcement"`
	VolumeDeletion      string `json:"volume_deletion"`
}
type DiagnosticCheck struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Reason *string `json:"reason"`
}

type CloudService struct {
	Host                *Service
	Cipher              func(purpose, value string, seal bool) (string, error)
	ControlKey          func() ([]byte, error)
	InstallationID      func() (string, error)
	Epoch               string
	Factory             sandboxcore.Factory
	ProtectedTargets    func() ([]string, error)
	EndpointTargets     func(string) ([]string, error)
	PrepareWorkspace    func(context.Context, *SandboxAccess, uint64, uint64) error
	VerifyEnvironment   func(context.Context, *SandboxAccess) (SandboxCapabilities, []DiagnosticCheck, error)
	ExecutionReconciler func(context.Context, uint64) error
	skillMu             sync.Mutex
	skillPreparations   map[string]chan struct{}
}

// SandboxAccess is an internal capability for one exact computer generation.
// It is never serialized as a public resource or constructed by an HTTP client.
type SandboxAccess struct {
	HelperOperationID, HelperOperationFence                             uint64
	Provider                                                            sandboxcore.Provider
	Resource                                                            sandboxcore.ResourceRef
	ComputerID, BackendGeneration, RuntimeGeneration, StorageGeneration uint64
	BindingID, BindingFence                                             uint64
	OperationID, OperationFence                                         uint64
	CWD                                                                 string
	ReferenceIDs                                                        []uint64
	Execution                                                           *agentcore.ExecutionRef
}
type CloudConnection struct {
	BackendGeneration                uint64
	Endpoint, AccessMode, APIKey     string
	ConnectTimeout, OperationTimeout time.Duration
}

func idString(id uint64) string { return strconv.FormatUint(id, 10) }
func diagnosticCheck(name, status, reason string) DiagnosticCheck {
	var why *string
	if reason != "" {
		why = &reason
	}
	return DiagnosticCheck{Name: name, Status: status, Reason: why}
}
func unknownSandboxCapabilities() SandboxCapabilities {
	return SandboxCapabilities{"unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unsupported"}
}
func sandboxFailure(e error) error {
	var failure *sandboxcore.Error
	if errors.As(e, &failure) {
		status := 409
		if strings.HasPrefix(failure.Code, "NETWORK_") {
			status = 422
		}
		return httpx.E(status, failure.Code, "云电脑执行服务当前不可用")
	}
	return e
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
func (s *CloudService) tag(kind string, id, version uint64) string {
	return s.Host.tag("cloud/"+kind, id, version)
}
func (s *CloudService) runtimeConnection(row *SandboxConnectionRow) (CloudConnection, error) {
	if row == nil || row.ID != 1 {
		return CloudConnection{}, integrity()
	}
	if row.Endpoint == nil {
		return CloudConnection{}, httpx.E(409, "SANDBOX_NOT_CONFIGURED", "请管理员配置沙箱服务连接")
	}
	c := CloudConnection{BackendGeneration: row.BackendGeneration, Endpoint: *row.Endpoint, AccessMode: row.AccessMode, ConnectTimeout: time.Duration(row.ConnectTimeout) * time.Second, OperationTimeout: time.Duration(row.OperationTimeout) * time.Second}
	if len(row.SecretCiphertext) == 0 || row.SecretFormatVersion == nil || *row.SecretFormatVersion != 2 || row.SecretKeyVersion == nil || *row.SecretKeyVersion != "v1" || s.Cipher == nil {
		return c, httpx.E(409, "CREDENTIAL_MISSING", "沙箱服务凭据不可用")
	}
	var e error
	c.APIKey, e = s.Cipher("sandboxes/connection/authentication", string(row.SecretCiphertext), false)
	return c, e
}
func (s *CloudService) openProvider(ctx context.Context, c CloudConnection) (sandboxcore.Provider, error) {
	if s.Factory == nil {
		return nil, unavailable()
	}
	var key []byte
	if s.ControlKey != nil {
		var e error
		key, e = s.ControlKey()
		if e != nil {
			return nil, e
		}
	}
	p, e := s.Factory.Open(ctx, sandboxcore.Connection{Endpoint: c.Endpoint, AccessMode: c.AccessMode, APIKey: c.APIKey, ControlKey: key, ConnectTimeout: c.ConnectTimeout, OperationTimeout: c.OperationTimeout})
	return p, sandboxFailure(e)
}
func (s *CloudService) resource(v *CloudComputerRow) (sandboxcore.ResourceRef, error) {
	if s.InstallationID == nil {
		return sandboxcore.ResourceRef{}, unavailable()
	}
	installation, e := s.InstallationID()
	if e != nil {
		return sandboxcore.ResourceRef{}, e
	}
	if v.RuntimeID == nil || v.RuntimeCreationToken == nil {
		return sandboxcore.ResourceRef{}, httpx.E(409, "CLOUD_NOT_READY", "云电脑尚未激活")
	}
	return sandboxcore.ResourceRef{BackendGeneration: v.BackendGeneration, RemoteID: *v.RuntimeID, Ownership: sandboxcore.Ownership{InstallationID: installation, ComputerID: v.ID, CreationToken: *v.RuntimeCreationToken}}, nil
}
func computerCapabilities(v *CloudComputerRow) SandboxCapabilities {
	c := unknownSandboxCapabilities()
	_ = json.Unmarshal(v.Capabilities, &c)
	return c
}
func workspaceContentAccess(v *CloudComputerRow, a *identity.Auth) error {
	if v == nil {
		return missing()
	}
	if v.PoolAgentID == nil {
		if v.OwnerUserID != a.User.ID {
			return missing()
		}
		return nil
	}
	if a.User.Role != "admin" {
		return missing()
	}
	return nil
}
func (s *CloudService) accessRows(repo CloudRepository, computerID uint64, lease *CloudLeaseRow) (*SandboxAccess, CloudConnection, error) {
	p, e := repo.Connection(false)
	if e != nil {
		return nil, CloudConnection{}, e
	}
	w, e := repo.Computer(computerID, true)
	if e != nil {
		return nil, CloudConnection{}, e
	}
	if p == nil || p.MaintenanceState != "normal" || w == nil || w.State != "ready" || w.DeletedAt != nil || w.BackendGeneration != p.BackendGeneration {
		return nil, CloudConnection{}, httpx.E(409, "CLOUD_NOT_READY", "云电脑暂不可用")
	}
	c, e := s.runtimeConnection(p)
	if e != nil {
		return nil, c, e
	}
	ref, e := s.resource(w)
	if e != nil {
		return nil, c, e
	}
	access := &SandboxAccess{Resource: ref, ComputerID: w.ID, BackendGeneration: w.BackendGeneration, RuntimeGeneration: w.RuntimeGeneration, StorageGeneration: w.StorageGeneration, CWD: "/data/workspace"}
	if lease != nil {
		if lease.ComputerID != w.ID || lease.State != "active" || lease.ReleasedAt != nil || lease.BackendGeneration != w.BackendGeneration || lease.RuntimeGeneration == nil || *lease.RuntimeGeneration != w.RuntimeGeneration || lease.StorageGeneration != w.StorageGeneration {
			return nil, c, httpx.E(409, "CLOUD_LEASE_FENCED", "云电脑执行占用已失效")
		}
		access.BindingID, access.BindingFence = lease.RootRunID, lease.FenceVersion
	}
	return access, c, nil
}

func (s *Service) executionBinding(tx identity.Tx, root *RunRow) (*agentcore.BindingRef, error) {
	if s.Sandboxes == nil {
		return nil, nil
	}
	cr, e := CloudStateFor(tx)
	if e != nil {
		return nil, e
	}
	b, e := cr.Lease(root.ID, false)
	if e != nil || b == nil {
		return nil, e
	}
	if b.State != "active" && b.State != "preparing" {
		return nil, httpx.E(409, "CLOUD_LEASE_FENCED", "云电脑执行占用已失效")
	}
	st, e := StateFor(tx)
	if e != nil {
		return nil, e
	}
	frozen, e := readRunContext(st, root.ID)
	if e != nil {
		return nil, e
	}
	return cloudBinding(b, frozen.Row.CWD), nil
}
func cloudBinding(b *CloudLeaseRow, cwd string) *agentcore.BindingRef {
	runtime := uint64(0)
	if b.RuntimeGeneration != nil {
		runtime = *b.RuntimeGeneration
	}
	return &agentcore.BindingRef{ID: agentcore.ID(b.RootRunID), ComputerID: agentcore.ID(b.ComputerID), BackendGeneration: b.BackendGeneration, RuntimeGeneration: runtime, StorageGeneration: b.StorageGeneration, Fence: b.FenceVersion, CWD: cwd}
}
func (s *CloudService) Acquire(ctx context.Context, x agentcore.ExecutionContext) (*agentcore.BindingRef, error) {
	var out *agentcore.BindingRef
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, _ CloudRepository) error {
		v, e := s.Host.lockExecution(tx, r, st, x.Ref, true)
		if e != nil {
			return e
		}
		out, e = s.Host.executionBinding(tx, v.Root)
		return e
	})
	return out, e
}
func (s *CloudService) PrepareTurn(ctx context.Context, x agentcore.ExecutionContext) error {
	if x.Binding == nil || x.Binding.RuntimeGeneration == 0 {
		return nil
	}
	var access *SandboxAccess
	var connection CloudConnection
	var project, agent uint64
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, cr CloudRepository) error {
		v, e := s.Host.lockExecution(tx, r, st, x.Ref, true)
		if e != nil {
			return e
		}
		lease, e := cr.Lease(v.Root.ID, false)
		if e != nil {
			return e
		}
		if lease == nil {
			return integrity()
		}
		access, connection, e = s.accessRows(cr, lease.ComputerID, lease)
		if e != nil {
			return e
		}
		access.CWD = v.Context.Row.CWD
		access.Execution = &x.Ref
		if v.Context.Row.ProjectContextID != nil {
			project = *v.Context.Row.ProjectContextID
		}
		agent = v.Context.Row.AgentID
		return nil
	})
	if e != nil {
		return e
	}
	access.Provider, e = s.openProvider(ctx, connection)
	if e != nil {
		return e
	}
	if s.PrepareWorkspace == nil {
		return unavailable()
	}
	if e = s.PrepareWorkspace(ctx, access, project, agent); e != nil {
		return e
	}
	return s.prepareSkills(ctx, access, x)
}
func (s *CloudService) activateBinding(ctx context.Context, ref agentcore.ExecutionRef, b agentcore.BindingRef) (agentcore.CommitReceipt, error) {
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, _ CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		current, e := s.Host.executionBinding(tx, x.Root)
		if e != nil {
			return e
		}
		if current == nil || *current != b {
			return httpx.E(409, "CLOUD_LEASE_FENCED", "云电脑执行占用已变化")
		}
		return nil
	})
	return agentcore.CommitReceipt{}, e
}
