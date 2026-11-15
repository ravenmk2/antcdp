package agents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func nativeFiles(access *SandboxAccess) (sandboxcore.Filesystem, error) {
	f, ok := access.Provider.(sandboxcore.Filesystem)
	if !ok {
		return nil, httpx.E(409, "SANDBOX_FILESYSTEM_UNSUPPORTED", "沙箱不支持文件系统接口")
	}
	return f, nil
}

// Record intent before native IO; uncertain writes are never replayed.
func (s *CloudService) workspaceRequest(ctx context.Context, access *SandboxAccess, id uint64, q workspace.Request) (workspace.Response, error) {
	return s.recordNativeRequest(ctx, access, id, q, func() (workspace.Response, error) { return runNativeRequest(ctx, access, q) })
}

func nativeReadOnly(q workspace.Request) bool {
	switch q.Operation {
	case "list", "read", "glob", "grep", "verify_native", "download":
		return true
	}
	return false
}

func (s *CloudService) recordNativeRequest(ctx context.Context, access *SandboxAccess, id uint64, q workspace.Request, run func() (workspace.Response, error)) (workspace.Response, error) {
	if access.WorkspaceOperationID != id || access.WorkspaceOperationFence == 0 {
		return workspace.Response{}, integrity()
	}
	ordinal := 0
	err := s.updateWorkspaceObservation(ctx, id, access.WorkspaceOperationFence, func(row *CloudOperationRow, o *workspaceOperationObservation) error {
		if row.Status == "outcome_unknown" || time.Now().After(row.DeadlineAt) {
			return httpx.E(409, "WORKSPACE_RECONCILING", "文件操作仍待核实")
		}
		for _, previous := range o.Executions {
			if previous.State != "completed" {
				return httpx.E(409, "WORKSPACE_RECONCILING", "前一次文件操作仍待核实")
			}
		}
		ordinal = len(o.Executions)
		if ordinal >= 100 {
			return httpx.E(422, "WORKSPACE_OPERATION_LIMIT", "文件操作数量超限")
		}
		o.Executions = append(o.Executions, workspaceExecution{Ordinal: ordinal, Request: q, State: "dispatching"})
		row.Status = "running"
		if row.StartedAt == nil {
			now := time.Now().UTC()
			row.StartedAt = &now
		}
		return nil
	})
	if err != nil {
		return workspace.Response{}, err
	}
	response, cause := run()
	unknown := cause != nil && !nativeReadOnly(q) && nativeUncertain(cause)

	if cause != nil {
		response = workspace.Response{Version: workspace.Version, Code: remoteSandboxError(cause)}
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	err = s.updateWorkspaceObservation(cleanup, id, access.WorkspaceOperationFence, func(row *CloudOperationRow, o *workspaceOperationObservation) error {
		if len(o.Executions) != ordinal+1 {
			return integrity()
		}
		if unknown {
			row.Status = "outcome_unknown"
			o.Executions[ordinal].State = "outcome_unknown"
		} else {
			o.Executions[ordinal].State = "completed"
			o.Executions[ordinal].Response = &response
		}
		return nil
	})
	if unknown || err != nil {
		_ = s.MarkReferencesUnknown(cleanup, access, "native_file_outcome_unknown", json.RawMessage(`{"physical_completion_verified":false}`))
		return response, httpx.E(409, "WORKSPACE_IO_OUTCOME_UNKNOWN", "文件操作结果尚未核实，请勿重复执行")
	}
	if cause != nil {
		return response, cause
	}
	if !response.OK {
		return response, workspaceFailure(response.Code)
	}
	return response, nil
}

func nativeUncertain(err error) bool {
	if err == nil {
		return false
	}
	var remote *sandboxcore.Error
	if errors.As(err, &remote) {
		return remote.Unknown
	}
	var local *httpx.Error
	return !errors.As(err, &local)
}

func nativeIdentity(info sandboxcore.FileInfo) string {
	raw, _ := json.Marshal(info)
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}
func nativeMissing(err error) bool {
	var remote *sandboxcore.Error
	return errors.As(err, &remote) && (remote.Code == "SANDBOX_FILE_NOT_FOUND" || remote.Code == "SANDBOX_REMOTE_NOT_FOUND")
}
func nativeError(code string) error {
	return httpx.E(409, code, "工作文件状态不符合本次操作要求")
}
func nativePath(relative string) (string, error) {
	name, err := workspace.PublicPath(relative, true)
	if err != nil {
		return "", nativeError("WORKSPACE_PATH_INVALID")
	}
	return path.Join("/data", name), nil
}
func nativeFile(info sandboxcore.FileInfo) bool { return info.Kind == "file" || info.Kind == "regular" }

func readNativeFile(ctx context.Context, a *SandboxAccess, name string, offset, length, limit int64) ([]byte, error) {
	r, err := a.Provider.OpenFile(ctx, a.Resource, sandboxcore.FileRequest{Path: name, Offset: offset, Length: length, MaxBytes: limit})
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	closeErr := r.Close()
	if err == nil {
		err = closeErr
	}
	if int64(len(data)) > limit {
		return nil, nativeError("WORKSPACE_FILE_TOO_LARGE")
	}
	return data, err
}

func runNativeRequest(ctx context.Context, a *SandboxAccess, q workspace.Request) (workspace.Response, error) {
	f, err := nativeFiles(a)
	if err != nil {
		return workspace.Response{}, err
	}
	name, err := nativePath(q.Path)
	if err != nil && q.Operation != "initialize" && q.Operation != "verify_native" {
		return workspace.Response{}, err
	}
	if q.Operation == "write" || q.Operation == "edit" || q.Operation == "mkdir" || q.Operation == "remove" {
		if name == "/data" || name == "/data/agents" || strings.HasPrefix(name, "/data/agents/") {
			return workspace.Response{}, nativeError("WORKSPACE_PATH_PROTECTED")
		}
	}
	var value any
	changed := false
	switch q.Operation {
	case "initialize":
		cwd := "/data/workspace"
		if q.ProjectID != "" {
			if !validNumericID(q.ProjectID) {
				return workspace.Response{}, integrity()
			}
			cwd = "/data/projects/" + q.ProjectID
		}
		err = f.MakeDirectory(ctx, a.Resource, cwd, 755)
		changed = err == nil
		if err == nil && q.AgentID != "" {
			if !validNumericID(q.AgentID) {
				return workspace.Response{}, integrity()
			}
			err = f.MakeDirectory(ctx, a.Resource, "/data/agents/"+q.AgentID+"/skills", 755)
		}
		value = map[string]any{"cwd": cwd}
	case "verify_native":
		err = a.Provider.Health(ctx, &a.Resource)
		if err == nil {
			_, err = f.ListFiles(ctx, a.Resource, "/data")
		}
		value = map[string]any{"filesystem": "native", "version": 1}
	case "list":
		entries := []workspace.Entry{}
		values, e := f.ListFiles(ctx, a.Resource, name)
		err = e
		for _, v := range values {
			relative, ok := nativeRelative(v.Path)
			if !ok || path.Dir(v.Path) != name || v.Path == name {
				continue
			}
			entries = append(entries, workspace.Entry{Name: path.Base(v.Path), Path: relative, Kind: v.Kind, Size: v.Size, ModifiedAt: v.ModifiedAt.Format(time.RFC3339Nano), Identity: nativeIdentity(v)})
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
		start := min(max(0, int(q.Offset)), len(entries))
		end := min(start+max(1, q.Limit), len(entries))
		value = map[string]any{"entries": entries[start:end], "total": len(entries), "has_more": end < len(entries)}
	case "read":
		info, e := f.StatFile(ctx, a.Resource, name)
		if e != nil {
			err = e
			break
		}
		if !nativeFile(info) {
			err = nativeError("WORKSPACE_NOT_REGULAR_FILE")
			break
		}
		length := min(max(0, info.Size-q.Offset), int64(q.Limit))
		data := []byte{}
		if length > 0 {
			data, err = readNativeFile(ctx, a, name, q.Offset, length, workspace.MaxReadBytes)
		}
		if err == nil {
			after, e := f.StatFile(ctx, a.Resource, name)
			err = e
			if err == nil && nativeIdentity(after) != nativeIdentity(info) {
				err = nativeError("WORKSPACE_SOURCE_CHANGED")
			}
		}
		value = map[string]any{"path": q.Path, "data_base64": base64.StdEncoding.EncodeToString(data), "offset": q.Offset, "next_offset": q.Offset + int64(len(data)), "size_bytes": fmt.Sprint(info.Size), "has_more": q.Offset+int64(len(data)) < info.Size, "identity": nativeIdentity(info)}
	case "write", "edit":
		var data []byte
		data, err = base64.StdEncoding.DecodeString(q.Data)
		if err != nil {
			return workspace.Response{}, nativeError("WORKSPACE_CONTENT_INVALID")
		}
		info, statErr := f.StatFile(ctx, a.Resource, name)
		if statErr != nil && !nativeMissing(statErr) {
			err = statErr
			break
		}
		if statErr == nil && !nativeFile(info) {
			err = nativeError("WORKSPACE_NOT_REGULAR_FILE")
			break
		}
		if q.Identity != "" && (statErr != nil || q.Identity != nativeIdentity(info)) {
			err = nativeError("WORKSPACE_SOURCE_CHANGED")
			break
		}
		if q.Operation == "edit" {
			if statErr != nil {
				err = statErr
				break
			}
			var old []byte
			old, err = readNativeFile(ctx, a, name, 0, 0, workspace.MaxReadBytes)
			if err != nil {
				break
			}
			if !utf8.Valid(old) || q.Pattern == "" || bytes.Count(old, []byte(q.Pattern)) != 1 {
				err = nativeError("WORKSPACE_EDIT_NOT_UNIQUE")
				break
			}
			data = bytes.Replace(old, []byte(q.Pattern), data, 1)
			// Check immediately before upload. The provider does not promise CAS.
			after, e := f.StatFile(ctx, a.Resource, name)
			if e != nil {
				err = e
				break
			}
			if nativeIdentity(after) != nativeIdentity(info) {
				err = nativeError("WORKSPACE_SOURCE_CHANGED")
				break
			}
		} else if !q.Overwrite && statErr == nil {
			err = nativeError("WORKSPACE_PATH_EXISTS")
			break
		}
		if len(data) > workspace.MaxReadBytes {
			err = nativeError("WORKSPACE_FILE_TOO_LARGE")
			break
		}
		err = f.PutFile(ctx, a.Resource, sandboxcore.FileRequest{Path: name, MaxBytes: int64(max(1, len(data)))}, bytes.NewReader(data))
		changed = err == nil
		h := sha256.Sum256(data)
		value = map[string]any{"path": q.Path, "size_bytes": fmt.Sprint(len(data)), "sha256": hex.EncodeToString(h[:])}
	case "mkdir":
		err = f.MakeDirectory(ctx, a.Resource, name, 755)
		changed = err == nil
		value = map[string]any{"path": q.Path}
	case "remove":
		info, e := f.StatFile(ctx, a.Resource, name)
		if e != nil {
			err = e
			break
		}
		if q.Identity != "" && nativeIdentity(info) != q.Identity {
			err = nativeError("WORKSPACE_ENTRY_CHANGED")
			break
		}
		if info.Kind == "directory" && !q.Recursive {
			children, e := f.ListFiles(ctx, a.Resource, name)
			if e != nil {
				err = e
				break
			}
			if len(children) > 0 {
				err = nativeError("WORKSPACE_DIRECTORY_NOT_EMPTY")
				break
			}
		}
		err = f.RemoveFile(ctx, a.Resource, name, info.Kind == "directory")
		changed = err == nil
		value = map[string]any{"path": q.Path}
	case "glob", "grep":
		value, err = nativeSearch(ctx, a, f, name, q)
	default:
		err = nativeError("WORKSPACE_OPERATION_UNSUPPORTED")
	}
	if err != nil {
		return workspace.Response{}, err
	}
	return workspace.Result(value, changed, nil), nil
}

func validNumericID(v string) bool {
	if v == "" {
		return false
	}
	for _, r := range v {
		if r < '0' || r > '9' {
			return false
		}
	}
	return v[0] != '0'
}
func nativeRelative(name string) (string, bool) {
	relative, ok := strings.CutPrefix(name, "/data/")
	if !ok {
		return "", false
	}
	_, err := workspace.PublicPath(relative, false)
	return relative, err == nil
}

// Content search is bounded and uses native file reads, so even a minimal image
// needs no grep/python/helper binary. Filename search stays provider-side.
func nativeSearch(ctx context.Context, a *SandboxAccess, f sandboxcore.Filesystem, name string, q workspace.Request) (any, error) {
	pattern := q.Pattern
	if q.Operation == "grep" {
		pattern = "**"
	}
	entries, err := f.SearchFiles(ctx, a.Resource, name, pattern)
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	limit = min(limit, 200)
	paths := []string{}
	matches := []workspace.Match{}
	visited := 0
	truncated := false
	budget := int64(8 << 20)
	var expression *regexp.Regexp
	if q.Operation == "grep" {
		expressionText := q.Pattern
		if q.Literal {
			expressionText = regexp.QuoteMeta(expressionText)
		}
		if q.CaseFold {
			expressionText = "(?i)" + expressionText
		}
		expression, err = regexp.Compile(expressionText)
		if err != nil {
			return nil, nativeError("WORKSPACE_PATTERN_INVALID")
		}
	}
	for _, entry := range entries {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		visited++
		if visited > workspace.MaxWalkEntries {
			truncated = true
			break
		}
		relative, ok := nativeRelative(entry.Path)
		if !ok || entry.Path != name && !strings.HasPrefix(entry.Path, name+"/") {
			continue
		}
		if q.Operation == "glob" {
			paths = append(paths, relative)
			if len(paths) >= limit {
				truncated = visited < len(entries)
				break
			}
			continue
		}
		if !nativeFile(entry) {
			continue
		}
		if entry.Size > workspace.MaxReadBytes {
			truncated = true
			continue
		}
		if entry.Size > budget {
			truncated = true
			break
		}
		budget -= entry.Size
		data, e := readNativeFile(ctx, a, entry.Path, 0, 0, workspace.MaxReadBytes)
		if e != nil {
			return nil, e
		}
		if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			continue
		}
		for line, text := range strings.Split(string(data), "\n") {
			if expression.MatchString(text) {
				matches = append(matches, workspace.Match{Path: relative, Line: line + 1, Text: utf8Prefix(text, 2048)})
				if len(matches) >= limit {
					truncated = true
					break
				}
			}
		}
		if len(matches) >= limit {
			break
		}
	}
	return map[string]any{"paths": paths, "matches": matches, "truncated": truncated, "visited_entries": visited}, nil
}
