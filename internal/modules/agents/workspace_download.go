package agents

import (
	"context"
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type workspaceExport struct {
	TransferPath string `json:"transfer_path"`
	SourcePath   string `json:"source_path"`
	Size         uint64 `json:"size_bytes,string"`
	SHA256       string `json:"sha256"`
	Identity     string `json:"identity"`
}

func (s *CloudService) OpenWorkspaceFile(ctx context.Context, raw string, id uint64, name string) (*Result, *WorkspaceFileContent, error) {
	name, err := workspacePath(name, false)
	if err != nil {
		return nil, nil, err
	}
	if s.Host.Files == nil {
		return nil, nil, unavailable()
	}
	result, op, access, err := s.beginWorkspaceRead(ctx, raw, id, "workspace_download", workspaceFileIntent{Path: name})
	if err != nil {
		return result, nil, err
	}
	ctx, cancel := context.WithDeadline(ctx, op.DeadlineAt)
	defer cancel()
	key, facts, err := s.copyWorkspaceSnapshot(ctx, access, op.ID, name)
	if finishErr := s.finishWorkspaceOperation(ctx, op.ID, access, nil, err); err == nil {
		err = finishErr
	}
	if err != nil {
		return result, nil, err
	}
	reader, err := s.Host.Files.Open(key)
	if err != nil {
		_ = s.deleteWorkspaceDownload(ctx, op.ID, key)
		return result, nil, err
	}
	lease := &leasedReader{ReadSeekCloser: reader, closed: func() { _ = s.deleteWorkspaceDownload(context.WithoutCancel(ctx), op.ID, key) }}
	return result, &WorkspaceFileContent{Reader: lease, Filename: downloadFilename(name), Size: facts.Size}, nil
}

func (s *CloudService) deleteWorkspaceDownload(ctx context.Context, id uint64, key string) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.Host.Files.Delete(key); err != nil {
		return err
	}
	return s.cloudBackground(cleanup, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		op, err := repo.CloudOperation(id, true)
		if err != nil {
			return err
		}
		if op == nil {
			return nil
		}
		var observation workspaceOperationObservation
		if json.Unmarshal(op.Observation, &observation) != nil {
			return integrity()
		}
		if observation.LocalStorageKey != key {
			return integrity()
		}
		observation.LocalStorageKey = ""
		observation.LocalCleanupPending = false
		op.Observation, err = json.Marshal(observation)
		if err != nil {
			return err
		}
		return repo.SaveCloudOperation(op)
	})
}

// copyWorkspaceSnapshot verifies the complete transfer before exposing bytes.
// The remote path is a helper-created private snapshot, never a user pathname.
func (s *CloudService) copyWorkspaceSnapshot(ctx context.Context, access *SandboxAccess, operationID uint64, name string) (string, ByteFacts, error) {
	transfer := NewStorageKey()
	key := NewStorageKey()
	err := s.updateWorkspaceObservation(ctx, operationID, access.HelperOperationFence, func(_ *CloudOperationRow, observation *workspaceOperationObservation) error {
		if observation.TransferToken != "" || observation.LocalStorageKey != "" {
			return integrity()
		}
		observation.TransferToken = transfer
		observation.TransferState = "preparing"
		observation.LocalStorageKey = key
		return nil
	})
	if err != nil {
		return "", ByteFacts{}, err
	}
	if _, err = s.workspaceHelper(ctx, access, operationID, workspacefs.Request{Operation: "transfer_begin", Token: transfer}); err != nil {
		return key, ByteFacts{}, err
	}
	response, err := s.workspaceHelper(ctx, access, operationID, workspacefs.Request{Operation: "export", Token: transfer, Path: name})
	if err != nil {
		return key, ByteFacts{}, err
	}
	var exported workspaceExport
	if json.Unmarshal(response.Result, &exported) != nil || exported.TransferPath != workspacefs.TransferDirectory+"/"+transfer+"/payload" || exported.SourcePath != name || exported.Size > uint64(workspacefs.MaxFileBytes) {
		return key, ByteFacts{}, integrity()
	}
	expected, err := hex.DecodeString(exported.SHA256)
	if err != nil || len(expected) != 32 {
		return key, ByteFacts{}, integrity()
	}
	uid, gid := uint32(0), uint32(0)
	err = s.updateWorkspaceObservation(ctx, operationID, access.HelperOperationFence, func(_ *CloudOperationRow, observation *workspaceOperationObservation) error {
		observation.TransferState = "started"
		return nil
	})
	if err != nil {
		return key, ByteFacts{}, err
	}
	reader, err := access.Provider.OpenFile(ctx, access.Resource, sandboxcore.FileRequest{Path: exported.TransferPath, UID: &uid, GID: &gid, MaxBytes: workspacefs.MaxFileBytes + 1})
	if err != nil {
		return key, ByteFacts{}, s.workspaceTransferUnknown(ctx, access, operationID)
	}
	facts, copyErr := s.Host.Files.Write(ctx, key, reader, workspacefs.MaxFileBytes)
	closeErr := reader.Close()
	if copyErr != nil || closeErr != nil {
		return key, facts, s.workspaceTransferUnknown(ctx, access, operationID)
	}
	err = s.updateWorkspaceObservation(ctx, operationID, access.HelperOperationFence, func(_ *CloudOperationRow, observation *workspaceOperationObservation) error {
		observation.TransferState = "finished"
		return nil
	})
	if err != nil {
		return key, facts, err
	}
	if facts.Size != exported.Size || !hmac.Equal(facts.SHA256, expected) {
		_ = s.Host.Files.Delete(key)
		return key, ByteFacts{}, httpx.E(409, "FILE_STATE_CHANGED", "工作文件快照校验失败")
	}
	if _, err = s.workspaceHelper(ctx, access, operationID, workspacefs.Request{Operation: "transfer_cleanup", Token: transfer}); err != nil {
		return key, facts, err
	}
	err = s.updateWorkspaceObservation(ctx, operationID, access.HelperOperationFence, func(_ *CloudOperationRow, observation *workspaceOperationObservation) error {
		observation.TransferToken = ""
		return nil
	})
	return key, facts, err
}

func (s *CloudService) workspaceTransferUnknown(ctx context.Context, access *SandboxAccess, id uint64) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	_ = s.updateWorkspaceObservation(cleanup, id, access.HelperOperationFence, func(row *CloudOperationRow, _ *workspaceOperationObservation) error {
		row.Status = "outcome_unknown"
		code := "WORKSPACE_TRANSFER_OUTCOME_UNKNOWN"
		row.ErrorCode = &code
		return nil
	})
	_ = s.MarkReferencesUnknown(cleanup, access, "workspace_transfer_outcome_unknown", json.RawMessage(`{"transfer_finished":false}`))
	return httpx.E(409, "WORKSPACE_IO_OUTCOME_UNKNOWN", "工作文件传输结果需要核实，请勿重复执行")
}
