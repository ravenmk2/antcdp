package agents

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

const WorkspaceUploadMaxBytes = 32 << 20

func WorkspaceUploadTooLarge() *httpx.Error {
	return httpx.E(413, "UPLOAD_TOO_LARGE", "单个文件不能超过 32 MiB")
}

type workspaceUploadResult struct {
	Path string `json:"path"`
	Size string `json:"size_bytes"`
}

func (s *CloudService) UploadWorkspaceFile(ctx context.Context, raw string, id uint64, directory, filename string, source io.Reader) (*Result, error) {
	directory, err := workspacePath(directory, true)
	if err != nil {
		return nil, err
	}
	if _, err = workspace.PublicPath(filename, false); err != nil || path.Base(filename) != filename {
		return nil, httpx.Invalid("file", "invalid_filename")
	}
	target, err := workspacePath(path.Join(directory, filename), false)
	if err != nil {
		return nil, err
	}

	var access *SandboxAccess
	var connection CloudConnection
	var op *CloudOperationRow
	out, err := s.cloudAccess(ctx, raw, false, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository, auth *identity.Auth, _ *Result) error {
		computer, e := repo.Computer(id, true)
		if e != nil {
			return e
		}
		if e = workspaceContentAccess(computer, auth); e != nil {
			return e
		}
		access, connection, e = s.accessRows(repo, id, nil)
		if e != nil {
			return e
		}
		if e = maintenanceBusy(repo, id); e != nil {
			return e
		}
		op, e = s.startWorkspaceOperation(st, repo, access, "workspace_upload", "user", idString(auth.User.ID), workspaceFileIntent{Path: target, WorkspaceFence: computer.FenceVersion})
		if e != nil {
			return e
		}
		computer.RowVersion++
		computer.UpdatedAt = op.CreatedAt
		return repo.SaveComputer(computer)
	})
	if err != nil {
		return out, err
	}

	bounded, cancel := context.WithDeadline(ctx, op.DeadlineAt)
	defer cancel()
	result, cause := s.writeWorkspaceUpload(bounded, op, access, connection, target, source)
	settled := s.finishWorkspaceOperation(ctx, op.ID, access, result, cause)
	if cause != nil {
		return out, cause
	}
	if settled != nil {
		return out, httpx.E(409, "WORKSPACE_IO_OUTCOME_UNKNOWN", "上传结果尚未核实，请检查目录")
	}
	out.Status, out.Data = http.StatusCreated, result
	return out, nil
}

func (s *CloudService) writeWorkspaceUpload(ctx context.Context, op *CloudOperationRow, access *SandboxAccess, connection CloudConnection, target string, source io.Reader) (*workspaceUploadResult, error) {
	provider, err := s.openProvider(ctx, connection)
	if err != nil {
		return nil, err
	}
	access.Provider = provider
	files, err := nativeFiles(access)
	if err != nil {
		return nil, err
	}
	const stagingDir = "/data/.system"
	info, err := files.StatFile(ctx, access.Resource, stagingDir)
	if nativeMissing(err) {
		err = files.MakeDirectory(ctx, access.Resource, stagingDir, 700)
	} else if err == nil && info.Kind != "directory" {
		return nil, unavailable()
	}
	if err != nil {
		return nil, workspaceUploadRemoteError(err)
	}
	staging := stagingDir + "/upload-" + op.OperationToken
	published := false
	defer func() {
		if !published {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			_ = files.RemoveFile(cleanup, access.Resource, staging, false)
		}
	}()

	reader := &workspaceUploadReader{source: io.LimitedReader{R: source, N: WorkspaceUploadMaxBytes + 1}}
	err = files.PutFile(ctx, access.Resource, sandboxcore.FileRequest{Path: staging, MaxBytes: WorkspaceUploadMaxBytes + 1}, reader)
	read := reader.result.Load()
	if read != nil && read.err != io.EOF {
		return nil, read.err
	}
	if err != nil {
		return nil, workspaceUploadRemoteError(err)
	}
	if read == nil {
		return nil, httpx.E(502, "WORKSPACE_UPLOAD_INCOMPLETE", "云电脑未接收完整文件")
	}
	if err = checkWorkspaceUploadTarget(ctx, files, access.Resource, target); err != nil {
		return nil, err
	}
	result := &workspaceUploadResult{Path: target, Size: strconv.FormatInt(read.size, 10)}
	_, err = s.recordNativeRequest(ctx, access, op.ID, workspace.Request{Operation: "upload", Path: target}, func() (workspace.Response, error) {
		if e := files.MoveFile(ctx, access.Resource, staging, "/data/"+target); e != nil {
			return workspace.Response{}, e
		}
		published = true
		return workspace.Result(result, true, nil), nil
	})
	if err != nil {
		// An uncertain move may still be using the staging file.
		published = published || workspaceUnknown(err)
		return nil, workspaceUploadRemoteError(err)
	}
	return result, nil
}

func checkWorkspaceUploadTarget(ctx context.Context, files sandboxcore.Filesystem, ref sandboxcore.ResourceRef, target string) error {
	segments := strings.Split(target, "/")
	directory := "/data"
	for _, segment := range segments[:len(segments)-1] {
		directory += "/" + segment
		item, err := files.StatFile(ctx, ref, directory)
		if nativeMissing(err) || err == nil && item.Kind != "directory" {
			return httpx.E(409, "WORKSPACE_UPLOAD_DIRECTORY_UNAVAILABLE", "目标目录已变化，请刷新后重试")
		}
		if err != nil {
			return workspaceUploadRemoteError(err)
		}
	}
	_, err := files.StatFile(ctx, ref, "/data/"+target)
	if err == nil {
		return httpx.E(409, "WORKSPACE_PATH_EXISTS", "当前目录已有同名文件或目录")
	}
	if nativeMissing(err) {
		return nil
	}
	return workspaceUploadRemoteError(err)
}

func workspaceUploadRemoteError(err error) error {
	var failure *httpx.Error
	if errors.As(err, &failure) {
		return err
	}
	return httpx.E(502, remoteSandboxError(err), "云电脑暂时无法接收文件，请重试")
}

type workspaceUploadReader struct {
	source io.LimitedReader
	result atomic.Pointer[workspaceUploadRead]
}

type workspaceUploadRead struct {
	size int64
	err  error
}

// The provider can consume the body on a separate goroutine and return its
// own error. Save the terminal read result so size/form errors survive that.
func (r *workspaceUploadReader) Read(p []byte) (int, error) {
	n, err := r.source.Read(p)
	var limit *http.MaxBytesError
	switch {
	case r.source.N == 0 || errors.As(err, &limit):
		err = WorkspaceUploadTooLarge()
	case err != nil && err != io.EOF:
		err = httpx.Invalid("body", "unexpected_or_invalid_part")
	}
	if err != nil {
		r.result.Store(&workspaceUploadRead{size: WorkspaceUploadMaxBytes + 1 - r.source.N, err: err})
	}
	return n, err
}
