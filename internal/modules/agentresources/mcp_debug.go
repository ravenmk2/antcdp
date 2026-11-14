package agentresources

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type MCPTestResult struct {
	SessionID     string        `json:"session_id,omitempty"`
	ExpiresAt     *time.Time    `json:"expires_at,omitempty"`
	ServerVersion string        `json:"server_version"`
	Diagnostic    MCPDiagnostic `json:"diagnostic"`
	ToolCount     int           `json:"tool_count"`
	Tools         []mcp.Tool    `json:"tools"`
}
type MCPCallWrite struct {
	SessionID   string          `json:"session_id"`
	ToolName    string          `json:"tool_name"`
	Fingerprint string          `json:"definition_fingerprint"`
	Arguments   json.RawMessage `json:"arguments"`
}
type MCPCallResult struct {
	SessionActive     *bool           `json:"session_active,omitempty"`
	Status            string          `json:"status"`
	Executed          *bool           `json:"executed"`
	DurationMS        int64           `json:"duration_ms"`
	Content           string          `json:"content"`
	StructuredContent json.RawMessage `json:"structured_content"`
	Truncated         bool            `json:"truncated"`
	Error             *string         `json:"error"`
}

func mcpReason(e error) string {
	var remote *mcp.Error
	if errors.As(e, &remote) {
		return remote.Code
	}
	if errors.Is(e, context.DeadlineExceeded) {
		return "MCP_TIMEOUT"
	}
	if errors.Is(e, context.Canceled) {
		return "MCP_CANCELED"
	}
	return "MCP_REQUEST_FAILED"
}

// Authenticate and freeze a saved configuration in a short transaction. All
// remote IO is outside it; neither URL overrides nor raw credentials are accepted.
func (s *Service) mcpDebugConfig(ctx context.Context, raw string, id uint64, tag, action string) (*Result, *MCPServer, mcp.Config, error) {
	var server *MCPServer
	var config mcp.Config
	out, e := s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		server, e = repo.MCPServer(id, false)
		if e != nil {
			return e
		}
		if server == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag("mcp_server", id, server.RowVersion)); e != nil {
			return e
		}
		config, e = s.decryptMCP(repo, server)
		if e != nil {
			return e
		}
		out.Tag = s.tag("mcp_server", id, server.RowVersion)
		return audit(ctx, tx, a, action, "mcp_server", id)
	})
	return out, server, config, e
}

func (s *Service) TestMCP(ctx context.Context, raw string, id uint64, tag string) (*Result, error) {
	return s.testMCP(ctx, raw, id, tag, false, "")
}
func (s *Service) ConnectMCP(ctx context.Context, raw string, id uint64, tag, sessionID string) (*Result, error) {
	return s.testMCP(ctx, raw, id, tag, true, sessionID)
}
func (s *Service) testMCP(ctx context.Context, raw string, id uint64, tag string, persistent bool, sessionID string) (*Result, error) {
	out, server, config, e := s.mcpDebugConfig(ctx, raw, id, tag, "mcp_server.test")
	if e != nil {
		return nil, e
	}
	if s.MCPFactory == nil {
		return nil, unavailable()
	}
	started := time.Now().UTC()
	bounded, cancel := context.WithTimeout(ctx, min(config.Timeout, time.Minute))
	defer cancel()
	var client MCPClient
	var entry *mcpDebugSession
	keep := false
	if persistent {
		if s.MCPOpen == nil {
			return nil, unavailable()
		}
		entry, e = s.acquireDebug(out.Auth, server, sessionID, sessionID == "")
		if e != nil {
			return nil, e
		}
		defer func() { s.releaseDebug(entry, keep) }()
		if entry.client == nil {
			entry.client, e = s.MCPOpen(bounded, config)
		}
		client = entry.client
	} else {
		client, e = s.MCPFactory(bounded, config)
	}
	var discovered mcp.Discovery
	if e == nil {
		discovered, e = client.Discover(bounded)
	}
	finished := time.Now().UTC()
	diagnostic := MCPDiagnostic{Kind: "connection_test", Status: "succeeded", StartedAt: started, FinishedAt: finished, DurationMS: finished.Sub(started).Milliseconds(), Checks: []MCPCheck{}, ProtocolVersion: discovered.ProtocolVersion}
	tools := discovered.Tools
	if tools == nil {
		tools = []mcp.Tool{}
	}
	if e != nil {
		reason := mcpReason(e)
		diagnostic.Status = "failed"
		diagnostic.Checks = append(diagnostic.Checks, MCPCheck{Name: "initialize_and_list_tools", Status: "failed", Reason: &reason})
		tools = []mcp.Tool{}
	} else {
		diagnostic.Checks = append(diagnostic.Checks, MCPCheck{Name: "initialize_and_list_tools", Status: "succeeded"})
	}
	record := MCPDiagnosticRecord{Diagnostic: diagnostic, ConfigVersion: server.ConfigVersion, SecretRevision: server.SecretRevision}
	// Finish recording even if the browser stopped waiting; do not overwrite a
	// newer test or attach an old result to a changed configuration.
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer finishCancel()
	e = s.background(finishCtx, func(tx identity.Tx) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		current, e := repo.MCPServer(id, true)
		if e != nil {
			return e
		}
		if current == nil {
			diagnostic.Outdated = true
			return nil
		}
		diagnostic.Outdated = current.ConfigVersion != server.ConfigVersion || current.SecretRevision != server.SecretRevision
		if len(current.LastDiagnostic) > 0 && string(current.LastDiagnostic) != "null" {
			var previous MCPDiagnosticRecord
			if json.Unmarshal(current.LastDiagnostic, &previous) != nil {
				return integrity()
			}
			if previous.Diagnostic.StartedAt.After(started) {
				return nil
			}
		}
		current.LastDiagnostic, e = json.Marshal(record)
		if e != nil {
			return e
		}
		current.LastDiagnosticAt = &finished
		return repo.SaveMCPServer(current)
	})
	if e != nil {
		return nil, e
	}
	view := MCPTestResult{ServerVersion: serverVersion(out.Tag), Diagnostic: diagnostic, ToolCount: len(tools), Tools: tools}
	if entry != nil && diagnostic.Status == "succeeded" && !diagnostic.Outdated && ctx.Err() == nil {
		entry.tools = tools
		keep = true
		view.SessionID = entry.id
		expires := time.Now().UTC().Add(debugIdle)
		view.ExpiresAt = &expires
	}
	out.Data = view
	return out, nil
}
func serverVersion(tag string) string {
	if len(tag) >= 2 {
		return tag[1 : len(tag)-1]
	}
	return tag
}

