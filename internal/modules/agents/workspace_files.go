package agents

import (
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type WorkspaceEntryQuery struct {
	Path           string
	Page, PageSize int
}
type WorkspaceEntry struct {
	Name       string     `json:"name"`
	Path       string     `json:"path"`
	Kind       string     `json:"kind"`
	Size       *uint64    `json:"size_bytes,string"`
	ModifiedAt *time.Time `json:"modified_at"`
	EntryToken string     `json:"entry_token"`
}
type WorkspaceDirectoryWrite struct {
	Path string `json:"path"`
}
type WorkspaceRemovalItem struct {
	Path       string `json:"path"`
	EntryToken string `json:"entry_token"`
}
type WorkspaceRemovalWrite struct {
	Items     []WorkspaceRemovalItem `json:"items"`
	Recursive bool                   `json:"recursive"`
}
type WorkspaceFileContent struct {
	Reader   ReadSeekCloser
	Filename string
	Size     uint64
}
type workspaceEntryCondition struct {
	ComputerID uint64 `json:"cloud_computer_id,string"`
	Fence      uint64 `json:"fence,string"`
	Path       string `json:"path"`
	Identity   string `json:"identity"`
}
type workspaceFileIntent struct {
	Path           string                    `json:"path,omitempty"`
	Items          []workspaceEntryCondition `json:"items,omitempty"`
	Recursive      bool                      `json:"recursive,omitempty"`
	WorkspaceFence uint64                    `json:"workspace_fence,string"`
}

func workspacePath(value string, root bool) (string, error) {
	name, err := workspacefs.PublicPath(value, root)
	if err != nil {
		return "", httpx.Invalid("path", "invalid_format")
	}
	return name, nil
}
func (s *CloudService) entryToken(c workspaceEntryCondition) string {
	b, _ := json.Marshal(c)
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + base64.RawURLEncoding.EncodeToString([]byte(s.Host.ETag("workspace-entry/"+payload)))
}
func (s *CloudService) entryCondition(token string, workspaceID, fence uint64, name string) (workspaceEntryCondition, error) {
	var condition workspaceEntryCondition
	if len(token) > 4096 {
		return condition, httpx.Invalid("entry_token", "invalid_format")
	}
	payload, signature, ok := strings.Cut(token, ".")
	if !ok {
		return condition, httpx.Invalid("entry_token", "invalid_format")
	}
	expected := base64.RawURLEncoding.EncodeToString([]byte(s.Host.ETag("workspace-entry/" + payload)))
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return condition, httpx.Invalid("entry_token", "invalid_signature")
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil || json.Unmarshal(b, &condition) != nil || condition.ComputerID != workspaceID || condition.Fence != fence || condition.Path != name || len(condition.Identity) != 64 {
		return condition, httpx.E(409, "FILE_STATE_CHANGED", "文件目录已变化，请重新读取")
	}
	return condition, nil
}

func (s *CloudService) startWorkspaceOperation(st StateRepository, repo CloudRepository, access *SandboxAccess, kind, actorKind, actorID string, intent any, stableTokens ...string) (*CloudOperationRow, error) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	b, err := json.Marshal(intent)
	if err != nil {
		return nil, err
	}
	token := cryptox.ID()
	if len(stableTokens) > 0 {
		if len(stableTokens) != 1 || len(stableTokens[0]) != 32 {
			return nil, integrity()
		}
		token = stableTokens[0]
		previous, e := repo.CloudOperationByToken(token, true)
		if e != nil {
			return nil, e
		}
		if previous != nil {
			if previous.Kind != kind || previous.ComputerID != access.ComputerID || previous.BackendGeneration != access.BackendGeneration || previous.RuntimeGeneration != access.RuntimeGeneration || previous.StorageGeneration != access.StorageGeneration || !semanticSame(previous.Intent, json.RawMessage(b)) {
				return nil, integrity()
			}
			access.HelperOperationID = previous.ID
			access.HelperOperationFence = previous.FenceVersion
			return previous, nil
		}
	}
	op := &CloudOperationRow{OperationToken: token, Kind: kind, Status: "running", ComputerID: access.ComputerID, BackendGeneration: access.BackendGeneration, RuntimeGeneration: access.RuntimeGeneration, StorageGeneration: access.StorageGeneration, Intent: b, Observation: json.RawMessage(`{"executions":[]}`), ActorKind: actorKind, ActorID: actorID, ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, StartedAt: &now, DeadlineAt: now.Add(60 * time.Second), UpdatedAt: now}
	if access.BindingID != 0 {
		op.RootRunID = &access.BindingID
	}
	if err = repo.InsertCloudOperation(op); err != nil {
		return nil, err
	}
	access.HelperOperationID, access.HelperOperationFence = op.ID, op.FenceVersion
	if err = s.acquireReferences(st, repo, access, "cloud_file_operation", workspaceHolder(op.ID)); err != nil {
		return nil, err
	}
	return op, nil
}

