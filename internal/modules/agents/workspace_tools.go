package agents

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type workspaceToolInput struct {
	Path          string `json:"path"`
	Offset        int64  `json:"offset"`
	Limit         int    `json:"limit"`
	Content       string `json:"content"`
	Overwrite     bool   `json:"overwrite"`
	Identity      string `json:"identity"`
	OldText       string `json:"old_text"`
	NewText       string `json:"new_text"`
	Pattern       string `json:"pattern"`
	Literal       bool   `json:"literal"`
	CaseSensitive bool   `json:"case_sensitive"`
}

// Both modes expose the same /data namespace. Relative names always start at
// the current session CWD; callers cannot pass hidden helper generations.
func workspaceToolPath(cwd, raw string) (string, error) {
	if raw == "/data" || raw == "/data/" {
		return ".", nil
	}
	if strings.HasPrefix(raw, "/data/") {
		return workspacePath(strings.TrimPrefix(raw, "/data/"), true)
	}
	if raw == "" || raw == "." {
		base, ok := strings.CutPrefix(cwd, "/data/")
		if !ok {
			return "", integrity()
		}
		return workspacePath(base, false)
	}
	return fileCWDPath(cwd, raw)
}

func workspaceToolRequest(key string, raw json.RawMessage) (workspaceToolInput, workspacefs.Request, error) {
	var input workspaceToolInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > 46<<10 || d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF {
		return input, workspacefs.Request{}, httpx.Invalid("arguments", "invalid_format")
	}
	q := workspacefs.Request{Path: input.Path}
	switch key {
	case "read_file":
		if input.Path == "" || input.Offset < 0 || input.Limit < 0 || input.Limit > 32768 {
			return input, q, httpx.Invalid("arguments", "out_of_range")
		}
		q.Operation, q.Offset, q.Limit = "read", input.Offset, input.Limit
		if q.Limit == 0 {
			q.Limit = 16384
		}
	case "write_file":
		if input.Path == "" || !utf8.ValidString(input.Content) || len(input.Content) > workspacefs.MaxWriteBytes || input.Identity != "" && len(input.Identity) != 64 {
			return input, q, httpx.Invalid("arguments", "invalid_content")
		}
		q.Operation, q.Data, q.Overwrite, q.Identity = "write", base64.StdEncoding.EncodeToString([]byte(input.Content)), input.Overwrite, input.Identity
	case "edit_file":
		if input.Path == "" || input.OldText == "" || len(input.OldText) > 8192 || len(input.NewText) > 16384 {
			return input, q, httpx.Invalid("arguments", "invalid_content")
		}
		q.Operation, q.Pattern, q.Data = "edit", input.OldText, base64.StdEncoding.EncodeToString([]byte(input.NewText))
	case "glob", "grep":
		if input.Pattern == "" || len(input.Pattern) > 1024 || input.Limit < 0 || input.Limit > 200 {
			return input, q, httpx.Invalid("arguments", "out_of_range")
		}
		q.Operation, q.Pattern, q.Limit, q.Literal, q.CaseFold = key, input.Pattern, input.Limit, input.Literal, !input.CaseSensitive
	default:
		return input, q, httpx.Invalid("tool_key", "unsupported")
	}
	if _, err := workspacefs.Encode(q); err != nil {
		return input, q, httpx.Invalid("arguments", "encoded_content_too_large")
	}
	return input, q, nil
}

