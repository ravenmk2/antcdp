package agents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"image"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type PresentFile struct {
	Path        string `json:"path"`
	Description string `json:"description,omitempty"`
}
type PresentRequest struct {
	Files []PresentFile `json:"files"`
}
type ImportFileRequest struct {
	Source      agentcore.FileRef `json:"source"`
	Destination string            `json:"destination"`
}
type ReadImageRequest struct {
	Path string `json:"path"`
}
type fileTransferIntent struct {
	Present *PresentRequest        `json:"present,omitempty"`
	Import  *ImportFileRequest     `json:"import,omitempty"`
	Image   *ReadImageRequest      `json:"image,omitempty"`
	Helpers []uint64               `json:"helpers"`
	Ref     agentcore.ExecutionRef `json:"execution"`
}
type fileTransferClaim struct {
	Operation  FileOperationRow
	Intent     fileTransferIntent
	Items      []FileOperationItemRow
	Access     *SandboxAccess
	Connection CloudConnection
	Source     *FileRow
	Replay     *agentcore.DispatchObservation
}

func validatePresent(w PresentRequest) error {
	if len(w.Files) < 1 || len(w.Files) > 20 {
		return httpx.Invalid("files", "invalid_count")
	}
	seen := map[string]bool{}
	for _, v := range w.Files {
		if _, e := workspacefs.Normalize(v.Path, false); e != nil || seen[v.Path] || !safeFilename(path.Base(v.Path)) {
			return httpx.Invalid("files.path", "invalid_format")
		}
		if len(v.Description) > 8000 || !utf8.ValidString(v.Description) || utf8.RuneCountInString(v.Description) > 2000 {
			return httpx.Invalid("files.description", "too_long")
		}
		seen[v.Path] = true
	}
	return nil
}
func fileCWDPath(cwd, relative string) (string, error) {
	if _, e := workspacefs.Normalize(relative, false); e != nil {
		return "", httpx.Invalid("path", "invalid_format")
	}
	base, ok := strings.CutPrefix(cwd, "/data/")
	if !ok {
		return "", integrity()
	}
	resolved, e := workspacePath(base+"/"+relative, false)
	if e == nil && len("/data/"+resolved) > 1024 {
		return "", httpx.Invalid("path", "too_long")
	}
	return resolved, e
}
func fileRefSource(st StateRepository, x executionRows, source agentcore.FileRef) (*FileRow, error) {
	if source.Kind != "attachment" && source.Kind != "artifact" || source.ID == 0 {
		return nil, httpx.Invalid("source", "invalid_format")
	}
	selected, e := st.RootInputFileSelected(x.Root.ID, source.Kind, uint64(source.ID))
	if e != nil {
		return nil, e
	}
	if !selected {
		return nil, missing()
	}
	var id uint64
	if source.Kind == "attachment" {
		v, e := st.Attachment(uint64(source.ID), false)
		if e != nil {
			return nil, e
		}
		if v == nil || v.ContentSessionID != x.RootSession.ID || v.State != "bound" {
			return nil, missing()
		}
		id = v.FileID
	} else {
		v, e := st.Artifact(uint64(source.ID), false)
		if e != nil {
			return nil, e
		}
		if v == nil || v.ContentSessionID != x.RootSession.ID || v.DeletedAt != nil {
			return nil, missing()
		}
		id = v.FileID
	}
	file, e := st.File(id, true)
	if e != nil {
		return nil, e
	}
	if file == nil || file.ContentSessionID == nil || *file.ContentSessionID != x.RootSession.ID || file.ContentDomain != x.RootSession.ExecutionMode || file.State != "bound" || file.IntegrityState != "verified" || file.SizeBytes == nil || *file.SizeBytes > 100<<20 || len(file.SHA256) != 32 {
		return nil, httpx.E(409, "FILE_UNAVAILABLE", "来源文件当前不可用")
	}
	if file.ContentDomain == "interactive" && (file.OwnerUserID == nil || x.RootSession.personalOwnerID() == nil || *file.OwnerUserID != *x.RootSession.personalOwnerID()) || file.ContentDomain == "service" && (file.AgentID == nil || *file.AgentID != x.RootSession.AgentID) {
		return nil, missing()
	}
	return file, nil
}