func (s *CloudService) beginWorkspaceRead(ctx context.Context, raw string, id uint64, kind string, intent workspaceFileIntent) (*Result, *CloudOperationRow, *SandboxAccess, error) {
	var op *CloudOperationRow
	var access *SandboxAccess
	var connection CloudConnection
	result, err := s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository, a *identity.Auth, out *Result) error {
		w, err := repo.Computer(id, true)
		if err != nil {
			return err
		}
		if err = workspaceContentAccess(w, a); err != nil {
			return err
		}
		access, connection, err = s.accessRows(repo, id, nil)
		if err != nil {
			return err
		}
		intent.WorkspaceFence = w.FenceVersion
		op, err = s.startWorkspaceOperation(st, repo, access, kind, "user", idString(a.User.ID), intent)
		out.Tag = s.tag("computer", id, w.RowVersion)
		return err
	})
	if err != nil {
		return result, nil, nil, err
	}
	access.Provider, err = s.openProvider(ctx, connection)
	if err != nil {
		_ = s.finishWorkspaceOperation(ctx, op.ID, access, nil, err)
	}
	return result, op, access, err
}

func (s *CloudService) ListWorkspaceEntries(ctx context.Context, raw string, id uint64, q WorkspaceEntryQuery) (*Result, error) {
	name, err := workspacePath(q.Path, true)
	if err != nil {
		return nil, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 100
	}
	if q.PageSize > 100 || q.Page > 100 {
		return nil, httpx.Invalid("page", "out_of_range")
	}
	result, op, access, err := s.beginWorkspaceRead(ctx, raw, id, "workspace_read", workspaceFileIntent{Path: name})
	if err != nil {
		return result, err
	}
	ctx, cancel := context.WithDeadline(ctx, op.DeadlineAt)
	defer cancel()
	response, err := s.workspaceHelper(ctx, access, op.ID, workspacefs.Request{Operation: "list", Path: name, Offset: int64((q.Page - 1) * q.PageSize), Limit: q.PageSize})
	var listing struct {
		Entries []workspacefs.Entry `json:"entries"`
		Total   int                 `json:"total"`
		HasMore bool                `json:"has_more"`
	}
	if err == nil && json.Unmarshal(response.Result, &listing) != nil {
		err = integrity()
	}
	items := make([]WorkspaceEntry, 0, len(listing.Entries))
	var intent workspaceFileIntent
	if json.Unmarshal(op.Intent, &intent) != nil {
		err = integrity()
	}
	if err == nil {
		for _, entry := range listing.Entries {
			if entry.Kind != "file" && entry.Kind != "directory" {
				continue
			}
			when, parseErr := time.Parse(time.RFC3339Nano, entry.ModifiedAt)
			if parseErr != nil || entry.Size < 0 {
				err = integrity()
				break
			}
			item := WorkspaceEntry{Name: entry.Name, Path: entry.Path, Kind: entry.Kind, ModifiedAt: &when, EntryToken: s.entryToken(workspaceEntryCondition{ComputerID: id, Fence: intent.WorkspaceFence, Path: entry.Path, Identity: entry.Identity})}
			if entry.Kind == "file" {
				size := uint64(entry.Size)
				item.Size = &size
			}
			items = append(items, item)
		}
	}
	if finishErr := s.finishWorkspaceOperation(ctx, op.ID, access, nil, err); err == nil {
		err = finishErr
	}
	if err != nil {
		return result, err
	}
	result.Data = items
	result.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: listing.Total}
	return result, nil
}

