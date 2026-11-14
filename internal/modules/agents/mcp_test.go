package agents

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type mcpBindingMemory struct {
	Repository
	rows []MCPBinding
}

func TestMCPDiscoveryBoundsConcurrencyAndPreservesOrder(t *testing.T) {
	var active, maximum atomic.Int32
	gate := make(chan struct{})
	started := make(chan struct{}, 8)
	s := Service{Catalog: ResourceCatalog{DiscoverMCP: func(ctx context.Context, id uint64, _ json.RawMessage) ([]agentcore.ToolSpec, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for old := maximum.Load(); n > old; old = maximum.Load() {
			if maximum.CompareAndSwap(old, n) {
				break
			}
		}
		started <- struct{}{}
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		name := string(rune('a' + id))
		return []agentcore.ToolSpec{{Definition: modelcore.Tool{Name: name}, MCP: &agentcore.MCPToolRef{ServerID: id}}}, nil
	}}}
	prepared := make([]mcpPreparation, 8)
	for i := range prepared {
		prepared[i].Binding = MCPBinding{ID: uint64(i + 1), ServerID: uint64(i + 1), Enabled: true}
	}
	done := make(chan []agentcore.ToolSpec, 1)
	go func() {
		tools, _ := s.discoverMCPBindings(t.Context(), prepared)
		done <- tools
	}()
	for range 4 {
		select {
		case <-started:
		case <-t.Context().Done():
			t.Fatal("discovery did not start")
		}
	}
	close(gate)
	tools := <-done
	if maximum.Load() != 4 || len(tools) != 8 {
		t.Fatalf("concurrency=%d tools=%d", maximum.Load(), len(tools))
	}
	for i, tool := range tools {
		if tool.MCP.ServerID != uint64(i+1) {
			t.Fatal("discovery reordered server bindings")
		}
	}
}

func (r *mcpBindingMemory) MCPBindings(uint64, bool) ([]MCPBinding, error) { return r.rows, nil }
func TestMCPDispatchUsesRootManifestAfterRevocation(t *testing.T) {
	repo := &mcpBindingMemory{rows: []MCPBinding{{ID: 4, ServerID: 7, Enabled: false}}}
	identity := json.RawMessage(`{"config_version":1}`)
	svc := Service{Catalog: ResourceCatalog{MCPArguments: func(json.RawMessage, json.RawMessage) error { return nil }}}
	spec := agentcore.ToolSpec{Key: "mcp_name", Policy: "allow", Definition: modelcore.Tool{Name: "mcp_name"}, MCP: &agentcore.MCPToolRef{ServerID: 7, BindingID: 4, Identity: identity}}
	x := executionRows{Context: &frozenRunContext{MCPTools: []agentcore.ToolSpec{spec}}}
	call := agentcore.PreparedToolCall{Spec: spec}
	_, _, _, reason, err := svc.resolveMCPDispatch(nil, repo, x, call)
	if err != nil || reason != "" {
		t.Fatalf("root grant changed: %s %v", reason, err)
	}
	call.Spec.Key = "ungranted_tool"
	_, _, _, reason, err = svc.resolveMCPDispatch(nil, repo, x, call)
	if err != nil || reason != "TOOL_NOT_AUTHORIZED" {
		t.Fatalf("new capability entered old turn: %s %v", reason, err)
	}
}
func TestMCPDiscoveryOmitsFailedServerAndAuthorizesWholeService(t *testing.T) {
	s := Service{Catalog: ResourceCatalog{DiscoverMCP: func(_ context.Context, id uint64, _ json.RawMessage) ([]agentcore.ToolSpec, error) {
		if id == 1 {
			return nil, errors.New("remote failure")
		}
		return []agentcore.ToolSpec{{Definition: modelcore.Tool{Name: "new_tool"}, MCP: &agentcore.MCPToolRef{ServerID: id}}}, nil
	}}}
	tools, fact := s.discoverMCPBindings(t.Context(), []mcpPreparation{{Binding: MCPBinding{ID: 1, ServerID: 1, Enabled: true}}, {Binding: MCPBinding{ID: 2, ServerID: 2, Enabled: true}}})
	if len(tools) != 1 || tools[0].Policy != "allow" || tools[0].MCP.BindingID != 2 {
		t.Fatal("new tool did not inherit server policy")
	}
	var status struct {
		Servers []struct {
			Available bool `json:"available"`
		} `json:"mcp_servers"`
	}
	if json.Unmarshal(fact.Content, &status) != nil || len(status.Servers) != 2 || status.Servers[0].Available || !status.Servers[1].Available {
		t.Fatalf("wrong discovery status: %s", fact.Content)
	}
}
