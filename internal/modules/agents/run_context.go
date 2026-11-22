package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/papi"
)

type FrozenTool struct {
	Binding         ToolBinding           `json:"binding"`
	Spec            agentcore.ToolSpec    `json:"spec"`
	RequiresSandbox bool                  `json:"requires_sandbox"`
	PAPIGrants      []agentcore.PAPIGrant `json:"papi_grants,omitempty"`
}

// RunContextRow is private, immutable root authority. MCP discovery fills its
// manifest once before inference; all children use this same root record.
type RunContextRow struct {
	RootRunID          uint64          `db:"root_run_id"`
	AgentID            uint64          `db:"agent_id"`
	ExecutorUserID     uint64          `db:"executor_user_id"`
	AgentConfigVersion uint64          `db:"agent_config_version"`
	SchemaVersion      uint64          `db:"schema_version"`
	CloudComputerID    *uint64         `db:"cloud_computer_id"`
	CWD                string          `db:"cwd"`
	SystemPrompt       string          `db:"system_prompt"`
	ModelSnapshot      json.RawMessage `db:"model_snapshot"`
	RuntimePolicy      json.RawMessage `db:"runtime_policy"`
	BuiltinTools       json.RawMessage `db:"builtin_tools"`
	MCPBindings        json.RawMessage `db:"mcp_bindings"`
	ResourceGrants     json.RawMessage `db:"resource_grants"`
	SkillManifest      json.RawMessage `db:"skill_manifest"`
	MCPSurface         json.RawMessage `db:"mcp_surface"`
	MCPPreparedAt      *time.Time      `db:"mcp_prepared_at"`
	CreatedAt          time.Time       `db:"created_at"`
}

type frozenRunContext struct {
	Row           *RunContextRow
	Model         agentcore.LockedModel
	Policy        policySnapshot
	Authorization agentcore.Authorization
	Tools         []FrozenTool
	PAPIGrants    []agentcore.PAPIGrant
	MCP           []mcpPreparation
	MCPTools      []agentcore.ToolSpec
}

func readRunContext(st StateRepository, root uint64) (*frozenRunContext, error) {
	row, err := st.RunContext(root)
	if err != nil {
		return nil, err
	}
	if row == nil || row.SchemaVersion != 1 {
		return nil, integrity()
	}
	x := &frozenRunContext{Row: row}
	if json.Unmarshal(row.ModelSnapshot, &x.Model) != nil || json.Unmarshal(row.RuntimePolicy, &x.Policy) != nil || json.Unmarshal(row.ResourceGrants, &x.Authorization) != nil || json.Unmarshal(row.BuiltinTools, &x.Tools) != nil || json.Unmarshal(row.MCPBindings, &x.MCP) != nil {
		return nil, integrity()
	}
	for _, tool := range x.Tools {
		if len(tool.PAPIGrants) != 0 {
			x.PAPIGrants = tool.PAPIGrants
			break
		}
	}
	if row.MCPPreparedAt != nil {
		var surface struct {
			Tools []agentcore.ToolSpec `json:"tools"`
		}
		if json.Unmarshal(row.MCPSurface, &surface) != nil {
			return nil, integrity()
		}
		x.MCPTools = surface.Tools
	}
	if x.Authorization.AccountID != agentcore.ID(row.ExecutorUserID) {
		return nil, integrity()
	}
	return x, nil
}

