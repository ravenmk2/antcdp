package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func sessionCWD(project *uint64) string {
	if project != nil {
		return "/data/projects/" + idString(*project)
	}
	return "/data/workspace"
}
func newComputer(cr CloudRepository, connection *SandboxConnectionRow, owner uint64, agent *uint64, now time.Time) (*CloudComputerRow, error) {
	v := &CloudComputerRow{OwnerUserID: owner, PoolAgentID: agent, State: "uninitialized", BackendGeneration: connection.BackendGeneration, RuntimeGeneration: 1, StorageGeneration: 1, VolumeState: "absent", VolumeCleanupState: "not_requested", EffectiveEnvironment: json.RawMessage(`null`), Capabilities: json.RawMessage(`null`), IdleSince: now, LastActivityAt: now, FenceVersion: 1, RowVersion: 1, CreatedAt: now, UpdatedAt: now}
	if e := cr.InsertComputer(v); e != nil {
		return nil, e
	}
	connection.TopologyVersion++
	connection.UpdatedAt = now
	if e := cr.SaveConnection(connection); e != nil {
		return nil, e
	}
	return v, nil
}

// Allocation runs under the owner/Agent and singleton connection locks. A full
// robot pool leaves the input queued, without reserving a root worker or budget.
func (s *CloudService) allocateSession(cr CloudRepository, st StateRepository, c *SandboxConnectionRow, agent *Definition, session *SessionRow, now time.Time) (*CloudComputerRow, error) {
	var computer *CloudComputerRow
	var e error
	if session.CloudComputerID != nil {
		computer, e = cr.Computer(*session.CloudComputerID, true)
		if e != nil {
			return nil, e
		}
		if computer == nil || computer.DeletedAt != nil || computer.State == "deleting" {
			return nil, httpx.E(409, "CLOUD_COMPUTER_DELETED", "原云电脑已删除或正在删除，不能继续此会话")
		}
		if computer.OwnerUserID != session.ExecutorUserID || (agent.Mode == "service" && (computer.PoolAgentID == nil || *computer.PoolAgentID != agent.ID)) || (agent.Mode == "interactive" && computer.PoolAgentID != nil) {
			return nil, integrity()
		}
	} else if agent.Mode == "interactive" {
		computer, e = cr.PersonalComputer(session.ExecutorUserID, true)
		if e != nil {
			return nil, e
		}
		if computer == nil {
			computer, e = newComputer(cr, c, session.ExecutorUserID, nil, now)
			if e != nil {
				return nil, e
			}
		}
	} else {
		if agent.RobotUserID == nil || *agent.RobotUserID != session.ExecutorUserID || agent.PoolCapacity == nil {
			return nil, integrity()
		}
		pool, e := cr.PoolComputers(agent.ID, true)
		if e != nil {
			return nil, e
		}
		for i := range pool {
			v := &pool[i]
			if v.State != "ready" && v.State != "paused" && v.State != "uninitialized" {
				continue
			}
			activity, e := cr.CloudActivity(v.ID)
			if e != nil {
				return nil, e
			}
			if activity.Leases == 0 && activity.Operations == 0 && activity.References == 0 && activity.Transfers == 0 && activity.Unknown == 0 {
				computer = v
				break
			}
		}
		if computer == nil && len(pool) < *agent.PoolCapacity {
			computer, e = newComputer(cr, c, session.ExecutorUserID, &agent.ID, now)
			if e != nil {
				return nil, e
			}
		}
		if computer == nil {
			return nil, nil
		}
	}
	if session.CloudComputerID == nil {
		session.CloudComputerID = &computer.ID
		session.RowVersion++
		session.UpdatedAt = now
		if _, e = appendEvent(st, session, nil, "session/computer_bound", "", map[string]any{"cloud_computer_id": idString(computer.ID)}, nil, now); e != nil {
			return nil, e
		}
		if e = st.SaveSession(session); e != nil {
			return nil, e
		}
	}
	return computer, nil
}
func (s *CloudService) requiresEnvironment(ctx context.Context, tx identity.Tx, r Repository, agentID uint64) (bool, error) {
	tools, e := r.ToolBindings(agentID, false)
	if e != nil {
		return false, e
	}
	for _, b := range tools {
		if b.Policy == "deny" {
			continue
		}
		if s.Host.Catalog.Tool == nil {
			return false, unavailable()
		}
		d, e := s.Host.Catalog.Tool(ctx, tx, b.ToolKey)
		if e != nil {
			return false, e
		}
		if d != nil && d.Availability.Available && d.RequiresSandbox {
			return true, nil
		}
	}
	return false, nil
}
func (s *CloudService) prepareCloudAdmission(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, agent *Definition, session *SessionRow) (*CloudComputerRow, bool, error) {
	cr, e := CloudStateFor(tx)
	if e != nil {
		return nil, false, e
	}
	c, e := cr.Connection(true)
	if e != nil {
		return nil, false, e
	}
	if c == nil {
		return nil, false, integrity()
	}
	if c.MaintenanceState != "normal" {
		return nil, false, nil
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	v, e := s.allocateSession(cr, st, c, agent, session, now)
	if e != nil || v == nil {
		return v, false, e
	}
	if v.BackendGeneration != c.BackendGeneration {
		return nil, false, integrity()
	}
	activity, e := cr.CloudActivity(v.ID)
	if e != nil {
		return nil, false, e
	}
	if agent.Mode == "service" && (activity.Leases > 0 || activity.References > 0 || activity.Transfers > 0 || activity.Unknown > 0) {
		return v, false, nil
	}
	lifecycle, e := cr.ActiveCloudOperation(v.ID)
	if e != nil {
		return v, false, e
	}
	if lifecycle != nil || v.State == "provisioning" || agent.Mode == "service" && activity.Operations > 0 {
		return v, false, nil
	}
	if v.State == "unavailable" {
		return v, false, httpx.E(409, "CLOUD_UNAVAILABLE", "原云电脑需要管理员处理后才能继续")
	}
	skills, e := s.Host.freezeSkills(tx, r, agent.ID)
	if e != nil {
		return v, false, e
	}
	hash, e := skillSetHash(skills)
	if e != nil {
		return v, false, e
	}
	installed, e := cr.SkillState(v.ID, agent.ID, false)
	if e != nil {
		return v, false, e
	}
	if installed != nil && installed.State == "preparing" {
		operation, e := cr.CloudOperationByToken(installed.SyncToken, false)
		if e != nil {
			return v, false, e
		}
		if operation != nil && operation.FinishedAt == nil {
			return v, false, nil
		}
	}
	leases, e := cr.ComputerLeases(v.ID)
	if e != nil {
		return v, false, e
	}
	for _, lease := range leases {
		frozen, e := st.RunContext(lease.RootRunID)
		if e != nil {
			return v, false, e
		}
		if frozen == nil {
			return v, false, integrity()
		}
		if frozen.AgentID == agent.ID && lease.SkillSetHash != hash {
			return v, false, nil
		}
	}
	needed, e := s.requiresEnvironment(ctx, tx, r, agent.ID)
	if e != nil {
		return v, false, e
	}
	if !needed && len(skills) == 0 {
		return v, true, nil
	}
	if v.State == "ready" {
		return v, true, nil
	}
	kind := "create"
	if v.State == "paused" {
		kind = "resume"
	}
	_, e = s.queueCloudOperation(cr, c, v, kind, "system", "system", nil, nil, now)
	return v, false, e
}
func (s *CloudService) createCloudLease(tx identity.Tx, computer *CloudComputerRow, agent *Definition, root *RunRow, cwd string) (*agentcore.BindingRef, error) {
	cr, e := CloudStateFor(tx)
	if e != nil {
		return nil, e
	}
	mode := "shared"
	if agent.Mode == "service" {
		mode = "exclusive"
	}
	st, e := StateFor(tx)
	if e != nil {
		return nil, e
	}
	frozen, e := st.RunContext(root.ID)
	if e != nil {
		return nil, e
	}
	if frozen == nil {
		return nil, integrity()
	}
	skills, e := frozenSkills(frozen)
	if e != nil {
		return nil, e
	}
	hash, e := skillSetHash(skills)
	if e != nil {
		return nil, e
	}
	lease := &CloudLeaseRow{RootRunID: root.ID, ComputerID: computer.ID, Mode: mode, State: "active", BackendGeneration: computer.BackendGeneration, StorageGeneration: computer.StorageGeneration, SkillSetHash: "", ExecutorEpoch: root.ExecutorEpoch, FenceVersion: 1, AcquiredAt: root.CreatedAt, LeaseExpiresAt: root.DeadlineAt, UpdatedAt: root.CreatedAt}
	lease.SkillSetHash = hash
	if computer.State == "ready" {
		lease.RuntimeGeneration = &computer.RuntimeGeneration
	}
	if e = cr.InsertLease(lease); e != nil {
		return nil, e
	}
	computer.LastActivityAt = root.CreatedAt
	computer.UpdatedAt = root.CreatedAt
	if e = cr.SaveComputer(computer); e != nil {
		return nil, e
	}
	return cloudBinding(lease, cwd), nil
}

type cloudOperationIntent struct {
	OriginalRuntime *sandboxcore.ResourceRef `json:"original_runtime,omitempty"`
	Create          *sandboxcore.CreateSpec  `json:"create,omitempty"`
	CreateSent      bool                     `json:"create_sent"`
	TerminateSent   bool                     `json:"terminate_sent"`
	TransitionSent  bool                     `json:"transition_sent"`
	VolumeNew       bool                     `json:"volume_new"`
	Phase           string                   `json:"phase"`
}

func (s *CloudService) queueCloudOperation(cr CloudRepository, connection *SandboxConnectionRow, v *CloudComputerRow, kind, actorKind, actorID string, receipt, public *uint64, now time.Time) (*CloudOperationRow, error) {
	if connection.Endpoint == nil && (kind != "delete" || v.RuntimeID != nil || v.VolumeID != nil) {
		return nil, httpx.E(409, "SANDBOX_NOT_CONFIGURED", "请管理员配置沙箱服务连接")
	}
	if kind == "create" && v.RuntimeID != nil {
		return nil, httpx.E(409, "CLOUD_STATE_CONFLICT", "云电脑已有运行实例，请使用重建操作")
	}
	if connection.MaintenanceState != "normal" {
		return nil, httpx.E(409, "CLOUD_MAINTENANCE", "沙箱连接正在维护")
	}
	active, e := cr.ActiveCloudOperation(v.ID)
	if e != nil {
		return nil, e
	}
	if active != nil {
		return active, nil
	}
	intent := cloudOperationIntent{Phase: "start"}
	if v.RuntimeID != nil {
		ref, e := s.resource(v)
		if e != nil {
			return nil, e
		}
		intent.OriginalRuntime = &ref
	}
	op := &CloudOperationRow{ComputerID: v.ID, Kind: kind, Status: "queued", OperationToken: cryptox.ID(), CommandReceiptID: receipt, PublicOperationID: public, BackendGeneration: v.BackendGeneration, RuntimeGeneration: v.RuntimeGeneration, StorageGeneration: v.StorageGeneration, Intent: json.RawMessage(`{}`), Observation: json.RawMessage(`{}`), ActorKind: actorKind, ActorID: actorID, ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now, DeadlineAt: now.Add(5 * time.Minute)}
	switch kind {
	case "create", "rebuild":
		template, e := cr.CloudTemplate(v.PoolAgentID, false)
		if e != nil {
			return nil, e
		}
		env, e := cloudTemplateEnvironment(template)
		if e != nil {
			return nil, e
		}
		if e = normalizeCloudEnvironment(&env, false); e != nil {
			return nil, e
		}
		op.TargetEnvironment, e = json.Marshal(env)
		if e != nil {
			return nil, e
		}
		op.TargetTemplateVersion = &template.ConfigVersion
		if kind == "rebuild" && v.VolumeID == nil {
			return nil, httpx.E(409, "CLOUD_VOLUME_MISSING", "原数据卷身份缺失，不能自动建立空卷")
		}
		if v.VolumeID == nil {
			installation, e := s.InstallationID()
			if e != nil {
				return nil, e
			}
			if len(installation) != 32 {
				return nil, integrity()
			}
			volume := cryptox.ID()
			name := "acdp-" + installation[:8] + "-" + volume
			v.VolumeID, v.VolumeName = &volume, &name
			v.VolumeState = "creating"
			intent.VolumeNew = true
		} else {
			intent.VolumeNew = kind == "create" && v.AppliedTemplateVersion == nil && v.VolumeState != "ready"
		}
		if kind == "rebuild" {
			v.RuntimeGeneration++
		}
		token := cryptox.ID()
		v.RuntimeCreationToken = &token
		v.RuntimeID = nil
		v.RuntimeExpiresAt = nil
		v.State = "provisioning"
		op.RuntimeGeneration = v.RuntimeGeneration
	case "delete":
		v.State = "deleting"
		v.VolumeCleanupState = "pending"
	}
	op.Intent, e = json.Marshal(intent)
	if e != nil {
		return nil, e
	}
	v.FenceVersion++
	v.RowVersion++
	v.UpdatedAt = now
	if e = cr.SaveComputer(v); e != nil {
		return nil, e
	}
	if e = cr.InsertCloudOperation(op); e != nil {
		return nil, e
	}
	return op, nil
}
