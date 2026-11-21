package agents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/pmezard/go-difflib/difflib"
	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// readNumberedLines streams through the requested page. The encoded JSON
// budget accounts for escaped control characters as well as visible text.
func readNumberedLines(r io.Reader, offset int64, limit int) (string, bool, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 8192), int(workspace.MaxFileBytes)+1)
	var out strings.Builder
	used, count := 0, 0
	for n := int64(1); scanner.Scan(); n++ {
		line := scanner.Bytes()
		if !utf8.Valid(line) || bytes.IndexByte(line, 0) >= 0 {
			return "", false, nativeError("WORKSPACE_NOT_TEXT")
		}
		if n < offset {
			continue
		}
		if count >= limit {
			return out.String(), true, nil
		}
		snippet := utf8Prefix(string(line), 4000)
		if len(snippet) < len(line) {
			snippet += " … [line clipped]"
		}
		row := fmt.Sprintf("%d\t%s", n, snippet)
		encoded, _ := json.Marshal(row)
		if used+len(encoded)+2 > 52<<10 {
			return out.String(), true, nil
		}
		if count > 0 {
			out.WriteByte('\n')
		}
		used += len(encoded) + 2
		out.WriteString(row)
		count++
	}
	return out.String(), false, scanner.Err()
}

func nativeReadLines(ctx context.Context, a *SandboxAccess, f sandboxcore.Filesystem, name string, q workspace.Request) (any, error) {
	info, err := f.StatFile(ctx, a.Resource, name)
	if err != nil {
		return nil, err
	}
	if !nativeFile(info) || info.Size > workspace.MaxFileBytes {
		return nil, nativeError("WORKSPACE_SOURCE_INVALID")
	}
	r, err := a.Provider.OpenFile(ctx, a.Resource, sandboxcore.FileRequest{Path: name, MaxBytes: workspace.MaxFileBytes + 1})
	if err != nil {
		return nil, err
	}
	text, more, err := readNumberedLines(r, q.Offset, q.Limit)
	closeErr := r.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	after, err := f.StatFile(ctx, a.Resource, name)
	if err != nil {
		return nil, err
	}
	if nativeIdentity(after) != nativeIdentity(info) {
		return nil, nativeError("WORKSPACE_SOURCE_CHANGED")
	}
	return map[string]any{"path": q.Path, "text": text, "has_more": more}, nil
}

// An empty identity identifies an observed absent file. An existing empty file has an identity.
type textSnapshot struct {
	text     string
	identity string
	mode     int
}

func loadTextSnapshot(ctx context.Context, a *SandboxAccess, f sandboxcore.Filesystem, name string) (textSnapshot, error) {
	info, err := f.StatFile(ctx, a.Resource, name)
	if nativeMissing(err) {
		return textSnapshot{}, nil
	}
	if err != nil {
		return textSnapshot{}, err
	}
	if !nativeFile(info) || info.Size > workspace.MaxReadBytes {
		return textSnapshot{}, nativeError("WORKSPACE_TEXT_FILE_LIMIT")
	}
	data, err := readNativeFile(ctx, a, name, 0, 0, workspace.MaxReadBytes)
	if err != nil {
		return textSnapshot{}, err
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return textSnapshot{}, nativeError("WORKSPACE_NOT_TEXT")
	}
	return textSnapshot{text: string(data), identity: nativeIdentity(info), mode: info.Mode}, nil
}

func verifyTextSnapshot(ctx context.Context, a *SandboxAccess, f sandboxcore.Filesystem, name string, snapshot textSnapshot) error {
	info, err := f.StatFile(ctx, a.Resource, name)
	if nativeMissing(err) {
		if snapshot.identity == "" {
			return nil
		}
		return nativeError("WORKSPACE_SOURCE_CHANGED")
	}
	if err != nil {
		return err
	}
	if nativeIdentity(info) != snapshot.identity {
		return nativeError("WORKSPACE_SOURCE_CHANGED")
	}
	return nil
}

func textDiff(from, to, before, after string) string {
	if before == after {
		return ""
	}
	lines := func(s string) []string {
		if s == "" {
			return nil
		}
		parts := strings.SplitAfter(s, "\n")
		if parts[len(parts)-1] == "" {
			return parts[:len(parts)-1]
		}
		parts[len(parts)-1] += "\n\\ No newline at end of file\n"
		return parts
	}
	diff, _ := difflib.GetUnifiedDiffString(difflib.UnifiedDiff{A: lines(before), B: lines(after), FromFile: from, ToFile: to, Context: 3})
	return diff
}

func diffPreview(s string) string {
	const limit = 8000
	if len(s) <= limit {
		return s
	}
	return utf8Prefix(s, limit) + "\n… [diff clipped]"
}

type workspaceWriteResult struct {
	Path      string `json:"path"`
	Operation string `json:"operation"`
	Diff      string `json:"diff"`
}

func nativeChangeText(ctx context.Context, a *SandboxAccess, f sandboxcore.Filesystem, name string, q workspace.Request) (any, error) {
	old, err := loadTextSnapshot(ctx, a, f, name)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(q.Data)
	if err != nil || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return nil, nativeError("WORKSPACE_NOT_TEXT")
	}
	after := string(data)
	if q.Operation == "edit" {
		n := strings.Count(old.text, q.Pattern)
		if old.identity == "" || q.Pattern == "" || n == 0 {
			return nil, nativeError("WORKSPACE_EDIT_NO_MATCH")
		}
		if n > 1 && !q.ReplaceAll {
			return nil, nativeError("WORKSPACE_EDIT_NOT_UNIQUE")
		}
		if len(old.text)+n*(len(after)-len(q.Pattern)) > workspace.MaxReadBytes {
			return nil, nativeError("WORKSPACE_FILE_TOO_LARGE")
		}
		after = strings.ReplaceAll(old.text, q.Pattern, after)
	}
	if err = verifyTextSnapshot(ctx, a, f, name, old); err != nil {
		return nil, err
	}
	if old.identity == "" || after != old.text {
		err = f.PutFile(ctx, a.Resource, sandboxcore.FileRequest{Path: name, Mode: old.mode, MaxBytes: int64(max(1, len(after)))}, strings.NewReader(after))
		if err != nil {
			return nil, err
		}
	}
	if q.Operation == "write" {
		if old.identity == "" {
			return workspaceWriteResult{Path: name, Operation: "create"}, nil
		}
		return workspaceWriteResult{Path: name, Operation: "update", Diff: diffPreview(textDiff(name, name, old.text, after))}, nil
	}
	return map[string]any{"path": q.Path, "size_bytes": fmt.Sprint(len(after)), "diff": diffPreview(textDiff(name, name, old.text, after))}, nil
}
