package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func sandboxToolFailure(err error) (out agentcore.DispatchObservation) {
	defer func() {
		out.Diagnostic = diagnostic.From(diagnostic.With(err, diagnostic.Detail{Source: "sandbox", Stage: "execute"}))
	}()
	var remote *sandboxcore.Error
	if errors.As(err, &remote) && remote.Unknown {
		return toolFailure(remote.Code, nil)
	}
	var failure *httpx.Error
	if errors.As(err, &failure) {
		if strings.Contains(failure.Code, "UNKNOWN") || failure.Code == "WORKSPACE_RECONCILING" || failure.Code == "WORKSPACE_OPERATION_EXISTS" {
			return toolFailure(failure.Code, nil)
		}
		no := false
		return toolFailure(failure.Code, &no)
	}
	// A transport/database failure may follow dispatch; no replay claim is made.
	return toolFailure("SANDBOX_TOOL_OUTCOME_UNKNOWN", nil)
}

func (d *agentToolDispatcher) dispatchSandbox(ctx context.Context, execution agentcore.ExecutionContext, permit agentcore.DispatchPermit) (agentcore.DispatchObservation, error) {
	s := d.service.Sandboxes
	if s == nil {
		no := false
		return toolFailure("SANDBOX_UNAVAILABLE", &no), nil
	}
	ctx, cancel := context.WithDeadline(ctx, permit.Deadline)
	defer cancel()
	key, callID, args := permit.Call.Spec.Key, uint64(permit.Call.ID), json.RawMessage(permit.Call.Call.Arguments)
	var output agentcore.DispatchObservation
	var err error
	switch key {
	case "read", "write", "edit", "glob", "grep":
		output, err = s.FileTool(ctx, execution.Ref, callID, key, args)
	case "read_image":
		var input agents.ReadImageRequest
		if json.Unmarshal(args, &input) != nil {
			return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
		}
		output, err = s.ReadImage(ctx, execution.Ref, callID, input)
	case "load_artifacts":
		var input agents.LoadArtifactsRequest
		if json.Unmarshal(args, &input) != nil {
			return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
		}
		output, err = s.LoadArtifacts(ctx, execution.Ref, callID, input)
	case "save_artifacts":
		var input agents.SaveArtifactsRequest
		if json.Unmarshal(args, &input) != nil {
			return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
		}
		output, err = s.SaveArtifacts(ctx, execution.Ref, callID, input)
	case "task_list":
		var tasks []agents.CommandTask
		tasks, err = s.TaskList(ctx, execution.Ref, callID)
		if err == nil {
			output, err = toolJSON(tasks)
		}
	default:
		var result agents.CommandResult
		if key == "exec" {
			var input agents.CommandRequest
			if json.Unmarshal(args, &input) != nil {
				return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
			}
			result, err = s.ExecuteCommand(ctx, execution.Ref, callID, input)
		} else {
			var input struct {
				ID     uint64 `json:"task_id,string"`
				Cursor string `json:"cursor"`
				WaitMS int    `json:"wait_ms"`
			}
			if json.Unmarshal(args, &input) != nil || input.ID == 0 {
				return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
			}
			switch key {
			case "task_output":
				result, err = s.TaskOutput(ctx, execution.Ref, callID, input.ID, input.Cursor, input.WaitMS)
			case "task_kill":
				result, err = s.TaskKill(ctx, execution.Ref, callID, input.ID)
			default:
				return sandboxToolFailure(httpx.Invalid("tool_key", "unsupported")), nil
			}
		}
		if err == nil || result.Execution.ExecutionID != 0 {
			var encodeErr error
			output, encodeErr = sandboxCommandObservation(result)
			if encodeErr != nil {
				err = encodeErr
			}
		}
	}
	if err != nil {
		// File services may have already atomically committed a failed result,
		// or hold positive execution evidence despite a later cleanup failure.
		if output.Status != "" {
			output.Diagnostic = diagnostic.From(diagnostic.With(err, diagnostic.Detail{Source: "sandbox", Stage: key}))
			return output, nil
		}
		if key == "task_list" || key == "task_output" {
			reason := "SANDBOX_OBSERVATION_FAILED"
			var remote *sandboxcore.Error
			var input *httpx.Error
			if errors.As(err, &remote) {
				reason = remote.Code
			} else if errors.As(err, &input) {
				reason = input.Code
			}
			no := false
			failed := toolFailure(reason, &no)
			failed.Diagnostic = diagnostic.From(diagnostic.With(err, diagnostic.Detail{Source: "sandbox", Stage: key}))
			return failed, nil
		}
		return sandboxToolFailure(err), nil
	}
	return output, nil
}

func sandboxCommandObservation(result agents.CommandResult) (agentcore.DispatchObservation, error) {
	metadata, err := agents.EncodeSandboxExecutionMetadata(result.Execution)
	if err != nil {
		return agentcore.DispatchObservation{}, err
	}
	status := "succeeded"
	if result.Executed == nil {
		status = "outcome_unknown"
	} else if result.Reason != "" {
		status = "failed"
	}
	// Keep the captured output before the smaller UI metadata projection trims it.
	value := map[string]any{"sandbox_execution": result.Execution}
	if result.Cursor != "" {
		value["next_cursor"] = result.Cursor
	}
	full, err := json.Marshal(value)
	if err != nil {
		return agentcore.DispatchObservation{}, err
	}
	content := string(full)
	return agentcore.DispatchObservation{Status: status, Executed: result.Executed, Content: content, Reason: result.Reason, Metadata: metadata, Truncated: result.Execution.Truncated}, nil
}
