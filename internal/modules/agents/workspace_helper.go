package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type workspaceHelperExecution struct {
	Ordinal  int                          `json:"ordinal"`
	Request  workspacefs.Request          `json:"request"`
	Handle   *sandboxcore.ExecutionHandle `json:"handle,omitempty"`
	Response *workspacefs.Response        `json:"response,omitempty"`
	State    string                       `json:"state"`
}
type workspaceOperationObservation struct {
	Executions          []workspaceHelperExecution `json:"executions"`
	LocalStorageKey     string                     `json:"local_storage_key,omitempty"`
	LocalCleanupPending bool                       `json:"local_cleanup_pending,omitempty"`
	TransferToken       string                     `json:"transfer_token,omitempty"`
	TransferState       string                     `json:"transfer_state,omitempty"`
	Result              json.RawMessage            `json:"result,omitempty"`
}

func (s *CloudService) updateWorkspaceObservation(ctx context.Context, id, expectedFence uint64, fn func(*CloudOperationRow, *workspaceOperationObservation) error) error {
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		row, err := repo.CloudOperation(id, true)
		if err != nil {
			return err
		}
		if row == nil || expectedFence == 0 || row.FenceVersion != expectedFence || row.ExecutorEpoch != s.Epoch || row.FinishedAt != nil {
			return httpx.E(409, "OPERATION_FENCED", "工作文件操作已失效")
		}
		var observation workspaceOperationObservation
		if len(row.Observation) > 0 && string(row.Observation) != "null" && json.Unmarshal(row.Observation, &observation) != nil {
			return integrity()
		}
		if err = fn(row, &observation); err != nil {
			return err
		}
		row.Observation, err = json.Marshal(observation)
		if err != nil {
			return err
		}
		row.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
		return repo.SaveCloudOperation(row)
	})
}