func (s *CloudService) FileTool(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, key string, arguments json.RawMessage) (observation agentcore.DispatchObservation, err error) {
	input, q, err := workspaceToolRequest(key, arguments)
	if err != nil {
		return observation, err
	}
	var access *SandboxAccess
	var connection CloudConnection
	var operation *CloudOperationRow
	err = s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		call, e := commandTool(st, ref, callID, key)
		if e != nil {
			return e
		}
		if e = currentCommandPermission(r, st, x.Agent.ID, call); e != nil {
			return e
		}
		prepared, e := preparedCall(st, ref, call)
		if e != nil {
			return e
		}
		if !semanticSame(json.RawMessage(prepared.Call.Arguments), arguments) {
			return integrity()
		}
		binding, e := repo.Lease(x.Root.ID, false)
		if e != nil {
			return e
		}
		if binding == nil || binding.ComputerID == 0 {
			return httpx.E(409, "SANDBOX_NOT_READY", "沙箱尚未就绪")
		}
		access, connection, e = s.accessRows(repo, binding.ComputerID, binding)
		if e != nil {
			return e
		}
		access.CWD = x.Context.Row.CWD
		access.Execution = &ref
		q.Path, e = workspaceToolPath(access.CWD, input.Path)
		if e != nil {
			return e
		}
		token := s.Host.ETag("workspace-tool/" + idString(callID))[:32]
		operation, e = s.startWorkspaceOperation(st, repo, access, "workspace_tool", "system", idString(callID), map[string]any{"tool_call_id": idString(callID), "tool_key": key, "request": q}, token)
		if e != nil {
			return e
		}
		// A previously dispatched operation is inspected by the reconciler. It
		// must not be run again, even when a tool-result commit was lost.
		var recorded workspaceOperationObservation
		if json.Unmarshal(operation.Observation, &recorded) != nil {
			return integrity()
		}
		if operation.Status != "running" || len(recorded.Executions) > 0 {
			return httpx.E(409, "WORKSPACE_OPERATION_EXISTS", "文件操作已有执行记录，请核实结果")
		}
		return nil
	})
	if err != nil {
		return observation, err
	}
	ctx, cancel := context.WithDeadline(ctx, operation.DeadlineAt)
	defer cancel()
	defer func() {
		if e := s.finishWorkspaceOperation(ctx, operation.ID, access, nil, err); err == nil {
			err = e
		}
	}()
	access.Provider, err = s.openProvider(ctx, connection)
	if err != nil {
		return observation, err
	}
	response, err := s.workspaceHelper(ctx, access, operation.ID, q)
	if err != nil {
		if response.Version == workspacefs.Version && !workspaceUnknown(err) {
			yes := true
			observation = agentcore.DispatchObservation{Status: "failed", Executed: &yes, Reason: response.Code, Content: "The file helper completed with error: " + response.Code}
		}
		return observation, err
	}
	content, err := workspaceToolContent(key, response.Result)
	if err != nil {
		yes := true
		reason := "WORKSPACE_RESULT_INVALID"
		var failure *httpx.Error
		if errors.As(err, &failure) {
			reason = failure.Code
		}
		observation = agentcore.DispatchObservation{Status: "failed", Executed: &yes, Reason: reason, Content: "The file helper completed but its result could not be used: " + reason}
		return observation, err
	}
	yes := true
	return agentcore.DispatchObservation{Status: "succeeded", Executed: &yes, Content: content}, nil
}

func workspaceToolContent(key string, raw json.RawMessage) (string, error) {
	if key == "read_file" {
		var result struct {
			Path     string `json:"path"`
			Data     string `json:"data_base64"`
			Offset   int64  `json:"offset"`
			Next     int64  `json:"next_offset"`
			Size     string `json:"size_bytes"`
			More     bool   `json:"has_more"`
			Identity string `json:"identity"`
		}
		if json.Unmarshal(raw, &result) != nil {
			return "", integrity()
		}
		data, err := base64.StdEncoding.DecodeString(result.Data)
		if err != nil {
			return "", integrity()
		}
		for cut := 0; !utf8.Valid(data) && cut < 3 && result.More && len(data) > 0; cut++ {
			data = data[:len(data)-1]
		}
		if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return "", httpx.E(422, "WORKSPACE_NOT_TEXT", "文件不是 UTF-8 文本，请使用对应读取工具")
		}
		encode := func(value []byte) ([]byte, error) {
			return json.Marshal(map[string]any{"path": "/data/" + result.Path, "text": string(value), "offset": result.Offset, "next_offset": result.Offset + int64(len(value)), "size_bytes": result.Size, "has_more": result.More || result.Offset+int64(len(value)) < result.Next, "identity": result.Identity})
		}
		out, err := encode(data)
		if err != nil {
			return "", err
		}
		if len(out) <= 60<<10 {
			return string(out), nil
		}
		low, high := 0, len(data)
		for low < high {
			mid := low + (high-low+1)/2
			prefix := utf8Prefix(string(data), mid)
			candidate, e := encode([]byte(prefix))
			if e != nil {
				return "", e
			}
			if len(candidate) <= 60<<10 {
				low = mid
				out = candidate
			} else {
				high = mid - 1
			}
		}
		return string(out), nil
	}
	if key == "glob" || key == "grep" {
		var result struct {
			Paths     []string            `json:"paths"`
			Matches   []workspacefs.Match `json:"matches"`
			Truncated bool                `json:"truncated"`
			Visited   int                 `json:"visited_entries"`
		}
		if json.Unmarshal(raw, &result) != nil {
			return "", integrity()
		}
		for i := range result.Paths {
			result.Paths[i] = "/data/" + result.Paths[i]
		}
		for i := range result.Matches {
			result.Matches[i].Path = "/data/" + result.Matches[i].Path
		}
		for {
			out, err := json.Marshal(result)
			if err != nil {
				return "", err
			}
			if len(out) <= 60<<10 {
				return string(out), nil
			}
			result.Truncated = true
			if len(result.Matches) > 0 {
				result.Matches = result.Matches[:len(result.Matches)-1]
			} else if len(result.Paths) > 0 {
				result.Paths = result.Paths[:len(result.Paths)-1]
			} else {
				return "", integrity()
			}
		}
	}
	if len(raw) > 60<<10 || !json.Valid(raw) {
		return "", errors.New("workspace tool result invalid")
	}
	var result map[string]json.RawMessage
	if json.Unmarshal(raw, &result) != nil {
		return "", integrity()
	}
	if value, ok := result["path"]; ok {
		var name string
		if json.Unmarshal(value, &name) != nil {
			return "", integrity()
		}
		result["path"], _ = json.Marshal("/data/" + name)
	}
	encoded, err := json.Marshal(result)
	return string(encoded), err
}