func (s *CloudService) reserveFileTransfer(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, present *PresentRequest, imported *ImportFileRequest, readImage *ReadImageRequest) (fileTransferClaim, error) {
	var out fileTransferClaim
	if s.Host.Files == nil {
		return out, unavailable()
	}
	kind := "present"
	var body any = present
	if imported != nil {
		kind = "import_file"
		body = imported
	}
	if readImage != nil {
		kind = "read_image"
		body = readImage
	}
	canonical, e := agentcore.CanonicalJSON(body)
	if e != nil {
		return out, e
	}
	hash := sha256.Sum256(canonical)
	e = s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		if x.RootSession.ArchivedAt != nil {
			return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
		}
		if readImage != nil && x.Execution.Model.Capabilities.ImageInput != modelcore.Supported {
			return httpx.E(422, "MODEL_CAPABILITY_UNSUPPORTED", "当前锁定模型不支持已验证的图像输入")
		}
		call, e := st.ToolCall(callID, true)
		if e != nil {
			return e
		}
		if call == nil || call.RunID != x.Run.ID || call.RootRunID != x.Root.ID {
			return missing()
		}
		previous, e := st.FileOperationByTool(callID, true)
		if e != nil {
			return e
		}
		if previous != nil {
			if !hmac.Equal(previous.RequestHash, hash[:]) || previous.Kind != kind {
				return integrity()
			}
			if previous.Status == "succeeded" && call.ResultEventSeq != nil {
				commit, e := loadToolCommit(st, call)
				if e != nil {
					return e
				}
				var receipt agentcore.CommitReceipt
				if json.Unmarshal(previous.CommitReceipt, &receipt) != nil {
					return integrity()
				}
				out.Replay = &agentcore.DispatchObservation{Status: commit.Result.Status, Executed: commit.Result.Executed, Content: commit.Result.Content, Reason: commit.Result.Reason, Committed: &receipt}
				return nil
			}
			return httpx.E(409, "FILE_OPERATION_EXISTS", "已有传输意图，必须核实原结果而不能重放")
		}
		if _, e = commandTool(st, ref, callID, kind); e != nil {
			return e
		}
		if e = currentCommandPermission(r, st, x.Agent.ID, call); e != nil {
			return e
		}
		prepared, e := preparedCall(st, ref, call)
		if e != nil {
			return e
		}
		var frozen any
		if readImage != nil {
			frozen = &ReadImageRequest{}
		} else if present != nil {
			frozen = &PresentRequest{}
		} else {
			frozen = &ImportFileRequest{}
		}
		if json.Unmarshal([]byte(prepared.Call.Arguments), frozen) != nil {
			return integrity()
		}
		actual, e := agentcore.CanonicalJSON(frozen)
		if e != nil || !hmac.Equal(actual, canonical) {
			return integrity()
		}
		binding, e := repo.Lease(x.Root.ID, false)
		if e != nil {
			return e
		}
		if binding == nil || binding.ComputerID == 0 {
			return httpx.E(409, "SANDBOX_NOT_READY", "当前执行没有沙箱")
		}
		out.Access, out.Connection, e = s.accessRows(repo, binding.ComputerID, binding)
		if e != nil {
			return e
		}
		out.Access.CWD = x.Context.Row.CWD
		binding, e = repo.Lease(binding.RootRunID, true)
		if e != nil {
			return e
		}
		if binding == nil || binding.State != "active" || binding.FenceVersion != out.Access.BindingFence {
			return integrity()
		}
		computer, e := repo.Computer(out.Access.ComputerID, false)
		if e != nil {
			return e
		}
		if computer == nil || computer.VolumeID == nil || computerCapabilities(computer).FileTransfer != "supported" {
			return httpx.E(409, "SANDBOX_FILE_TRANSFER_UNVERIFIED", "沙箱文件传输能力尚未验证")
		}
		if imported != nil {
			out.Source, e = fileRefSource(st, x, imported.Source)
			if e != nil {
				return e
			}
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		deadline := now.Add(120 * time.Second)
		if call.DeadlineAt.Before(deadline) {
			deadline = call.DeadlineAt
		}
		if x.Root.DeadlineAt.Before(deadline) {
			deadline = x.Root.DeadlineAt
		}
		out.Operation = FileOperationRow{ToolCallID: callID, ContentSessionID: x.RootSession.ID, RootRunID: x.Root.ID, Kind: kind, OperationToken: NewStorageKey(), Status: "preparing", BindingID: binding.RootRunID, ComputerID: out.Access.ComputerID, BackendGeneration: out.Access.BackendGeneration, RuntimeGeneration: out.Access.RuntimeGeneration, StorageGeneration: out.Access.StorageGeneration, VolumeID: *computer.VolumeID, BindingFenceVersion: binding.FenceVersion, ExecutorEpoch: s.Epoch, FenceVersion: 1, RequestHash: hash[:], Result: json.RawMessage(`{}`), CommitReceipt: json.RawMessage(`null`), CreatedAt: now, DeadlineAt: deadline, UpdatedAt: now}
		if e = st.InsertFileOperation(&out.Operation); e != nil {
			return e
		}
		out.Intent = fileTransferIntent{Present: present, Import: imported, Image: readImage, Ref: ref, Helpers: []uint64{}}
		count := 1
		if present != nil {
			count = len(present.Files)
		}
		for i := 0; i < count; i++ {
			item := FileOperationItemRow{OperationID: out.Operation.ID, Ordinal: uint64(i), PublicationToken: NewStorageKey(), State: "pending"}
			var relative string
			if present != nil {
				relative = present.Files[i].Path
				item.SourceKind = "workspace"
			} else {
				relative = imported.Destination
				item.SourceKind = imported.Source.Kind
				source := uint64(imported.Source.ID)
				item.SourceReferenceID = &source
				item.SourceFileID = &out.Source.ID
				item.ExpectedSHA256 = out.Source.SHA256
			}
			name, e := fileCWDPath(out.Access.CWD, relative)
			if readImage != nil {
				name, e = workspaceToolPath(out.Access.CWD, readImage.Path)
			}
			if e != nil {
				return e
			}
			if present != nil {
				item.SourcePath = &name
			} else {
				item.DestinationPath = &name
			}
			if e = st.InsertFileOperationItem(&item); e != nil {
				return e
			}
			out.Items = append(out.Items, item)
			helperAccess := *out.Access
			op, e := s.startWorkspaceOperation(st, repo, &helperAccess, "workspace_tool", "system", "system", map[string]any{"file_operation_id": strconv.FormatUint(out.Operation.ID, 10), "ordinal": i})
			if e != nil {
				return e
			}
			op.DeadlineAt = deadline
			if e = repo.SaveCloudOperation(op); e != nil {
				return e
			}
			out.Intent.Helpers = append(out.Intent.Helpers, op.ID)
		}
		out.Operation.Result, e = json.Marshal(out.Intent)
		if e != nil {
			return e
		}
		if e = st.SaveFileOperation(&out.Operation); e != nil {
			return e
		}
		if e = s.acquireReferences(st, repo, out.Access, "file_operation", strconv.FormatUint(out.Operation.ID, 10)); e != nil {
			return e
		}
		if out.Source != nil {
			return holdTransferFile(st, &out.Operation, out.Source.ID, now)
		}
		return nil
	})
	return out, e
}
func holdTransferFile(st StateRepository, op *FileOperationRow, id uint64, now time.Time) error {
	return st.InsertResourceReference(&ResourceReferenceRow{HolderKind: "file_operation", HolderID: strconv.FormatUint(op.ID, 10), ResourceKind: "file", ResourceID: id, State: "active", ExecutorEpoch: op.ExecutorEpoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now, ReleaseEvidence: json.RawMessage(`null`)})
}