func (s *CloudService) CreateWorkspaceDirectory(ctx context.Context, raw string, id uint64, key string, w WorkspaceDirectoryWrite) (*Result, error) {
	name, err := workspacePath(w.Path, false)
	if err != nil {
		return nil, err
	}
	w.Path = name
	return s.workspaceMutation(ctx, raw, id, "", key, "workspace.mkdir", "workspace_mkdir", w, func(workspace *CloudComputerRow) (workspaceFileIntent, error) {
		return workspaceFileIntent{Path: name, WorkspaceFence: workspace.FenceVersion}, nil
	})
}
func (s *CloudService) RemoveWorkspaceFiles(ctx context.Context, raw string, id uint64, tag, key string, w WorkspaceRemovalWrite) (*Result, error) {
	if len(w.Items) < 1 || len(w.Items) > 20 {
		return nil, httpx.Invalid("items", "invalid_count")
	}
	seen := map[string]bool{}
	for i := range w.Items {
		name, err := workspacePath(w.Items[i].Path, false)
		if err != nil {
			return nil, err
		}
		if seen[name] {
			return nil, httpx.Invalid("items", "duplicate_path")
		}
		seen[name] = true
		w.Items[i].Path = name
	}
	return s.workspaceMutation(ctx, raw, id, tag, key, "workspace.remove", "workspace_remove", w, func(workspace *CloudComputerRow) (workspaceFileIntent, error) {
		intent := workspaceFileIntent{Recursive: w.Recursive, WorkspaceFence: workspace.FenceVersion}
		for _, item := range w.Items {
			condition, err := s.entryCondition(item.EntryToken, id, workspace.FenceVersion, item.Path)
			if err != nil {
				return intent, err
			}
			intent.Items = append(intent.Items, condition)
		}
		return intent, nil
	})
}
func (s *CloudService) workspaceMutation(ctx context.Context, raw string, id uint64, tag, key, command, kind string, input any, makeIntent func(*CloudComputerRow) (workspaceFileIntent, error)) (*Result, error) {
	return s.cloudAccess(ctx, raw, false, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository, a *identity.Auth, out *Result) error {
		w, err := repo.Computer(id, true)
		if err != nil {
			return err
		}
		if err = workspaceContentAccess(w, a); err != nil {
			return err
		}
		return s.Host.sessionReceipt(ctx, tx, r, st, a, out, key, command, fmt.Sprintf("workspace:%d", id), input, func(receipt *Receipt) error {
			if kind == "workspace_remove" {
				if err = checkTag(tag, s.tag("computer", id, w.RowVersion)); err != nil {
					return err
				}
			}
			_, _, err := s.accessRows(repo, id, nil)
			if err != nil {
				return err
			}
			if err = maintenanceBusy(repo, id); err != nil {
				return err
			}
			intent, err := makeIntent(w)
			if err != nil {
				return err
			}
			op, err := s.enqueueFileOperation(st, repo, a, receipt, kind, w, intent)
			if err != nil {
				return err
			}
			op.DeadlineAt = op.CreatedAt.Add(60 * time.Second)
			if err = st.SavePublicOperation(op); err != nil {
				return err
			}
			physical, err := repo.CloudOperationByPublic(op.ID)
			if err != nil {
				return err
			}
			if physical == nil {
				return integrity()
			}
			physical.DeadlineAt = op.DeadlineAt
			if err = repo.SaveCloudOperation(physical); err != nil {
				return err
			}
			w.RowVersion++
			w.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
			if err = repo.SaveComputer(w); err != nil {
				return err
			}
			out.Status = 202
			out.Data = operationView(op)
			out.Location = fmt.Sprintf("/api/v1/agents/operations/%d", op.ID)
			return audit(ctx, tx, a, command, "workspace", id)
		})
	})
}

func downloadFilename(value string) string { return path.Base(value) }