// workspaceHelper records a dispatch intent before remote IO. An interrupted
// response is never retried: its recorded remote handle must be reconciled.
func (s *CloudService) workspaceHelper(ctx context.Context, access *SandboxAccess, operationID uint64, request workspacefs.Request) (workspacefs.Response, error) {
	if access.HelperOperationID != operationID || access.HelperOperationFence == 0 {
		return workspacefs.Response{}, integrity()
	}
	request.Version = workspacefs.Version
	encoded, err := workspacefs.Encode(request)
	if err != nil {
		return workspacefs.Response{}, err
	}
	ordinal := 0
	err = s.updateWorkspaceObservation(ctx, operationID, access.HelperOperationFence, func(row *CloudOperationRow, observation *workspaceOperationObservation) error {
		if row.Status == "outcome_unknown" || time.Now().UTC().After(row.DeadlineAt) {
			return httpx.E(409, "WORKSPACE_RECONCILING", "工作文件操作需要核实")
		}
		for _, previous := range observation.Executions {
			if previous.State != "completed" {
				return httpx.E(409, "WORKSPACE_RECONCILING", "前一个文件请求尚未核实")
			}
		}
		ordinal = len(observation.Executions)
		if ordinal >= 100 {
			return httpx.E(422, "WORKSPACE_OPERATION_LIMIT", "工作文件操作数量超限")
		}
		// The data field can contain user content. This observation is private;
		// public operations never expose request bodies or helper argv.
		observation.Executions = append(observation.Executions, workspaceHelperExecution{Ordinal: ordinal, Request: request, State: "dispatching"})
		row.Status = "running"
		if row.StartedAt == nil {
			now := time.Now().UTC().Truncate(time.Millisecond)
			row.StartedAt = &now
		}
		return nil
	})
	if err != nil {
		return workspacefs.Response{}, err
	}
	var stdout bytes.Buffer
	uid, gid := uint32(0), uint32(0)
	result, executeErr := access.Provider.Exec(ctx, access.Resource, sandboxcore.ExecSpec{Argv: []string{workspacefs.HelperPath, encoded}, CWD: "/data", UID: &uid, GID: &gid, Background: true, Timeout: 55 * time.Second, MaxOutputBytes: workspacefs.MaxResponseBytes}, sandboxcore.ExecCallbacks{
		Started: func(startCtx context.Context, handle sandboxcore.ExecutionHandle) error {
			return s.updateWorkspaceObservation(startCtx, operationID, access.HelperOperationFence, func(_ *CloudOperationRow, observation *workspaceOperationObservation) error {
				if len(observation.Executions) != ordinal+1 || observation.Executions[ordinal].State != "dispatching" {
					return integrity()
				}
				observation.Executions[ordinal].Handle = &handle
				return nil
			})
		},
		Output: func(_ context.Context, output sandboxcore.Output) error {
			if output.Stream == "stdout" {
				if stdout.Len()+len(output.Text) > workspacefs.MaxResponseBytes {
					return integrity()
				}
				_, _ = stdout.WriteString(output.Text)
			}
			return nil
		},
	})
	if executeErr == nil && result.Handle != nil {
		var output []byte
		result, output, executeErr = awaitWorkspaceHelper(ctx, access.Provider, *result.Handle)
		stdout.Reset()
		_, _ = stdout.Write(output)
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if executeErr == nil && result.Handle != nil && !result.Running && result.ExitCode == nil {
		result, executeErr = access.Provider.InspectExecution(cleanup, *result.Handle)
	}
	var response workspacefs.Response
	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	decoder.DisallowUnknownFields()
	valid := !result.Running && result.ExitCode != nil && !result.OutputTruncated && decoder.Decode(&response) == nil && decoder.Decode(new(any)) == io.EOF && response.Version == workspacefs.Version
	unknown := executeErr != nil || !valid
	var remoteFailure *sandboxcore.Error
	if errors.As(executeErr, &remoteFailure) && !remoteFailure.Unknown && result.Handle == nil {
		response = workspacefs.Response{Version: workspacefs.Version, Code: remoteFailure.Code}
		unknown = false
	}
	err = s.updateWorkspaceObservation(cleanup, operationID, access.HelperOperationFence, func(row *CloudOperationRow, observation *workspaceOperationObservation) error {
		if len(observation.Executions) != ordinal+1 {
			return integrity()
		}
		if unknown {
			row.Status = "outcome_unknown"
			code := "WORKSPACE_IO_OUTCOME_UNKNOWN"
			row.ErrorCode = &code
			observation.Executions[ordinal].State = "outcome_unknown"
		} else {
			observation.Executions[ordinal].State = "completed"
			observation.Executions[ordinal].Response = &response
		}
		return nil
	})
	if unknown || err != nil {
		_ = s.MarkReferencesUnknown(cleanup, access, "workspace_helper_outcome_unknown", json.RawMessage(`{"remote_result_confirmed":false}`))
		return response, httpx.E(409, "WORKSPACE_IO_OUTCOME_UNKNOWN", "工作文件操作结果需要核实，请勿重复执行")
	}
	if !response.OK {
		return response, helperFailure(response.Code)
	}
	return response, nil
}

func awaitWorkspaceHelper(ctx context.Context, provider sandboxcore.Provider, handle sandboxcore.ExecutionHandle) (sandboxcore.ExecResult, []byte, error) {
	var result sandboxcore.ExecResult
	for {
		var err error
		result, err = provider.InspectExecution(ctx, handle)
		if err != nil {
			return result, nil, err
		}
		if !result.Running {
			break
		}
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return result, nil, ctx.Err()
		case <-timer.C:
		}
	}
	if result.ExitCode == nil {
		return result, nil, &sandboxcore.Error{Code: "SANDBOX_EXECUTION_UNCONFIRMED", Unknown: true}
	}
	data := make([]byte, 0, 4096)
	var cursor int64
	for {
		chunk, err := provider.ReadExecutionOutput(ctx, handle, cursor, 64<<10)
		if err != nil {
			return result, nil, err
		}
		if len(data)+len(chunk.Text) > workspacefs.MaxResponseBytes {
			return result, nil, &sandboxcore.Error{Code: "WORKSPACE_OUTPUT_LIMIT", Unknown: true}
		}
		data = append(data, []byte(chunk.Text)...)
		if chunk.Cursor < cursor || chunk.Cursor == cursor && chunk.Text != "" {
			return result, nil, integrity()
		}
		cursor = chunk.Cursor
		if !chunk.Truncated || chunk.Text == "" {
			return result, data, nil
		}
	}
}

func helperFailure(code string) error {
	status := 409
	if code == "WORKSPACE_PATH_NOT_FOUND" {
		status = 404
	}
	if code == "WORKSPACE_ENTRY_CHANGED" || code == "WORKSPACE_SOURCE_CHANGED" {
		code = "FILE_STATE_CHANGED"
	}
	return httpx.E(status, code, "工作文件状态不符合本次操作要求")
}

func workspaceUnknown(err error) bool {
	var failure *httpx.Error
	return errors.As(err, &failure) && (failure.Code == "WORKSPACE_IO_OUTCOME_UNKNOWN" || failure.Code == "WORKSPACE_RECONCILING")
}

func (s *CloudService) finishWorkspaceOperation(ctx context.Context, id uint64, access *SandboxAccess, result any, cause error) error {
	if access == nil || access.HelperOperationID != id || access.HelperOperationFence == 0 {
		return integrity()
	}
	return s.settleWorkspaceOperation(ctx, id, access, nil, result, cause, !workspaceUnknown(cause))
}

func workspaceHolder(id uint64) string { return strconv.FormatUint(id, 10) }