func (s *CloudService) Present(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, w PresentRequest) (agentcore.DispatchObservation, error) {
	if e := validatePresent(w); e != nil {
		return agentcore.DispatchObservation{}, e
	}
	claim, e := s.reserveFileTransfer(ctx, ref, callID, &w, nil, nil)
	if e != nil {
		return agentcore.DispatchObservation{}, e
	}
	if claim.Replay != nil {
		return *claim.Replay, nil
	}
	ctx, cancel := context.WithDeadline(ctx, claim.Operation.DeadlineAt)
	defer cancel()
	claim.Access.Provider, e = s.openProvider(ctx, claim.Connection)
	var total uint64
	for i := range claim.Items {
		if e != nil {
			break
		}
		item := &claim.Items[i]
		access := *claim.Access
		access.HelperOperationID = claim.Intent.Helpers[i]
		access.HelperOperationFence = 1
		var key string
		var facts ByteFacts
		key, facts, e = s.copyWorkspaceSnapshot(ctx, &access, access.HelperOperationID, *item.SourcePath)
		if e == nil {
			total += facts.Size
			if total > 200<<20 {
				e = httpx.E(422, "FILE_TOTAL_LIMIT_EXCEEDED", "成果总大小超过限制")
			}
		}
		if e == nil {
			e = s.stagePresentedFile(ctx, claim, *item, key, facts)
		}
		if e != nil {
			if cleanupErr := s.cleanupKnownFileTransfer(ctx, &access); cleanupErr != nil {
				e = cleanupErr
			}
		}
		if finish := s.finishWorkspaceOperation(ctx, access.HelperOperationID, &access, nil, e); e == nil {
			e = finish
		}
	}
	if e == nil {
		return s.commitFileTransfer(ctx, claim)
	}
	return s.failFileTransfer(ctx, claim, e)
}

// ReadImage stores a controlled, immutable model-history image. It does not
// publish an artifact or grant access to an arbitrary file ID or URL.
func (s *CloudService) ReadImage(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, w ReadImageRequest) (agentcore.DispatchObservation, error) {
	if w.Path == "" || len(w.Path) > 1024 {
		return agentcore.DispatchObservation{}, httpx.Invalid("path", "invalid_format")
	}
	present := PresentRequest{Files: []PresentFile{{Path: w.Path}}}
	claim, e := s.reserveFileTransfer(ctx, ref, callID, &present, nil, &w)
	if e != nil {
		return agentcore.DispatchObservation{}, e
	}
	if claim.Replay != nil {
		return *claim.Replay, nil
	}
	ctx, cancel := context.WithDeadline(ctx, claim.Operation.DeadlineAt)
	defer cancel()
	access := *claim.Access
	access.HelperOperationID = claim.Intent.Helpers[0]
	access.HelperOperationFence = 1
	access.Provider, e = s.openProvider(ctx, claim.Connection)
	if e == nil {
		var key string
		var facts ByteFacts
		key, facts, e = s.copyWorkspaceSnapshot(ctx, &access, access.HelperOperationID, *claim.Items[0].SourcePath)
		if e == nil {
			e = s.stagePresentedFile(ctx, claim, claim.Items[0], key, facts)
		}
	}
	if e != nil {
		if cleanup := s.cleanupKnownFileTransfer(ctx, &access); cleanup != nil {
			e = cleanup
		}
	}
	if finish := s.finishWorkspaceOperation(ctx, access.HelperOperationID, &access, nil, e); e == nil {
		e = finish
	}
	if e == nil {
		return s.commitFileTransfer(ctx, claim)
	}
	return s.failFileTransfer(ctx, claim, e)
}