func (s *Service) CallMCPTool(ctx context.Context, raw string, id uint64, tag string, w MCPCallWrite) (*Result, error) {
	var args map[string]json.RawMessage
	if len(w.Arguments) > 32<<10 || json.Unmarshal(w.Arguments, &args) != nil || args == nil {
		return nil, httpx.Invalid("arguments", "invalid_object")
	}
	hash, e := hex.DecodeString(w.Fingerprint)
	if e != nil || len(hash) != 32 {
		return nil, httpx.Invalid("definition_fingerprint", "invalid")
	}
	if w.ToolName == "" || len(w.ToolName) > 255 {
		return nil, httpx.Invalid("tool_name", "invalid_length")
	}
	out, server, config, e := s.mcpDebugConfig(ctx, raw, id, tag, "mcp_server.call_tool.started")
	if e != nil {
		return nil, e
	}
	if s.MCPFactory == nil {
		return nil, unavailable()
	}
	started := time.Now().UTC()
	bounded, cancel := context.WithTimeout(ctx, config.Timeout)
	defer cancel()
	no := false
	result := mcp.CallResult{Executed: &no}
	var client MCPClient
	var entry *mcpDebugSession
	keep := false
	if w.SessionID != "" {
		entry, e = s.acquireDebug(out.Auth, server, w.SessionID, false)
		if e != nil {
			return nil, e
		}
		defer func() { s.releaseDebug(entry, keep) }()
		client = entry.client
	} else {
		client, e = s.MCPFactory(bounded, config)
	}
	if e == nil {
		result, e = client.Call(bounded, mcp.CallRequest{RemoteName: w.ToolName, Fingerprint: w.Fingerprint, Arguments: w.Arguments, ResultLimit: 64 << 10})
	}
	keep = e == nil && ctx.Err() == nil
	var remote *mcp.Error
	if errors.As(e, &remote) && (remote.Code == "MCP_ARGUMENTS_INVALID" || remote.Code == "MCP_SCHEMA_CHANGED" || remote.Code == "MCP_TOOL_UNAVAILABLE") {
		keep = ctx.Err() == nil
	}
	view := MCPCallResult{Status: "succeeded", Executed: result.Executed, DurationMS: time.Since(started).Milliseconds(), Content: result.Content, StructuredContent: result.StructuredContent, Truncated: result.Truncated}
	if e != nil {
		reason := mcpReason(e)
		view.Error = &reason
		view.Status = "failed"
	}
	if result.IsError {
		view.Status = "failed"
	}
	if result.Executed == nil {
		view.Status = "outcome_unknown"
	}
	if entry != nil {
		view.SessionActive = &keep
	}
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer finishCancel()
	target := strconv.FormatUint(id, 10)
	detail, _ := json.Marshal(map[string]any{"tool_name": w.ToolName, "duration_ms": view.DurationMS, "status": view.Status, "executed": view.Executed, "error": view.Error})
	e = s.background(finishCtx, func(tx identity.Tx) error {
		return tx.Audit(identity.Event{ActorID: &out.Auth.User.ID, ActorType: "user", ActorName: out.Auth.User.DisplayName, ActorUsername: &out.Auth.User.Username, Action: "mcp_server.call_tool.finished", TargetType: "mcp_server", TargetID: &target, OccurredAt: time.Now().UTC(), Detail: detail})
	})
	if e != nil { // A completed remote call must never be disguised as safe to retry.
		view.Status = "outcome_unknown"
		reason := "MCP_AUDIT_FAILED"
		view.Error = &reason
	}
	out.Data = view
	return out, nil
}

type MCPExampleWrite struct {
	SessionID   string `json:"session_id"`
	ToolName    string `json:"tool_name"`
	Fingerprint string `json:"definition_fingerprint"`
}

func (s *Service) MCPExample(ctx context.Context, raw string, id uint64, tag string, w MCPExampleWrite) (*Result, error) {
	out, server, _, err := s.mcpDebugConfig(ctx, raw, id, tag, "mcp_server.example")
	if err != nil {
		return nil, err
	}
	entry, err := s.acquireDebug(out.Auth, server, w.SessionID, false)
	if err != nil {
		return nil, err
	}
	defer s.releaseDebug(entry, true)
	for _, tool := range entry.tools {
		if tool.RemoteName == w.ToolName && tool.Fingerprint == w.Fingerprint {
			example, err := mcp.GenerateExample(tool.InputSchema)
			if err != nil {
				return nil, err
			}
			out.Data = example
			return out, nil
		}
	}
	return nil, httpx.E(409, "MCP_SCHEMA_CHANGED", "工具定义已变化，请刷新工具列表")
}