func (s *Service) freezeRunContext(ctx context.Context, tx identity.Tx, r Repository, st StateRepository, run *RunRow, agent *Definition, owner *identity.User, model agentcore.LockedModel) (*frozenRunContext, error) {
	grants, err := r.AccountResourceGrants(owner.ID, owner.Role == "admin")
	if err != nil {
		return nil, err
	}
	authorization := agentcore.Authorization{AccountID: agentcore.ID(owner.ID), AccountType: owner.AccountType, AccountVersion: agentcore.Version(owner.AuthVersion), Grants: grants}
	bindings, err := r.ToolBindings(agent.ID, false)
	if err != nil {
		return nil, err
	}
	tools := []FrozenTool{}
	for _, binding := range bindings {
		if binding.Policy == "deny" || binding.ToolKey == "skill" && s.Skills == nil || binding.ToolKey == "read_image" && model.Capabilities.ImageInput != modelcore.Supported {
			continue
		}
		if papi.IsTool(binding.ToolKey) && (s.PAPI == nil || binding.Policy != "allow") {
			continue
		}
		if s.Catalog.Tool == nil {
			return nil, unavailable()
		}
		d, err := s.Catalog.Tool(ctx, tx, binding.ToolKey)
		if err != nil {
			return nil, err
		}
		if d == nil || !d.Availability.Available {
			continue
		}
		tools = append(tools, FrozenTool{Binding: binding, RequiresSandbox: d.RequiresSandbox, Spec: agentcore.ToolSpec{Key: binding.ToolKey, Definition: d.Definition, ExecutionClass: d.ExecutionClass, ParallelSafe: d.ParallelSafe, Policy: binding.Policy, ResultLimit: toolOutputInlineLimit(binding.ToolKey)}})
	}
	for i := range tools {
		if papi.IsTool(tools[i].Spec.Key) {
			tools[i].PAPIGrants, err = s.freezePAPIGrants(r, agent.ID)
			if err != nil {
				return nil, err
			}
			break
		}
	}
	mcp, err := s.prepareMCPBindings(tx, r, agent.ID)
	if err != nil {
		return nil, err
	}
	session, err := st.Session(run.SessionID, false)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, integrity()
	}
	skills, err := s.freezeSkills(tx, r, agent.ID)
	if err != nil {
		return nil, err
	}
	cwd, err := sessionCWD(session)
	if err != nil {
		return nil, err
	}
	row := &RunContextRow{CloudComputerID: session.CloudComputerID, CWD: cwd, RootRunID: run.ID, AgentID: agent.ID, ExecutorUserID: owner.ID, AgentConfigVersion: agent.RowVersion, SchemaVersion: 1, SystemPrompt: agent.SystemPrompt, RuntimePolicy: run.ExecutionPolicySnapshot, SkillManifest: json.RawMessage(`[]`), CreatedAt: run.CreatedAt}
	for _, part := range []struct {
		Value  any
		Target *json.RawMessage
	}{{model, &row.ModelSnapshot}, {tools, &row.BuiltinTools}, {mcp, &row.MCPBindings}, {authorization, &row.ResourceGrants}, {skills, &row.SkillManifest}} {
		*part.Target, err = json.Marshal(part.Value)
		if err != nil {
			return nil, err
		}
	}
	if err = st.InsertRunContext(row); err != nil {
		return nil, err
	}
	for _, skill := range skills {
		if err = st.InsertResourceReference(&ResourceReferenceRow{HolderKind: "root_skill", HolderID: idString(run.ID), ResourceKind: "skill_version", ResourceID: skill.VersionID, State: "active", ExecutorEpoch: run.ExecutorEpoch, FenceVersion: run.FenceVersion, CreatedAt: run.CreatedAt, UpdatedAt: run.CreatedAt}); err != nil {
			return nil, err
		}
	}
	return readRunContext(st, run.ID)
}

func (s *Service) freezePAPIGrants(r Repository, agentID uint64) ([]agentcore.PAPIGrant, error) {
	rows, err := r.PAPIGrants(agentID)
	if err != nil {
		return nil, err
	}
	grants := make([]agentcore.PAPIGrant, 0, len(rows))
	for _, row := range rows {
		constraints, err := row.constraints()
		if err != nil {
			return nil, err
		}
		if grant, ok := s.PAPI.Freeze(row.Code, constraints); ok {
			grants = append(grants, grant)
		}
	}
	return grants, nil
}