func (s *CloudService) stagePresentedFile(ctx context.Context, claim fileTransferClaim, item FileOperationItemRow, key string, facts ByteFacts) error {
	media := "application/octet-stream"
	reader, e := s.Host.Files.Open(key)
	if e != nil {
		return e
	}
	prefix := make([]byte, 512)
	n, readErr := reader.Read(prefix)
	closeErr := reader.Close()
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return readErr
	}
	if closeErr != nil {
		return closeErr
	}
	media = http.DetectContentType(prefix[:n])
	properties := json.RawMessage(`{}`)
	if claim.Intent.Image != nil {
		if !isImage(media) || facts.Size > modelcore.MaxImageBytes {
			return httpx.E(422, "IMAGE_INVALID", "图像格式或大小不支持")
		}
		picture, e := s.Host.Files.Open(key)
		if e != nil {
			return e
		}
		config, _, decodeErr := image.DecodeConfig(picture)
		closeErr := picture.Close()
		if decodeErr != nil || closeErr != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 4096 || config.Height > 4096 || int64(config.Width)*int64(config.Height) > 16777216 {
			return httpx.E(422, "IMAGE_INVALID", "图像尺寸或内容无效")
		}
		properties, _ = json.Marshal(map[string]int{"width": config.Width, "height": config.Height})
	}
	return s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, _ CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, claim.Intent.Ref, false)
		if e != nil {
			return e
		}
		op, e := st.FileOperation(claim.Operation.ID, true)
		if e != nil {
			return e
		}
		if !sameFileOperation(op, claim.Operation) {
			return httpx.E(409, "OPERATION_FENCED", "文件操作已过期")
		}
		row, e := st.FileOperationItem(op.ID, item.Ordinal, true)
		if e != nil {
			return e
		}
		if row == nil || row.StagedFileID != nil {
			return integrity()
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		expires := now.Add(time.Hour)
		purpose := "agent_artifact"
		if claim.Intent.Image != nil {
			purpose = "tool_image"
		}
		file := &FileRow{Purpose: purpose, ContentDomain: x.RootSession.ExecutionMode, ContentSessionID: &x.RootSession.ID, OwnerUserID: x.RootSession.personalOwnerID(), AgentID: &x.Agent.ID, StorageKey: key, WriterToken: item.PublicationToken, State: "staged", IntegrityState: "verified", SizeBytes: &facts.Size, SHA256: facts.SHA256, MediaType: media, MediaProperties: properties, CreatedByToolCallID: &op.ToolCallID, CreatedAt: now, UpdatedAt: now, ExpiresAt: &expires, IntegrityCheckedAt: &now}
		if e = st.InsertFile(file); e != nil {
			return e
		}
		if e = holdTransferFile(st, op, file.ID, now); e != nil {
			return e
		}
		row.StagedFileID = &file.ID
		row.ObservedSizeBytes = &facts.Size
		row.ObservedSHA256 = facts.SHA256
		row.State = "verified"
		row.VerifiedAt = &now
		if e = st.SaveFileOperationItem(row); e != nil {
			return e
		}
		op.Status = "transferring"
		op.UpdatedAt = now
		return st.SaveFileOperation(op)
	})
}
func sameFileOperation(op *FileOperationRow, expected FileOperationRow) bool {
	return op != nil && op.ID == expected.ID && op.OperationToken == expected.OperationToken && op.ExecutorEpoch == expected.ExecutorEpoch && op.FenceVersion == expected.FenceVersion && op.BackendGeneration == expected.BackendGeneration && op.RuntimeGeneration == expected.RuntimeGeneration && op.StorageGeneration == expected.StorageGeneration && op.VolumeID == expected.VolumeID && op.FinishedAt == nil
}

func (s *CloudService) ImportFile(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, w ImportFileRequest) (agentcore.DispatchObservation, error) {
	if _, e := workspacefs.Normalize(w.Destination, false); e != nil {
		return agentcore.DispatchObservation{}, httpx.Invalid("destination", "invalid_format")
	}
	claim, e := s.reserveFileTransfer(ctx, ref, callID, nil, &w, nil)
	if e != nil {
		return agentcore.DispatchObservation{}, e
	}
	if claim.Replay != nil {
		return *claim.Replay, nil
	}
	ctx, cancel := context.WithDeadline(ctx, claim.Operation.DeadlineAt)
	defer cancel()
	access := *claim.Access
	access.HelperOperationID = claim.Intent.Helpers[0]
	access.HelperOperationFence = 1
	access.Provider, e = s.openProvider(ctx, claim.Connection)
	if e == nil {
		e = s.transferImportedFile(ctx, claim, &access)
	}
	if e != nil {
		if cleanupErr := s.cleanupKnownFileTransfer(ctx, &access); cleanupErr != nil {
			e = cleanupErr
		}
	}
	if finish := s.finishWorkspaceOperation(ctx, access.HelperOperationID, &access, nil, e); e == nil {
		e = finish
	}
	if e == nil {
		return s.commitFileTransfer(ctx, claim)
	}
	return s.failFileTransfer(ctx, claim, e)
}

// Cleanup is a separate, bounded helper action only after every previous
// command and byte transfer is confirmed. Unknown uploads/imports retain their
// private staging and references until physical reconciliation supplies proof.
func (s *CloudService) cleanupKnownFileTransfer(ctx context.Context, access *SandboxAccess) error {
	if access.Provider == nil {
		return nil
	}
	var token string
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		op, e := repo.CloudOperation(access.HelperOperationID, false)
		if e != nil {
			return e
		}
		if op == nil || op.FinishedAt != nil || op.Status == "outcome_unknown" {
			return nil
		}
		var observation workspaceOperationObservation
		if json.Unmarshal(op.Observation, &observation) != nil {
			return integrity()
		}
		if observation.TransferState == "started" {
			return nil
		}
		for _, execution := range observation.Executions {
			if execution.State != "completed" || execution.Response == nil {
				return nil
			}
		}
		token = observation.TransferToken
		return nil
	})
	if e != nil || token == "" {
		return e
	}
	if _, e = s.workspaceHelper(ctx, access, access.HelperOperationID, workspacefs.Request{Operation: "transfer_cleanup", Token: token}); e != nil {
		return e
	}
	return s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error { o.TransferToken = ""; return nil })
}

