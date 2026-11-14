package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func sandboxToolFailure(err error) agentcore.DispatchObservation {
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
	case "read_file", "write_file", "edit_file", "glob", "grep":
		output, err = s.FileTool(ctx, execution.Ref, callID, key, args)
	case "read_image":
		var input agents.ReadImageRequest
		if json.Unmarshal(args, &input) != nil {
			return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
		}
		output, err = s.ReadImage(ctx, execution.Ref, callID, input)
	case "import_file":
		var input agents.ImportFileRequest
		if json.Unmarshal(args, &input) != nil {
			return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
		}
		output, err = s.ImportFile(ctx, execution.Ref, callID, input)
	case "present":
		var input agents.PresentRequest
		if json.Unmarshal(args, &input) != nil {
			return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
		}
		output, err = s.Present(ctx, execution.Ref, callID, input)
	default:
		var result agents.CommandResult
		if key == "exec_command" {
			var input agents.CommandRequest
			if json.Unmarshal(args, &input) != nil {
				return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
			}
			result, err = s.ExecuteCommand(ctx, execution.Ref, callID, input)
		} else {
			var input struct {
				ID       uint64 `json:"execution_id,string"`
				Cursor   string `json:"cursor"`
				MaxBytes int    `json:"max_output_bytes"`
			}
			if json.Unmarshal(args, &input) != nil || input.ID == 0 {
				return sandboxToolFailure(httpx.Invalid("arguments", "invalid_format")), nil
			}
			switch key {
			case "process_status":
				result, err = s.ProcessStatus(ctx, execution.Ref, callID, input.ID)
			case "process_output":
				result, err = s.ProcessOutput(ctx, execution.Ref, callID, input.ID, input.Cursor, input.MaxBytes)
			case "process_cancel":
				result, err = s.ProcessCancel(ctx, execution.Ref, callID, input.ID)
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
			return output, nil
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
	content := string(metadata)
	if result.Cursor != "" {
		content += "\noutput_cursor: " + result.Cursor
	}
	return agentcore.DispatchObservation{Status: status, Executed: result.Executed, Content: content, Reason: result.Reason, Metadata: metadata}, nil
}
