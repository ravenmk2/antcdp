package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/webaccess"
)

type agentToolDispatcher struct {
	service   *agents.Service
	resources *agentresources.Service
	runtime   *agentcore.Runtime
	web       *webaccess.Router
}

func toolObservation(status, reason, content string, executed *bool) agentcore.DispatchObservation {
	return agentcore.DispatchObservation{Status: status, Executed: executed, Content: content, Reason: reason}
}

func toolFailure(reason string, executed *bool) agentcore.DispatchObservation {
	status := "failed"
	if executed == nil {
		status = "outcome_unknown"
	}
	return toolObservation(status, reason, "Tool did not produce a confirmed successful result: "+reason, executed)
}

func toolJSON(value any) (agentcore.DispatchObservation, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return agentcore.DispatchObservation{}, err
	}
	yes := true
	return toolObservation("succeeded", "", string(data), &yes), nil
}

func (d *agentToolDispatcher) Dispatch(ctx context.Context, execution agentcore.ExecutionContext, permit agentcore.DispatchPermit) (agentcore.DispatchObservation, error) {
	no := false
	if permit.Call.Ref != execution.Ref || permit.Token == "" {
		return toolFailure("DISPATCH_PERMIT_INVALID", &no), nil
	}
	if permit.Call.Spec.MCP == nil && papi.IsTool(permit.Call.Spec.Key) {
		return d.dispatchPlatformAPI(ctx, execution.Ref, permit)
	}
	if permit.ProjectID != 0 {
		if err := d.service.AuthorizeProjectDispatch(ctx, execution.Ref, permit); err != nil {
			return toolFailure("RESOURCE_ACCESS_DENIED", &no), nil
		}
	} else if _, err := d.service.AuthorizeExecution(ctx, execution.Ref); err != nil {
		return toolFailure("EXECUTION_NOT_AUTHORIZED", &no), nil
	}
	args := []byte(permit.Call.Call.Arguments)
	if isSandboxAgentTool(permit.Call.Spec.Key) {
		return d.dispatchSandbox(ctx, execution, permit)
	}
	switch permit.Call.Spec.Key {
	case "list_artifacts", "show_artifacts":
		out, err := d.service.SessionArtifactTool(ctx, permit)
		if err != nil {
			out := sandboxToolFailure(err)
			if errors.Is(err, errGitCredentialRevoked) {
				yes := true
				out.Executed = &yes
			}
			return out, nil
		}
		return out, nil
	case "read_tool_output":
		content, err := d.service.ReadToolOutput(ctx, execution.Ref, args)
		if err != nil {
			return toolFailure("TOOL_OUTPUT_UNAVAILABLE", &no), nil
		}
		yes := true
		return toolObservation("succeeded", "", content, &yes), nil
	case "web_search", "web_fetch":
		return d.dispatchWeb(ctx, permit, args)
	case "skill":
		var input struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(args, &input) != nil {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		if d.service.Skills == nil {
			return toolFailure("SKILL_SOURCE_UNAVAILABLE", &no), nil
		}
		loaded, err := d.service.Skills.Load(ctx, execution, input.Name)
		if err != nil {
			return sandboxToolFailure(err), nil
		}
		if len(loaded.Text) > agentcore.SkillTextMaxBytes || !utf8.ValidString(loaded.Text) || strings.ContainsRune(loaded.Text, 0) {
			return toolFailure("SKILL_CONTENT_INVALID", &no), nil
		}
		if !loaded.Materialized {
			return toolFailure("SKILL_DIRECTORY_UNAVAILABLE", &no), nil
		}
		metadata, err := json.Marshal(map[string]any{"skill_load": map[string]any{"skill_id": loaded.SkillID, "skill_version_id": loaded.VersionID, "content_sha256": loaded.ContentSHA256, "materialized": loaded.Materialized, "stable_path": loaded.StablePath, "relative_path": "SKILL.md"}})
		if err != nil {
			return toolFailure("SKILL_LOAD_FAILED", &no), nil
		}
		yes := true
		observation := toolObservation("succeeded", "", "Skill "+input.Name+"\nSkill directory: "+loaded.StablePath+"\n\n"+loaded.Text, &yes)
		observation.Metadata = metadata
		return observation, nil
	case "todo_write":
		list, summary, err := agents.ParseTodos(args)
		if err != nil {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		yes := true
		obs := toolObservation("succeeded", "", summary, &yes)
		obs.Metadata, err = json.Marshal(list)
		return obs, err
	case "subagent":
		var input struct {
			Task        string `json:"task"`
			Description string `json:"description"`
			Background  bool   `json:"background"`
		}
		if json.Unmarshal(args, &input) != nil || strings.TrimSpace(input.Task) == "" {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		result, err := d.runtime.RunChild(ctx, agentcore.ChildRequest{Background: input.Background, Description: input.Description, Parent: permit.Call, Content: []agentcore.TextBlock{{Type: "text", Text: input.Task}}})
		if err != nil {
			return agentcore.DispatchObservation{}, err
		}
		return agentcore.DispatchObservation{Status: result.Status, Executed: result.Executed, Content: result.Content, Reason: result.Reason, Committed: &result.Receipt}, nil
	default:
		if permit.Call.Spec.MCP != nil {
			return d.dispatchMCP(ctx, execution, permit)
		}
		return toolFailure("TOOL_UNAVAILABLE", &no), nil
	}
}

func (d *agentToolDispatcher) dispatchPlatformAPI(ctx context.Context, ref agentcore.ExecutionRef, permit agentcore.DispatchPermit) (agentcore.DispatchObservation, error) {
	no := false
	execution, err := d.service.AuthorizeExecution(ctx, ref)
	if err != nil {
		return toolFailure("EXECUTION_NOT_AUTHORIZED", &no), nil
	}
	var snapshot struct {
		Resource *papi.Authorization `json:"resource"`
	}
	if json.Unmarshal(permit.Authorization, &snapshot) != nil || snapshot.Resource == nil || d.service.PAPI == nil {
		return toolFailure("DISPATCH_PERMIT_INVALID", &no), nil
	}
	ctx, cancel := context.WithDeadline(ctx, permit.Deadline)
	defer cancel()
	content, err := d.service.PAPI.Dispatch(ctx, execution, permit.Call.Spec.Key, permit.Call.Call.Arguments, *snapshot.Resource, permit.Call.ID)
	var failure *papi.Failure
	if errors.As(err, &failure) {
		return toolObservation("failed", failure.Code, failure.Content(), &no), nil
	}
	var mrFailure *integrations.GitLabMRFailure
	if errors.As(err, &mrFailure) {
		executed := &no
		if mrFailure.Unknown {
			executed = nil
		}
		observation := toolFailure(mrFailure.Code, executed)
		observation.Content = mrFailure.Code + "\n" + mrFailure.Message
		return observation, nil
	}
	if err != nil {
		return sandboxToolFailure(err), nil
	}
	if !json.Valid(content) {
		return toolFailure("PAPI_EXECUTION_FAILED", nil), nil
	}
	yes := true
	return toolObservation("succeeded", "", string(content), &yes), nil
}

func webToolFailure(err error, attempts []webaccess.Attempt) agentcore.DispatchObservation {
	executed := len(attempts) > 0
	reason := "WEB_ACCESS_FAILED"
	var failure *webaccess.Failure
	if errors.As(err, &failure) {
		reason = failure.Code
		if failure.Unknown {
			return toolFailure(reason, nil)
		}
	}
	if errors.Is(err, context.Canceled) {
		reason = "CANCELLED"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		reason = "DEADLINE_EXCEEDED"
	}
	for _, attempt := range attempts {
		if attempt.Outcome == "unknown" {
			return toolFailure(reason, nil)
		}
	}
	return toolFailure(reason, &executed)
}

func (d *agentToolDispatcher) dispatchMCP(ctx context.Context, execution agentcore.ExecutionContext, permit agentcore.DispatchPermit) (agentcore.DispatchObservation, error) {
	no := false
	if permit.Call.Spec.MCP == nil {
		return toolFailure("MCP_TOOL_UNAVAILABLE", &no), nil
	}
	var authorization struct {
		Resource json.RawMessage `json:"resource"`
	}
	if json.Unmarshal(permit.Authorization, &authorization) != nil {
		return toolFailure("DISPATCH_PERMIT_INVALID", &no), nil
	}
	store, err := d.resources.Store()
	if err != nil {
		return toolFailure("MCP_RESOURCE_UNAVAILABLE", &no), nil
	}
	var config mcp.Config
	request := mcp.CallRequest{RemoteName: permit.Call.Spec.MCP.RemoteName, Fingerprint: permit.Call.Spec.MCP.Fingerprint, ResultLimit: agentcore.ToolOutputMaxBytes}
	err = store.Transact(ctx, func(tx identity.Tx) error {
		var err error
		config, err = d.resources.ReadAuthorizedMCPRuntime(tx, permit.Call.Spec.MCP.ServerID, authorization.Resource)
		return err
	})
	if err != nil {
		return toolFailure("MCP_RESOURCE_CHANGED", &no), nil
	}
	client, err := d.resources.MCPFactory(ctx, config)
	if err != nil {
		return toolFailure("MCP_CLIENT_UNAVAILABLE", &no), nil
	}
	request.Arguments = json.RawMessage(permit.Call.Call.Arguments)
	result, err := client.Call(ctx, request)
	if err != nil {
		reason := "MCP_REQUEST_FAILED"
		var remote *mcp.Error
		if errors.As(err, &remote) {
			reason = remote.Code
		}
		return toolFailure(reason, result.Executed), nil
	}
	status := "succeeded"
	if result.IsError {
		status = "failed"
	}
	observation := toolObservation(status, result.Reason, result.Content, result.Executed)
	observation.Truncated = result.Truncated
	return observation, nil
}

func (*agentToolDispatcher) Cancel(context.Context, agentcore.ExecutionContext, agentcore.PreparedToolCall) error {
	// HTTP/child calls are already tied to the bounded dispatch context. No
	// physical completion is asserted here; the durable reconciler owns that.
	return nil
}
