package agents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	case "list", "read", "glob", "grep", "verify_native", "download", "directory_exists":
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

func protectedNativePath(name string) bool {
	return name == "/data" || name == "/data/agents" || strings.HasPrefix(name, "/data/agents/")
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
		if protectedNativePath(name) {
			return workspace.Response{}, nativeError("WORKSPACE_PATH_PROTECTED")
		}
	}
	var value any
	changed := false
	switch q.Operation {
	case "initialize":
		cwd := name
		if !workspace.ValidCWD(cwd) || q.AgentID != "" && !validNumericID(q.AgentID) {
			return workspace.Response{}, integrity()
		}
		err = f.MakeDirectory(ctx, a.Resource, cwd, 755)
		changed = err == nil
		if err == nil && q.AgentID != "" {
			err = f.MakeDirectory(ctx, a.Resource, "/data/agents/"+q.AgentID+"/skills", 755)
		}
		value = map[string]any{"cwd": cwd}
	case "directory_exists", "ensure_home":
		if name != "/data/home" {
			return workspace.Response{}, integrity()
		}
		exists, checkErr := nativeHomeExists(ctx, f, a.Resource)
		if checkErr != nil {
			return workspace.Response{}, checkErr
		}
		if !exists && q.Operation == "ensure_home" {
			err = f.MakeDirectory(ctx, a.Resource, name, 755)
			changed = err == nil
		}
		value = map[string]any{"exists": exists || changed}
	case "verify_native":
		err = a.Provider.Health(ctx, &a.Resource)
		if err == nil {
			_, err = f.ListFiles(ctx, a.Resource, "/data")
		}
		value = map[string]any{"filesystem": "native", "version": 1}
	case "list":
		value, err = listNativeDirectory(ctx, f, a.Resource, name, int(q.Offset), q.Limit)
	case "read":
		value, err = nativeReadLines(ctx, a, f, name, q)
	case "write", "edit":
		value, err = nativeChangeText(ctx, a, f, name, q)
		changed = err == nil
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

func nativeHomeExists(ctx context.Context, files sandboxcore.Filesystem, ref sandboxcore.ResourceRef) (bool, error) {
	info, err := files.StatFile(ctx, ref, "/data/home")
	if nativeMissing(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.Kind != "directory" {
		return false, httpx.E(409, "WORKSPACE_NOT_DIRECTORY", "/data/home 已被非目录文件占用")
	}
	return true, nil
}

type nativeDirectoryPage struct {
	Entries []workspace.Entry `json:"entries"`
	Total   int               `json:"total"`
	HasMore bool              `json:"has_more"`
}

func listNativeDirectory(ctx context.Context, files sandboxcore.Filesystem, ref sandboxcore.ResourceRef, name string, offset, limit int) (nativeDirectoryPage, error) {
	values, err := files.ListFiles(ctx, ref, name)
	if err != nil {
		return nativeDirectoryPage{}, err
	}
	entries := []workspace.Entry{}
	for _, v := range values {
		relative, ok := nativeRelative(v.Path)
		if !ok || path.Dir(v.Path) != name || v.Path == name {
			continue
		}
		entries = append(entries, workspace.Entry{Name: path.Base(v.Path), Path: relative, Kind: v.Kind, Size: v.Size, ModifiedAt: v.ModifiedAt.Format(time.RFC3339Nano), Identity: nativeIdentity(v)})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	start := min(max(0, offset), len(entries))
	end := min(start+max(1, limit), len(entries))
	return nativeDirectoryPage{Entries: entries[start:end], Total: len(entries), HasMore: end < len(entries)}, nil
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
	maxResults := 200
	if q.Operation == "grep" {
		maxResults = 250
		pattern = q.Include
		if pattern == "" {
			pattern = "**"
		}
	}
	limit := q.Limit
	if limit == 0 {
		limit = min(maxResults, 100)
		if q.Operation == "grep" {
			limit = maxResults
		}
	}
	limit = min(limit, maxResults)
	var expression *regexp.Regexp
	var err error
	if q.Operation == "grep" {
		text := q.Pattern
		if q.Literal {
			text = regexp.QuoteMeta(text)
		}
		if q.CaseFold {
			text = "(?i)" + text
		}
		expression, err = regexp.Compile(text)
		if err != nil {
			return nil, nativeError("WORKSPACE_PATTERN_INVALID")
		}
	}
	entries, err := f.SearchFiles(ctx, a.Resource, name, pattern)
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool {
		if q.Operation == "glob" && !entries[i].ModifiedAt.Equal(entries[j].ModifiedAt) {
			return entries[i].ModifiedAt.After(entries[j].ModifiedAt)
		}
		return entries[i].Path < entries[j].Path
	})
	paths := []string{}
	groups := []workspace.MatchGroup{}
	matchCount := 0
	skipped, visited := 0, 0
	stop := ""
	budget := int64(8 << 20)
search:
	for _, entry := range entries {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if visited == workspace.MaxWalkEntries {
			stop = "scan_limit"
			break
		}
		visited++
		relative, ok := nativeRelative(entry.Path)
		if !ok || (entry.Path != name && !strings.HasPrefix(entry.Path, name+"/")) || !nativeFile(entry) {
			continue
		}
		if q.Operation == "glob" {
			paths = append(paths, relative)
			continue
		}
		if entry.Size > 8<<20 {
			skipped++
			continue
		}
		if entry.Size > budget {
			stop = "byte_budget"
			break
		}
		data, e := readNativeFile(ctx, a, entry.Path, 0, 0, max(1, entry.Size))
		if e != nil {
			return nil, e
		}
		budget -= int64(len(data))
		if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			continue
		}
		line := 0
		for row := range strings.Lines(string(data)) {
			line++
			row = strings.TrimSuffix(strings.TrimSuffix(row, "\n"), "\r")
			if expression.MatchString(row) {
				if matchCount == limit {
					stop = "result_limit"
					break search
				}
				if len(groups) == 0 || groups[len(groups)-1].Path != relative {
					groups = append(groups, workspace.MatchGroup{Path: relative})
				}
				group := &groups[len(groups)-1]
				group.Lines = append(group.Lines, workspace.Match{Line: line, Text: utf8Prefix(row, 2048)})
				matchCount++
			}
		}
	}
	if len(paths) > limit {
		paths = sampleGlobPaths(paths, strings.TrimPrefix(name, "/data/"), limit)
		if stop == "" {
			stop = "result_limit"
		}
	}
	return map[string]any{"paths": paths, "groups": groups, "truncated": stop != "" || skipped > 0, "visited_entries": visited, "skipped_large_files": skipped, "stop_reason": stop}, nil
}

// Keep the newest result from each top-level entry before filling remaining
// slots in modification-time order. The returned page retains that order.
func sampleGlobPaths(paths []string, root string, limit int) []string {
	if root == "/data" {
		root = ""
	} else {
		root += "/"
	}
	groups := map[string]bool{}
	selected := make([]bool, len(paths))
	count := 0
	for i, name := range paths {
		group, _, _ := strings.Cut(strings.TrimPrefix(name, root), "/")
		if !groups[group] && count < limit {
			groups[group] = true
			selected[i] = true
			count++
		}
	}
	page := make([]string, 0, limit)
	for i, name := range paths {
		if !selected[i] && count < limit {
			selected[i] = true
			count++
		}
		if selected[i] {
			page = append(page, name)
		}
	}
	return page
}