func (s *CloudService) transferImportedFile(ctx context.Context, claim fileTransferClaim, access *SandboxAccess) error {
	item := claim.Items[0]
	source := claim.Source
	facts, e := s.Host.Files.Inspect(ctx, source.StorageKey, 100<<20)
	if e != nil {
		return e
	}
	if source.SizeBytes == nil || facts.Size != *source.SizeBytes || !hmac.Equal(facts.SHA256, source.SHA256) {
		return httpx.E(409, "FILE_INTEGRITY_FAILED", "来源文件校验失败")
	}
	token := item.PublicationToken
	e = s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
		o.TransferToken = token
		o.TransferState = "preparing"
		return nil
	})
	if e != nil {
		return e
	}
	if _, e = s.workspaceHelper(ctx, access, access.HelperOperationID, workspacefs.Request{Operation: "transfer_begin", Token: token}); e != nil {
		return e
	}
	reader, e := s.Host.Files.Open(source.StorageKey)
	if e != nil {
		return e
	}
	e = s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
		o.TransferState = "started"
		return nil
	})
	if e != nil {
		_ = reader.Close()
		return e
	}
	uid, gid := uint32(0), uint32(0)
	putErr := access.Provider.PutFile(ctx, access.Resource, sandboxcore.FileRequest{Path: workspacefs.TransferDirectory + "/" + token + "/payload", UID: &uid, GID: &gid, MaxBytes: max(1, int64(facts.Size))}, reader)
	closeErr := reader.Close()
	if putErr != nil || closeErr != nil {
		return s.workspaceTransferUnknown(ctx, access, access.HelperOperationID)
	}
	e = s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error {
		o.TransferState = "finished"
		return nil
	})
	if e != nil {
		return e
	}
	// Recheck current permission immediately before publishing into the workload.
	e = s.authorizeFilePublication(ctx, claim)
	if e != nil {
		return e
	}
	response, e := s.workspaceHelper(ctx, access, access.HelperOperationID, workspacefs.Request{Operation: "import", Token: token, Path: *item.DestinationPath, ExpectedHash: hexHash(source.SHA256)})
	if e != nil {
		var failure *httpx.Error
		if errors.As(e, &failure) && failure.Code == "WORKSPACE_PATH_EXISTS" {
			return httpx.E(409, "DESTINATION_EXISTS", "目标文件已存在，未覆盖")
		}
		return e
	}
	var result struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
		Size   uint64 `json:"size_bytes,string"`
	}
	if json.Unmarshal(response.Result, &result) != nil || result.Path != *item.DestinationPath || result.SHA256 != hexHash(source.SHA256) || result.Size != facts.Size {
		return integrity()
	}
	e = s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, _ CloudRepository) error {
		op, e := st.FileOperation(claim.Operation.ID, true)
		if e != nil {
			return e
		}
		if !sameFileOperation(op, claim.Operation) {
			return integrity()
		}
		row, e := st.FileOperationItem(op.ID, 0, true)
		if e != nil {
			return e
		}
		if row == nil {
			return integrity()
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		row.ObservedSizeBytes = &facts.Size
		row.ObservedSHA256 = facts.SHA256
		row.State = "verified"
		row.VerifiedAt = &now
		return st.SaveFileOperationItem(row)
	})
	if e != nil {
		return e
	}
	if _, e = s.workspaceHelper(ctx, access, access.HelperOperationID, workspacefs.Request{Operation: "transfer_cleanup", Token: token}); e != nil {
		return e
	}
	return s.updateWorkspaceObservation(ctx, access.HelperOperationID, access.HelperOperationFence, func(_ *CloudOperationRow, o *workspaceOperationObservation) error { o.TransferToken = ""; return nil })
}
func (s *CloudService) authorizeFilePublication(ctx context.Context, claim fileTransferClaim) error {
	return s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, claim.Intent.Ref, true)
		if e != nil {
			return e
		}
		if x.RootSession.ArchivedAt != nil {
			return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
		}
		call, e := commandTool(st, claim.Intent.Ref, claim.Operation.ToolCallID, claim.Operation.Kind)
		if e != nil {
			return e
		}
		if e = currentCommandPermission(r, st, x.Agent.ID, call); e != nil {
			return e
		}
		binding, e := repo.Lease(claim.Operation.BindingID, true)
		if e != nil {
			return e
		}
		if binding == nil || binding.State != "active" || binding.FenceVersion != claim.Operation.BindingFenceVersion || binding.BackendGeneration != claim.Operation.BackendGeneration || binding.RuntimeGeneration == nil || *binding.RuntimeGeneration != claim.Operation.RuntimeGeneration || binding.StorageGeneration != claim.Operation.StorageGeneration {
			return httpx.E(409, "BINDING_CHANGED", "运行绑定已改变")
		}
		return nil
	})
}

