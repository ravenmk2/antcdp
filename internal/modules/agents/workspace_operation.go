package agents

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type workspaceExecution struct {
	Ordinal  int                 `json:"ordinal"`
	Request  workspace.Request   `json:"request"`
	Response *workspace.Response `json:"response,omitempty"`
	State    string              `json:"state"`
}
type workspaceOperationObservation struct {
	Executions          []workspaceExecution `json:"executions"`
	LocalStorageKey     string               `json:"local_storage_key,omitempty"`
	LocalCleanupPending bool                 `json:"local_cleanup_pending,omitempty"`
	Result              json.RawMessage      `json:"result,omitempty"`
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

func workspaceFailure(code string) error {
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
	if access == nil || access.WorkspaceOperationID != id || access.WorkspaceOperationFence == 0 {
		return integrity()
	}
	return s.settleWorkspaceOperation(ctx, id, access, nil, result, cause, !workspaceUnknown(cause))
}

func workspaceHolder(id uint64) string { return strconv.FormatUint(id, 10) }
