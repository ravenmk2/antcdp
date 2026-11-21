package agents

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type workspaceToolInput struct {
	FilePath      string `json:"file_path"`
	OldString     string `json:"old_string"`
	NewString     string `json:"new_string"`
	ReplaceAll    bool   `json:"replace_all"`
	Include       string `json:"include"`
	Path          string `json:"path"`
	Offset        int64  `json:"offset"`
	Limit         int    `json:"limit"`
	Content       string `json:"content"`
	Pattern       string `json:"pattern"`
	Literal       bool   `json:"literal"`
	CaseSensitive *bool  `json:"case_sensitive"`
}

// Both modes expose the same /data namespace. Relative names always start at
// the current session CWD; callers cannot pass private platform state.
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

func workspaceToolRequest(key string, raw json.RawMessage) (workspaceToolInput, workspace.Request, error) {
	var input workspaceToolInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > 46<<10 || d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF {
		return input, workspace.Request{}, httpx.Invalid("arguments", "invalid_format")
	}
	q := workspace.Request{Path: input.Path}
	switch key {
	case "read", "write", "edit":
		if input.FilePath == "" {
			return input, q, httpx.Invalid("file_path", "required")
		}
		input.Path, q.Path = input.FilePath, input.FilePath
		switch key {
		case "read":
			if input.Offset < 0 || input.Offset > 100000000 || input.Limit < 0 || input.Limit > 2000 {
				return input, q, httpx.Invalid("range", "invalid")
			}
			q.Operation, q.Offset, q.Limit = "read", max(1, input.Offset), input.Limit
			if q.Limit == 0 {
				q.Limit = 2000
			}
		case "write":
			if len(input.Content) > workspace.MaxWriteBytes {
				return input, q, httpx.Invalid("content", "too_large")
			}
			q.Operation, q.Data = "write", base64.StdEncoding.EncodeToString([]byte(input.Content))
		case "edit":
			if input.OldString == "" || input.OldString == input.NewString || len(input.OldString) > 8192 || len(input.NewString) > 16384 {
				return input, q, httpx.Invalid("old_string", "invalid_replacement")
			}
			q.Operation, q.Pattern, q.Data, q.ReplaceAll = "edit", input.OldString, base64.StdEncoding.EncodeToString([]byte(input.NewString)), input.ReplaceAll
		}
	case "glob", "grep":
		if input.Pattern == "" || len(input.Pattern) > 1024 || input.Limit < 0 || input.Limit > 250 || key == "glob" && input.Limit > 200 {
			return input, q, httpx.Invalid("arguments", "out_of_range")
		}
		q.Include = input.Include
		q.Operation, q.Pattern, q.Limit, q.Literal, q.CaseFold = key, input.Pattern, input.Limit, input.Literal, input.CaseSensitive != nil && !*input.CaseSensitive
	default:
		return input, q, httpx.Invalid("tool_key", "unsupported")
	}
	if encoded, err := json.Marshal(q); err != nil || len(encoded) > workspace.MaxRequestBytes {
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
		return e
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
	response, err := s.workspaceRequest(ctx, access, operation.ID, q)
	if err != nil {
		if response.Version == workspace.Version && !workspaceUnknown(err) {
			yes := true
			observation = agentcore.DispatchObservation{Status: "failed", Executed: &yes, Reason: response.Code, Content: "The file operation completed with error: " + response.Code}
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
		observation = agentcore.DispatchObservation{Status: "failed", Executed: &yes, Reason: reason, Content: "The file operation completed but its result could not be used: " + reason}
		return observation, err
	}
	yes := true
	return agentcore.DispatchObservation{Status: "succeeded", Executed: &yes, Content: content}, nil
}

func workspaceToolContent(key string, raw json.RawMessage) (string, error) {
	if key == "glob" || key == "grep" {
		var result struct {
			Paths        []string               `json:"paths"`
			Groups       []workspace.MatchGroup `json:"groups"`
			Truncated    bool                   `json:"truncated"`
			Visited      int                    `json:"visited_entries"`
			SkippedLarge int                    `json:"skipped_large_files,omitempty"`
			StopReason   string                 `json:"stop_reason,omitempty"`
		}
		if json.Unmarshal(raw, &result) != nil {
			return "", integrity()
		}
		for i := range result.Paths {
			result.Paths[i] = "/data/" + result.Paths[i]
		}
		for i := range result.Groups {
			result.Groups[i].Path = "/data/" + result.Groups[i].Path
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
			if result.StopReason == "" {
				result.StopReason = "output_limit"
			}
			if len(result.Groups) > 0 {
				last := &result.Groups[len(result.Groups)-1]
				if len(last.Lines) > 1 {
					last.Lines = last.Lines[:len(last.Lines)-1]
				} else {
					result.Groups = result.Groups[:len(result.Groups)-1]
				}
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