func (s *CloudService) commitFileTransfer(ctx context.Context, claim fileTransferClaim) (agentcore.DispatchObservation, error) {
	var out agentcore.DispatchObservation
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, claim.Intent.Ref, true)
		if e != nil {
			return e
		}
		if x.RootSession.ArchivedAt != nil {
			return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
		}
		call, e := commandTool(st, claim.Intent.Ref, claim.Operation.ToolCallID, claim.Operation.Kind)
		if e != nil {
			return e
		}
		if e = currentCommandPermission(r, st, x.Agent.ID, call); e != nil {
			return e
		}
		if _, e = repo.Computer(claim.Operation.ComputerID, true); e != nil {
			return e
		}
		binding, e := repo.Lease(claim.Operation.BindingID, true)
		if e != nil {
			return e
		}
		if binding == nil || binding.State != "active" || binding.FenceVersion != claim.Operation.BindingFenceVersion || binding.BackendGeneration != claim.Operation.BackendGeneration || binding.RuntimeGeneration == nil || *binding.RuntimeGeneration != claim.Operation.RuntimeGeneration || binding.StorageGeneration != claim.Operation.StorageGeneration {
			return httpx.E(409, "BINDING_CHANGED", "运行绑定已改变")
		}
		op, e := st.FileOperation(claim.Operation.ID, true)
		if e != nil {
			return e
		}
		if !sameFileOperation(op, claim.Operation) {
			return integrity()
		}
		items, e := st.FileOperationItems(op.ID, true)
		if e != nil {
			return e
		}
		if len(items) != len(claim.Items) {
			return integrity()
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		rootFrom := x.RootSession.LastSeq + 1
		artifacts := []ArtifactView{}
		ids := []agentcore.ID{}
		summaries := []map[string]any{}
		var images []modelcore.ImagePart
		var imageMetadata map[string]any
		var total uint64
		for i := range items {
			item := &items[i]
			if item.State != "verified" || item.ObservedSizeBytes == nil || len(item.ObservedSHA256) != 32 {
				return integrity()
			}
			total += *item.ObservedSizeBytes
			if total > 200<<20 {
				return httpx.E(422, "FILE_TOTAL_LIMIT_EXCEEDED", "成果总大小超过限制")
			}
			if op.Kind == "present" || op.Kind == "read_image" {
				if item.StagedFileID == nil || item.SourcePath == nil {
					return integrity()
				}
				file, e := st.File(*item.StagedFileID, true)
				if e != nil {
					return e
				}
				if file == nil || file.State != "staged" || file.WriterToken != item.PublicationToken || file.SizeBytes == nil || *file.SizeBytes != *item.ObservedSizeBytes || !hmac.Equal(file.SHA256, item.ObservedSHA256) {
					return integrity()
				}
				file.State = "bound"
				file.BoundAt = &now
				file.ExpiresAt = nil
				file.UpdatedAt = now
				if e = st.SaveFile(file); e != nil {
					return e
				}
				if op.Kind == "read_image" {
					var dimensions struct {
						Width  int `json:"width"`
						Height int `json:"height"`
					}
					if file.Purpose != "tool_image" || !isImage(file.MediaType) || json.Unmarshal(file.MediaProperties, &dimensions) != nil || dimensions.Width < 1 || dimensions.Height < 1 {
						return integrity()
					}
					images = []modelcore.ImagePart{{MIME: file.MediaType, ContentSHA256: hexHash(file.SHA256), Origin: "tool_image"}}
					imageMetadata = map[string]any{"path": "/data/" + *item.SourcePath, "media_type": file.MediaType, "width": dimensions.Width, "height": dimensions.Height, "size_bytes": strconv.FormatUint(*file.SizeBytes, 10), "sha256": hexHash(file.SHA256)}
				} else {
					source, _ := json.Marshal(ArtifactSource{ComputerID: op.ComputerID, BindingID: op.BindingID, BackendGeneration: op.BackendGeneration, RuntimeGeneration: op.RuntimeGeneration, StorageGeneration: op.StorageGeneration, VolumeID: op.VolumeID, Path: "/data/" + *item.SourcePath})
					artifact := &ArtifactRow{ContentSessionID: op.ContentSessionID, RunID: call.RunID, ToolCallID: call.ID, OutputOrdinal: item.Ordinal, FileID: file.ID, Filename: path.Base(*item.SourcePath), Description: claim.Intent.Present.Files[i].Description, SourcePath: "/data/" + *item.SourcePath, SourceSnapshot: source, RetainedEventSeq: rootFrom, RowVersion: 1, CreatedAt: now}
					if e = st.InsertArtifact(artifact); e != nil {
						return e
					}
					view, e := s.Host.artifactView(st, artifact)
					if e != nil {
						return e
					}
					artifacts = append(artifacts, view)
					ids = append(ids, agentcore.ID(artifact.ID))
					item.ArtifactID = &artifact.ID
					summaries = append(summaries, map[string]any{"id": agentcore.ID(artifact.ID), "file_id": agentcore.ID(file.ID), "filename": artifact.Filename, "size_bytes": strconv.FormatUint(*file.SizeBytes, 10), "sha256": hexHash(file.SHA256)})
				}
			}
			item.State = "published"
			item.PublishedAt = &now
			if e = st.SaveFileOperationItem(item); e != nil {
				return e
			}
		}
		extra := map[string]any{}
		var content string
		switch op.Kind {
		case "present":
			if _, e = appendEvent(st, x.RootSession, &x.Root.ID, "artifact/retained", "", map[string]any{"artifacts": artifacts, "tool_call_id": agentcore.ID(call.ID)}, nil, now); e != nil {
				return e
			}
			rootThrough := x.RootSession.LastSeq
			resultSeq := x.Session.LastSeq + 1
			extra["artifacts"] = summaries
			extra["commit_receipt"] = map[string]any{"tool_call_id": agentcore.ID(call.ID), "artifact_ids": ids, "content_session_id": agentcore.ID(x.RootSession.ID), "event_seq_from": agentcore.Seq(rootFrom), "event_seq_to": agentcore.Seq(rootThrough), "tool_result": map[string]any{"session_id": agentcore.ID(x.Session.ID), "event_seq": agentcore.Seq(resultSeq)}}
			b, _ := json.Marshal(summaries)
			content = "已保存成果：" + string(b)
		case "read_image":
			if len(images) != 1 || imageMetadata == nil {
				return integrity()
			}
			extra["read_image"] = imageMetadata
			b, _ := json.Marshal(imageMetadata)
			content = "已读取图像并加入当前模型上下文（未保存为成果）：" + string(b)
		case "import_file":
			item := items[0]
			imported := map[string]any{"source": claim.Intent.Import.Source, "binding_id": agentcore.ID(op.BindingID), "cloud_computer_id": agentcore.ID(op.ComputerID), "path": "/data/" + *item.DestinationPath, "sha256": hexHash(item.ObservedSHA256), "size_bytes": strconv.FormatUint(*item.ObservedSizeBytes, 10), "available": true, "verified_at": now}
			extra["imported_file"] = imported
			b, _ := json.Marshal(imported)
			content = "已导入工作副本（此时核实可用，后续可能被修改或清理）：" + string(b)
		default:
			return integrity()
		}
		yes := true
		if e = settleToolBudget(st, x.Root, call, &yes); e != nil {
			return e
		}
		commit, e := settleToolEvent(st, x.Session, call, "succeeded", &yes, content, "", extra, now, images...)
		if e != nil {
			return e
		}
		commit.Receipt.Ranges[0].Through = agentcore.Seq(x.Session.LastSeq)
		commit.Receipt.ContentSessionID = agentcore.ID(x.RootSession.ID)
		commit.Receipt.ArtifactIDs = ids
		if op.Kind == "present" {
			if x.Session.ID == x.RootSession.ID {
				commit.Receipt.Ranges[0].From = agentcore.Seq(rootFrom)
			} else {
				commit.Receipt.Ranges = append([]agentcore.EventRange{{SessionID: agentcore.ID(x.RootSession.ID), From: agentcore.Seq(rootFrom), Through: agentcore.Seq(x.RootSession.LastSeq)}}, commit.Receipt.Ranges...)
			}
		}
		if e = st.SaveSession(x.RootSession); e != nil {
			return e
		}
		if x.Session.ID != x.RootSession.ID {
			if e = st.SaveSession(x.Session); e != nil {
				return e
			}
		}
		op.Status = "succeeded"
		op.FinishedAt = &now
		op.UpdatedAt = now
		op.Result, e = json.Marshal(extra)
		if e != nil {
			return e
		}
		op.CommitReceipt, e = json.Marshal(commit.Receipt)
		if e != nil {
			return e
		}
		if op.Kind == "present" {
			op.CommittedFromSeq = &rootFrom
			through := x.RootSession.LastSeq
			if x.Session.ID == x.RootSession.ID {
				through = uint64(commit.Receipt.ToolResultSeq) - 1
			}
			op.CommittedThroughSeq = &through
		}
		if e = st.SaveFileOperation(op); e != nil {
			return e
		}
		if e = releaseFileTransferReferences(st, repo, op.ID, now); e != nil {
			return e
		}
		out = agentcore.DispatchObservation{Status: "succeeded", Executed: &yes, Content: commit.Result.Content, Committed: &commit.Receipt}
		return nil
	})
	if e != nil {
		return s.failFileTransfer(ctx, claim, e)
	}
	return out, nil
}

