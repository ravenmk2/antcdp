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
	case "web_search":
		var input struct {
			Query string `json:"query"`
		}
		if json.Unmarshal(args, &input) != nil {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		result, err := d.web.Search(ctx, webaccess.Permit{Deadline: permit.Deadline, MaxCalls: 3, Caller: "agent"}, input.Query)
		if err != nil {
			return webToolFailure(err, result.Attempts), nil
		}
		return toolJSON(result)
	case "web_fetch":
		var input struct {
			URL string `json:"url"`
		}
		if json.Unmarshal(args, &input) != nil {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		result, err := d.web.Fetch(ctx, webaccess.Permit{Deadline: permit.Deadline, MaxCalls: 3, Caller: "agent"}, input.URL)
		if err != nil {
			return webToolFailure(err, result.Attempts), nil
		}
		return toolJSON(result)
	case "skill":
		var input struct {
			Name string `json:"name"`
			Path string `json:"path"`
		}
		if json.Unmarshal(args, &input) != nil {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		if input.Path == "" {
			input.Path = "SKILL.md"
		}
		if d.service.Skills == nil {
			return toolFailure("SKILL_SOURCE_UNAVAILABLE", &no), nil
		}
		loaded, err := d.service.Skills.Load(ctx, execution, input.Name, input.Path)
		if err != nil {
			return toolFailure("SKILL_LOAD_FAILED", &no), nil
		}
		if len(loaded.Text) > 32<<10 || !utf8.ValidString(loaded.Text) || strings.ContainsRune(loaded.Text, 0) {
			return toolFailure("SKILL_CONTENT_INVALID", &no), nil
		}
		var stablePath *string
		if loaded.Materialized {
			stablePath = &loaded.StablePath
		}
		metadata, err := json.Marshal(map[string]any{"skill_load": map[string]any{"skill_id": loaded.SkillID, "skill_version_id": loaded.VersionID, "content_sha256": loaded.ContentSHA256, "materialized": loaded.Materialized, "stable_path": stablePath, "relative_path": input.Path}})
		if err != nil {
			return toolFailure("SKILL_LOAD_FAILED", &no), nil
		}
		yes := true
		observation := toolObservation("succeeded", "", "Skill load: "+string(metadata)+"\n\n"+loaded.Text, &yes)
		observation.Metadata = metadata
		return observation, nil
	case "update_plan":
		var plan struct {
			Explanation string `json:"explanation,omitempty"`
			Plan        []struct {
				Step   string `json:"step"`
				Status string `json:"status"`
			} `json:"plan"`
		}
		if json.Unmarshal(args, &plan) != nil {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		active := 0
		for _, item := range plan.Plan {
			if item.Status == "in_progress" {
				active++
			}
		}
		if active > 1 {
			return toolFailure("PLAN_MULTIPLE_ACTIVE_STEPS", &no), nil
		}
		return toolJSON(plan)
	case "delegate":
		var input struct {
			Task string `json:"task"`
		}
		if json.Unmarshal(args, &input) != nil || strings.TrimSpace(input.Task) == "" {
			return toolFailure("TOOL_ARGUMENTS_INVALID", &no), nil
		}
		result, err := d.runtime.RunChild(ctx, agentcore.ChildRequest{Parent: permit.Call, Content: []agentcore.TextBlock{{Type: "text", Text: input.Task}}, Files: []agentcore.FileRef{}})
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
	request := mcp.CallRequest{RemoteName: permit.Call.Spec.MCP.RemoteName, Fingerprint: permit.Call.Spec.MCP.Fingerprint, ResultLimit: 64 << 10}
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
	return toolObservation(status, result.Reason, result.Content, result.Executed), nil
}

func (*agentToolDispatcher) Cancel(context.Context, agentcore.ExecutionContext, agentcore.PreparedToolCall) error {
	// HTTP/child calls are already tied to the bounded dispatch context. No
	// physical completion is asserted here; the durable reconciler owns that.
	return nil
}
