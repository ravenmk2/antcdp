package agents

import (
	"context"
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *Service) resolveDispatchTool(ctx context.Context, tx identity.Tx, r Repository, x executionRows, call agentcore.PreparedToolCall) (*ToolBinding, *ToolDescriptor, json.RawMessage, string, error) {
	if call.Spec.MCP != nil {
		return s.resolveMCPDispatch(tx, r, x, call)
	}
	var binding *ToolBinding
	var frozen *FrozenTool
	for i := range x.Context.Tools {
		if x.Context.Tools[i].Spec.Key == call.Spec.Key {
			frozen = &x.Context.Tools[i]
			binding = &frozen.Binding
			break
		}
	}
	if binding == nil || frozen == nil || !semanticSame(frozen.Spec, call.Spec) {
		return nil, nil, nil, "TOOL_NOT_AUTHORIZED", nil
	}
	if s.Catalog.Tool == nil {
		return nil, nil, nil, "", unavailable()
	}
	descriptor, e := s.Catalog.Tool(ctx, tx, call.Spec.Key)
	if e != nil {
		return nil, nil, nil, "", e
	}
	reason := ""
	if descriptor == nil {
		reason = "TOOL_UNAVAILABLE"
	} else if frozen.RequiresSandbox && x.Execution.Binding == nil {
		reason = "SANDBOX_UNAVAILABLE"
	} else if !semanticSame(descriptor.Definition, call.Spec.Definition) {
		reason = "TOOL_SCHEMA_CHANGED"
	}
	return binding, descriptor, nil, reason, nil
}

func (s *Service) resolveMCPDispatch(tx identity.Tx, r Repository, x executionRows, call agentcore.PreparedToolCall) (*ToolBinding, *ToolDescriptor, json.RawMessage, string, error) {
	ref := call.Spec.MCP
	var binding *ToolBinding
	for _, frozen := range x.Context.MCPTools {
		if frozen.Key == call.Spec.Key && semanticSame(frozen, call.Spec) {
			binding = &ToolBinding{ID: ref.BindingID, Policy: frozen.Policy, Constraints: json.RawMessage(`{}`)}
			break
		}
	}
	if binding == nil {
		return nil, nil, nil, "TOOL_NOT_AUTHORIZED", nil
	}
	if s.Catalog.MCPArguments == nil {
		return nil, nil, nil, "MCP_UNAVAILABLE", nil
	}
	if e := s.Catalog.MCPArguments(call.Spec.Definition.InputSchema, json.RawMessage(call.Call.Arguments)); e != nil {
		return nil, nil, nil, "MCP_ARGUMENTS_INVALID", nil
	}
	descriptor := &ToolDescriptor{Key: call.Spec.Key, Definition: call.Spec.Definition, Source: ToolSource{Kind: "mcp", ServerID: &ref.ServerID}, ExecutionClass: "side_effect", Availability: Availability{Available: true}}
	return binding, descriptor, ref.Identity, "", nil
}