func releaseFileTransferReferences(st StateRepository, repo CloudRepository, id uint64, now time.Time) error {
	refs, e := repo.HolderReferences("file_operation", strconv.FormatUint(id, 10), true)
	if e != nil {
		return e
	}
	for i := range refs {
		v := &refs[i]
		if v.State == "released" {
			continue
		}
		v.State = "released"
		v.ReleasedAt = &now
		v.LastVerifiedAt = &now
		v.UpdatedAt = now
		v.FenceVersion++
		reason := "file_transfer_settled"
		v.ReleaseReason = &reason
		v.ReleaseEvidence = json.RawMessage(`{"physical_completion_verified":true}`)
		if e = st.SaveResourceReference(v); e != nil {
			return e
		}
	}
	return nil
}

func (s *CloudService) failFileTransfer(ctx context.Context, claim fileTransferClaim, cause error) (agentcore.DispatchObservation, error) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	var completed *agentcore.DispatchObservation
	e := s.cloudBackground(cleanup, func(_ identity.Tx, _ Repository, st StateRepository, _ CloudRepository) error {
		op, e := st.FileOperation(claim.Operation.ID, true)
		if e != nil {
			return e
		}
		if op != nil && op.Status == "succeeded" {
			call, e := st.ToolCall(op.ToolCallID, false)
			if e != nil {
				return e
			}
			if call == nil {
				return integrity()
			}
			commit, e := loadToolCommit(st, call)
			if e != nil {
				return e
			}
			var receipt agentcore.CommitReceipt
			if json.Unmarshal(op.CommitReceipt, &receipt) != nil {
				return integrity()
			}
			completed = &agentcore.DispatchObservation{Status: commit.Result.Status, Executed: commit.Result.Executed, Content: commit.Result.Content, Reason: commit.Result.Reason, Committed: &receipt}
			return nil
		}
		if !sameFileOperation(op, claim.Operation) {
			return integrity()
		}
		code := fileTransferError(cause)
		op.Status = "outcome_unknown"
		op.ErrorCode = &code
		op.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
		return st.SaveFileOperation(op)
	})
	if e == nil && completed != nil {
		return *completed, nil
	}
	code := fileTransferError(cause)
	if e == nil && (code == "DESTINATION_EXISTS" || code == "WORKSPACE_PATH_NOT_FOUND" || code == "FILE_INTEGRITY_FAILED" || code == "FILE_TOTAL_LIMIT_EXCEEDED" || code == "IMAGE_INVALID") {
		yes := true
		return agentcore.DispatchObservation{Status: "failed", Executed: &yes, Content: "文件操作失败：" + code, Reason: code}, cause
	}
	return agentcore.DispatchObservation{Status: "outcome_unknown", Content: "文件操作未提交可确认结果；已保留原操作用于核实，请勿重复执行。", Reason: "FILE_OPERATION_UNCONFIRMED"}, errors.Join(cause, e)
}

