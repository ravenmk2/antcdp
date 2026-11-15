package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

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

// copyWorkspaceSnapshot stores the bytes actually downloaded, once. Metadata
// checks detect observed concurrent changes; the provider does not promise a
// point-in-time filesystem snapshot.
func (s *CloudService) copyWorkspaceSnapshot(ctx context.Context, access *SandboxAccess, operationID uint64, name string) (string, ByteFacts, error) {
	key := NewStorageKey()
	var facts ByteFacts
	_, err := s.recordNativeRequest(ctx, access, operationID, workspace.Request{Operation: "download", Path: name}, func() (workspace.Response, error) {
		f, e := nativeFiles(access)
		if e != nil {
			return workspace.Response{}, e
		}
		remote, e := nativePath(name)
		if e != nil {
			return workspace.Response{}, e
		}
		before, e := f.StatFile(ctx, access.Resource, remote)
		if e != nil {
			return workspace.Response{}, e
		}
		if !nativeFile(before) || before.Size > workspace.MaxFileBytes {
			return workspace.Response{}, nativeError("WORKSPACE_SOURCE_INVALID")
		}
		e = s.updateWorkspaceObservation(ctx, operationID, access.WorkspaceOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
			o.LocalStorageKey = key
			return nil
		})
		if e != nil {
			return workspace.Response{}, e
		}
		reader, e := f.OpenFile(ctx, access.Resource, sandboxcore.FileRequest{Path: remote, MaxBytes: workspace.MaxFileBytes + 1})
		if e != nil {
			return workspace.Response{}, e
		}
		facts, e = s.Host.Files.Write(ctx, key, reader, workspace.MaxFileBytes)
		closeErr := reader.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			return workspace.Response{}, e
		}
		after, e := f.StatFile(ctx, access.Resource, remote)
		if e != nil {
			return workspace.Response{}, e
		}
		if facts.Size != uint64(before.Size) || nativeIdentity(before) != nativeIdentity(after) {
			return workspace.Response{}, nativeError("FILE_STATE_CHANGED")
		}
		return workspace.Result(map[string]any{"size_bytes": facts.Size, "sha256": hexHash(facts.SHA256)}, false, nil), nil
	})
	if err != nil {
		_ = s.deleteWorkspaceDownload(context.WithoutCancel(ctx), operationID, key)
	}
	return key, facts, err
}
