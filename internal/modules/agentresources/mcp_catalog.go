package agentresources

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) ValidateMCPServer(tx identity.Tx, id uint64) error {
	repo, e := mcpRepository(tx)
	if e != nil {
		return e
	}
	v, e := repo.MCPServer(id, true)
	if e != nil {
		return e
	}
	if v == nil {
		return missing()
	}
	return nil
}
func (s *Service) DiscoverMCP(ctx context.Context, id uint64, expected json.RawMessage) ([]agentcore.ToolSpec, error) {
	var config mcp.Config
	e := s.background(ctx, func(tx identity.Tx) error {
		var err error
		config, err = s.ReadAuthorizedMCPRuntime(tx, id, expected)
		return err
	})
	if e != nil {
		return nil, e
	}
	if s.MCPFactory == nil {
		return nil, unavailable()
	}
	ctx, cancel := context.WithTimeout(ctx, min(config.Timeout, time.Minute))
	defer cancel()
	client, e := s.MCPFactory(ctx, config)
	if e != nil {
		return nil, e
	}
	discovery, e := client.Discover(ctx)
	if e != nil {
		return nil, e
	}
	out := make([]agentcore.ToolSpec, 0, len(discovery.Tools))
	names := map[string]bool{}
	for _, tool := range discovery.Tools {
		name := mcp.ModelToolName(id, tool.RemoteName)
		if names[name] {
			return nil, httpx.E(409, "MCP_TOOL_NAME_COLLISION", "MCP 工具名称冲突")
		}
		names[name] = true
		out = append(out, agentcore.ToolSpec{Key: name, Definition: modelcore.Tool{Name: name, Description: tool.Description, InputSchema: tool.InputSchema}, ExecutionClass: "side_effect", ResultLimit: 64 << 10, MCP: &agentcore.MCPToolRef{ServerID: id, RemoteName: tool.RemoteName, Fingerprint: tool.Fingerprint, Identity: expected, OutputSchema: tool.OutputSchema, Annotations: tool.Annotations}})
	}
	return out, nil
}
