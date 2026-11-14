package agentresources

import (
	"context"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const debugIdle = 10 * time.Minute

type mcpDebugSession struct {
	id                                  string
	user, login, server, config, secret uint64
	enabled                             bool
	client                              MCPSession
	tools                               []mcp.Tool
	busy                                bool
	lastUsed                            time.Time
	closeOnce                           sync.Once
}

func (e *mcpDebugSession) close() {
	e.closeOnce.Do(func() {
		if e.client != nil {
			_ = e.client.Close()
		}
	})
}

// Every lookup follows fresh platform authentication and checks the current
// connection identity. Opaque IDs are scoped to a login and browser workspace.
func (s *Service) acquireDebug(a *identity.Auth, v *MCPServer, id string, create bool) (*mcpDebugSession, error) {
	s.debugMu.Lock()
	if s.debugSessions == nil {
		s.debugSessions = map[string]*mcpDebugSession{}
	}
	if create {
		count := 0
		for _, e := range s.debugSessions {
			if e.user == a.User.ID {
				count++
			}
		}
		if len(s.debugSessions) >= 32 || count >= 4 {
			s.debugMu.Unlock()
			return nil, httpx.E(429, "MCP_DEBUG_LIMIT", "调试连接数量已达上限，请断开不用的连接或等待过期")
		}
		e := &mcpDebugSession{id: cryptox.ID(), user: a.User.ID, login: a.Session.ID, server: v.ID, config: v.ConfigVersion, secret: v.SecretRevision, enabled: v.Enabled, busy: true, lastUsed: time.Now()}
		s.debugSessions[e.id] = e
		s.debugMu.Unlock()
		return e, nil
	}
	e := s.debugSessions[id]
	if e == nil || e.user != a.User.ID || e.login != a.Session.ID || e.server != v.ID {
		s.debugMu.Unlock()
		return nil, httpx.E(410, "MCP_DEBUG_EXPIRED", "调试连接已失效，请重新连接")
	}
	if e.busy {
		s.debugMu.Unlock()
		return nil, httpx.E(409, "MCP_DEBUG_BUSY", "此调试连接正在处理请求")
	}
	if time.Since(e.lastUsed) > debugIdle || e.config != v.ConfigVersion || e.secret != v.SecretRevision || e.enabled != v.Enabled {
		delete(s.debugSessions, id)
		s.debugMu.Unlock()
		e.close()
		return nil, httpx.E(410, "MCP_DEBUG_EXPIRED", "连接配置已变化或调试连接已过期，请重新连接")
	}
	e.busy = true
	s.debugMu.Unlock()
	return e, nil
}
func (s *Service) releaseDebug(e *mcpDebugSession, keep bool) {
	s.debugMu.Lock()
	e.busy = false
	e.lastUsed = time.Now()
	if !keep {
		delete(s.debugSessions, e.id)
	}
	s.debugMu.Unlock()
	if !keep {
		e.close()
	}
}
func (s *Service) CleanupMCPDebug(context.Context) error {
	s.debugMu.Lock()
	var expired []*mcpDebugSession
	for id, e := range s.debugSessions {
		if !e.busy && time.Since(e.lastUsed) > debugIdle {
			delete(s.debugSessions, id)
			expired = append(expired, e)
		}
	}
	s.debugMu.Unlock()
	for _, e := range expired {
		e.close()
	}
	return nil
}
func (s *Service) CloseMCPDebug() {
	s.debugMu.Lock()
	var entries []*mcpDebugSession
	for id, e := range s.debugSessions {
		if !e.busy {
			delete(s.debugSessions, id)
			entries = append(entries, e)
		}
	}
	s.debugMu.Unlock()
	for _, e := range entries {
		e.close()
	}
}
func (s *Service) DisconnectMCP(ctx context.Context, raw string, id uint64, sessionID string) (*Result, error) {
	out, err := s.access(ctx, raw, func(_ identity.Tx, a *identity.Auth, out *Result) error {
		s.debugMu.Lock()
		e := s.debugSessions[sessionID]
		if e == nil {
			s.debugMu.Unlock()
			out.Status = 204
			return nil
		}
		if e.user != a.User.ID || e.login != a.Session.ID || e.server != id {
			s.debugMu.Unlock()
			return httpx.E(404, "RESOURCE_NOT_FOUND", "调试连接不存在")
		}
		if e.busy {
			s.debugMu.Unlock()
			return httpx.E(409, "MCP_DEBUG_BUSY", "请等待当前请求结束后断开")
		}
		delete(s.debugSessions, sessionID)
		s.debugMu.Unlock()
		// Closing the SDK connection may issue HTTP DELETE; do that outside the transaction.
		out.Data = e
		out.Status = 204
		return nil
	})
	if err == nil && out.Data != nil {
		out.Data.(*mcpDebugSession).close()
		out.Data = nil
	}
	return out, err
}