func fileTransferError(cause error) string {
	var failure *httpx.Error
	if errors.As(cause, &failure) {
		switch failure.Code {
		case "DESTINATION_EXISTS", "WORKSPACE_PATH_NOT_FOUND", "FILE_INTEGRITY_FAILED", "FILE_TOTAL_LIMIT_EXCEEDED", "IMAGE_INVALID", "SESSION_ARCHIVED", "TOOL_PERMISSION_REVOKED", "FILE_STATE_CHANGED", "EXECUTION_FENCED", "OPERATION_FENCED", "BINDING_CHANGED":
			return failure.Code
		}
	}
	return remoteSandboxError(cause)
}

// Interrupted transfers are never resumed. This worker waits for all recorded
// helper/transfer effects to be physically resolved, then retires staging bytes.
// The original tool result remains immutable, including an unknown result.
func (s *CloudService) ProcessFileOperations(ctx context.Context, limit int) error {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	var rows []FileOperationRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, _ CloudRepository) error {
		var e error
		rows, e = st.PendingFileOperations(s.Epoch, time.Now().UTC(), limit)
		return e
	})
	if e != nil {
		return e
	}
	var failures []error
	for _, row := range rows {
		if ctx.Err() != nil {
			return errors.Join(append(failures, ctx.Err())...)
		}
		if e = s.retireFileTransfer(ctx, row); e != nil {
			failures = append(failures, e)
		}
	}
	return errors.Join(failures...)
}
func (s *CloudService) retireFileTransfer(ctx context.Context, initial FileOperationRow) error {
	var intent fileTransferIntent
	if json.Unmarshal(initial.Result, &intent) != nil {
		return integrity()
	}
	for _, id := range intent.Helpers {
		if e := s.processWorkspaceOperation(ctx, id); e != nil && !workspaceUnknown(e) {
			return e
		}
	}
	keys := []string{}
	ready := false
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		if _, e := st.Session(initial.ContentSessionID, true); e != nil {
			return e
		}
		if _, e := repo.Computer(initial.ComputerID, true); e != nil {
			return e
		}
		op, e := st.FileOperation(initial.ID, true)
		if e != nil {
			return e
		}
		if op == nil || op.FinishedAt != nil {
			return nil
		}
		if op.ExecutorEpoch == s.Epoch && op.Status != "outcome_unknown" && op.Status != "cancelled" && time.Now().Before(op.DeadlineAt) {
			return nil
		}
		for _, id := range intent.Helpers {
			helper, e := repo.CloudOperation(id, false)
			if e != nil {
				return e
			}
			if helper == nil {
				return integrity()
			}
			if helper.FinishedAt == nil {
				return nil
			}
			var observation workspaceOperationObservation
			if json.Unmarshal(helper.Observation, &observation) != nil {
				return integrity()
			}
			if observation.LocalStorageKey != "" {
				keys = append(keys, observation.LocalStorageKey)
			}
		}
		items, e := st.FileOperationItems(op.ID, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		for _, item := range items {
			if item.ArtifactID != nil {
				return integrity()
			}
			if item.StagedFileID != nil {
				file, e := st.File(*item.StagedFileID, true)
				if e != nil {
					return e
				}
				if file == nil || file.State == "bound" {
					return integrity()
				}
				file.State = "orphaned"
				file.OrphanedAt = &now
				file.ExpiresAt = &now
				file.UpdatedAt = now
				if e = st.SaveFile(file); e != nil {
					return e
				}
			}
		}
		op.ExecutorEpoch = s.Epoch
		op.FenceVersion++
		op.Status = "cancelled"
		op.UpdatedAt = now
		code := "FILE_OPERATION_INTERRUPTED"
		op.ErrorCode = &code
		if e = releaseFileTransferReferences(st, repo, op.ID, now); e != nil {
			return e
		}
		if e = st.SaveFileOperation(op); e != nil {
			return e
		}
		ready = true
		return nil
	})
	if e != nil {
		return e
	}
	if !ready {
		return nil
	}
	// A second transaction after deletion records byte absence. Failure leaves
	// a retryable orphan rather than claiming deletion happened before IO.
	for _, key := range keys {
		if e = s.Host.Files.Delete(key); e != nil {
			return e
		}
	}
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, _ CloudRepository) error {
		op, e := st.FileOperation(initial.ID, true)
		if e != nil {
			return e
		}
		if op == nil || op.Status != "cancelled" {
			return nil
		}
		items, e := st.FileOperationItems(op.ID, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		for _, item := range items {
			if item.StagedFileID == nil {
				continue
			}
			file, e := st.File(*item.StagedFileID, true)
			if e != nil {
				return e
			}
			if file != nil && file.State == "orphaned" {
				file.State = "deleted"
				file.DeletedAt = &now
				file.UpdatedAt = now
				if e = st.SaveFile(file); e != nil {
					return e
				}
			}
		}
		op.FinishedAt = &now
		op.UpdatedAt = now
		return st.SaveFileOperation(op)
	})
}
