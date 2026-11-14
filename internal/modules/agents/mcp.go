package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type MCPBinding struct {
	ID        uint64     `db:"id" json:"id,string"`
	AgentID   uint64     `db:"agent_id" json:"-"`
	ServerID  uint64     `db:"mcp_server_id" json:"mcp_server_id,string"`
	Enabled   bool       `db:"enabled" json:"enabled"`
	SortOrder int        `db:"sort_order" json:"-"`
	CreatedAt time.Time  `db:"created_at" json:"-"`
	UpdatedAt time.Time  `db:"updated_at" json:"-"`
	RemovedAt *time.Time `db:"removed_at" json:"-"`
}
type MCPBindingWrite struct {
	ServerID string `json:"mcp_server_id"`
	Enabled  bool   `json:"enabled"`
}
type MCPBindingsWrite struct {
	Items []MCPBindingWrite `json:"items"`
}

func (s *Service) GetMCPBindings(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := s.bindingDefinition(r, id, "mcp-bindings", "")
		if e != nil {
			return e
		}
		rows, e := r.MCPBindings(id, false)
		if e != nil {
			return e
		}
		s.bindingResult(out, v, "mcp-bindings", rows)
		return nil
	})
}
func mcpWrites(rows []MCPBinding) []MCPBindingWrite {
	out := make([]MCPBindingWrite, 0, len(rows))
	for _, b := range rows {
		out = append(out, MCPBindingWrite{strconv.FormatUint(b.ServerID, 10), b.Enabled})
	}
	return out
}
func (s *Service) PutMCPBindings(ctx context.Context, raw string, id uint64, tag string, w MCPBindingsWrite) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if tag == "" {
			return checkTag(tag, "")
		}
		if w.Items == nil || len(w.Items) > 32 {
			return httpx.Invalid("items", "invalid_length")
		}
		v, e := s.bindingDefinition(r, id, "mcp-bindings", tag)
		if e != nil {
			return e
		}
		rows := []MCPBinding{}
		seen := map[uint64]bool{}
		for i, item := range w.Items {
			server, e := idValue(item.ServerID, "items.mcp_server_id")
			if e != nil {
				return e
			}
			if seen[server] {
				return httpx.Invalid("items.mcp_server_id", "duplicate")
			}
			seen[server] = true
			if s.Catalog.MCPServer == nil {
				return unavailable()
			}
			if e = s.Catalog.MCPServer(tx, server); e != nil {
				return e
			}
			rows = append(rows, MCPBinding{AgentID: id, ServerID: server, Enabled: item.Enabled, SortOrder: i})
		}
		old, e := r.MCPBindings(id, false)
		if e != nil {
			return e
		}
		if !same(mcpWrites(old), mcpWrites(rows)) {
			if e = r.SaveMCPBindings(id, rows, time.Now().UTC().Truncate(time.Millisecond)); e != nil {
				return e
			}
			if v.Enabled {
				if e = s.validateEnabled(ctx, tx, r, id); e != nil {
					return e
				}
			}
			if e = s.saveBindingChange(ctx, tx, r, a, v, "mcp-bindings"); e != nil {
				return e
			}
		}
		rows, e = r.MCPBindings(id, false)
		if e != nil {
			return e
		}
		s.bindingResult(out, v, "mcp-bindings", rows)
		return nil
	})
}

type mcpPreparation struct {
	Binding  MCPBinding
	Identity json.RawMessage
	Reason   string
}

func (s *Service) prepareMCPBindings(tx identity.Tx, r Repository, agentID uint64) ([]mcpPreparation, error) {
	rows, e := r.MCPBindings(agentID, false)
	if e != nil {
		return nil, e
	}
	out := []mcpPreparation{}
	for _, b := range rows {
		if !b.Enabled {
			continue
		}
		p := mcpPreparation{Binding: b}
		if s.Catalog.MCPIdentity == nil {
			p.Reason = "MCP_UNAVAILABLE"
		} else {
			p.Identity, e = s.Catalog.MCPIdentity(tx, b.ServerID)
			if e != nil {
				p.Reason = "MCP_SERVER_UNAVAILABLE"
			}
		}
		out = append(out, p)
	}
	return out, nil
}

// Discovery runs outside transactions and is persisted once in the root context.
func (s *Service) discoverMCPBindings(ctx context.Context, prepared []mcpPreparation) ([]agentcore.ToolSpec, agentcore.ContextFact) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	type discovery struct {
		tools []agentcore.ToolSpec
		err   error
	}
	results := make([]discovery, len(prepared))
	var workers sync.WaitGroup
	slots := make(chan struct{}, 4)
	for i, p := range prepared {
		if p.Reason != "" || s.Catalog.DiscoverMCP == nil {
			continue
		}
		workers.Go(func() {
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				results[i].err = ctx.Err()
				return
			}
			results[i].tools, results[i].err = s.Catalog.DiscoverMCP(ctx, p.Binding.ServerID, p.Identity)
		})
	}
	workers.Wait()
	tools := []agentcore.ToolSpec{}
	statuses := []map[string]any{}
	names := map[string]bool{}
	for i, p := range prepared {
		reason := p.Reason
		if reason == "" {
			if s.Catalog.DiscoverMCP == nil {
				reason = "MCP_UNAVAILABLE"
			} else {
				found, e := results[i].tools, results[i].err
				if e != nil {
					reason = "MCP_DISCOVERY_FAILED"
				} else {
					for _, spec := range found {
						if names[spec.Definition.Name] {
							reason = "MCP_TOOL_NAME_COLLISION"
							break
						}
					}
					if reason == "" {
						for _, spec := range found {
							names[spec.Definition.Name] = true
							spec.Policy = "allow"
							spec.MCP.BindingID = p.Binding.ID
							tools = append(tools, spec)
						}
					}
				}
			}
		}
		statuses = append(statuses, map[string]any{"server_id": strconv.FormatUint(p.Binding.ServerID, 10), "available": reason == "", "reason": reason})
	}
	raw, _ := json.Marshal(map[string]any{"mcp_servers": statuses})
	return tools, agentcore.ContextFact{Kind: "context/mcp", Content: raw}
}
