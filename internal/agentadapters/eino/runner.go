// Package eino keeps the framework inside the execution adapter. ADK owns the
// reasoning/tool loop; host hooks own admission, durable commits and dispatch.
package eino

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

const nativeMessageKey = "antcdp_model_message"
const imageMessageKey = "antcdp_model_images"

type ToolInvocation struct {
	Step int
	Call modelcore.ToolCall
}

// Hooks must persist a complete model response and all its call intentions in
// CommitModel before Dispatch can run. Dispatch includes current authorization,
// one-time approval and unique tool-result commit. Errors stop this invocation;
// this adapter never retries or resumes a side effect on its own.
type Hooks struct {
	BeforeModel func(context.Context, int, modelcore.Request) error
	CommitModel func(context.Context, int, modelcore.Response) error
	Dispatch    func(context.Context, ToolInvocation) (string, error)
	Emit        func(context.Context, int, modelcore.Delta) error
}

type RunConfig struct {
	Client   modelcore.Client
	Request  modelcore.Request
	MaxSteps int
	Hooks    Hooks
}

// Run is the initial bounded vertical integration. It intentionally does not
// enable ADK retry, checkpoint recovery, child agents, failover or compaction.
// It streams through Emit while ADK consumes complete, already committed messages.
func Run(ctx context.Context, config RunConfig) (modelcore.Response, error) {
	if config.Client == nil || config.MaxSteps < 1 || config.MaxSteps > 200 || config.Hooks.BeforeModel == nil || config.Hooks.CommitModel == nil || (len(config.Request.Tools) > 0 && config.Hooks.Dispatch == nil) {
		return modelcore.Response{}, errors.New("incomplete execution adapter configuration")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	bridge := &chatModel{config: config, prepared: make(map[string]modelcore.ToolCall)}
	tools := make([]tool.BaseTool, 0, len(config.Request.Tools))
	seen := map[string]bool{}
	for _, spec := range config.Request.Tools {
		if seen[spec.Name] || spec.Name == "" {
			return modelcore.Response{}, modelcore.ErrInvalidRequest
		}
		seen[spec.Name] = true
		// ToolInfo's JSON codec preserves the complete JSON Schema without
		// reducing it to Eino's smaller convenience ParameterInfo vocabulary.
		raw, err := json.Marshal(map[string]any{"name": spec.Name, "desc": spec.Description, "has_params_one_of": true, "json_schema": spec.InputSchema})
		if err != nil {
			return modelcore.Response{}, modelcore.ErrInvalidRequest
		}
		var info schema.ToolInfo
		if json.Unmarshal(raw, &info) != nil {
			return modelcore.Response{}, modelcore.ErrInvalidRequest
		}
		tools = append(tools, &hostTool{info: &info, bridge: bridge})
	}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "controlled_execution", Model: bridge, MaxIterations: config.MaxSteps, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools, ExecuteSequentially: true}}})
	if err != nil {
		return modelcore.Response{}, fmt.Errorf("initialize execution adapter: %w", err)
	}
	messages := make([]*schema.Message, 0, len(config.Request.Messages))
	for _, message := range config.Request.Messages {
		converted, e := toFramework(message)
		if e != nil {
			return modelcore.Response{}, e
		}
		messages = append(messages, converted)
	}
	iterator := agent.Run(ctx, &adk.AgentInput{Messages: messages})
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			return bridge.last, event.Err
		}
	}
	if err = ctx.Err(); err != nil {
		return bridge.last, err
	}
	if bridge.step == 0 {
		return modelcore.Response{}, errors.New("execution produced no model call")
	}
	return bridge.last, nil
}

type chatModel struct {
	config   RunConfig
	step     int
	last     modelcore.Response
	prepared map[string]modelcore.ToolCall
}

func (m *chatModel) Generate(ctx context.Context, input []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if m.step >= m.config.MaxSteps {
		return nil, errors.New("execution step limit exceeded")
	}
	m.step++
	request := m.config.Request
	request.Messages = make([]modelcore.Message, 0, len(input))
	for _, message := range input {
		converted, err := fromFramework(message)
		if err != nil {
			return nil, err
		}
		request.Messages = append(request.Messages, converted)
	}
	if err := m.config.Hooks.BeforeModel(ctx, m.step, request); err != nil {
		return nil, err
	}
	response, err := m.config.Client.Generate(ctx, request, func(delta modelcore.Delta) error {
		if m.config.Hooks.Emit != nil {
			return m.config.Hooks.Emit(ctx, m.step, delta)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = m.config.Hooks.CommitModel(ctx, m.step, response); err != nil {
		return nil, err
	}
	m.last = response
	m.prepared = make(map[string]modelcore.ToolCall, len(response.Message.ToolCalls))
	for _, call := range response.Message.ToolCalls {
		if _, ok := m.prepared[call.ID]; ok {
			return nil, modelcore.ErrInvalidResponse
		}
		m.prepared[call.ID] = call
	}
	return toFramework(response.Message)
}

func (m *chatModel) Stream(ctx context.Context, input []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	message, err := m.Generate(ctx, input, opts...)
	if err != nil {
		return nil, err
	}
	return schema.StreamReaderFromArray([]*schema.Message{message}), nil
}

type hostTool struct {
	info   *schema.ToolInfo
	bridge *chatModel
}

func (t *hostTool) Info(context.Context) (*schema.ToolInfo, error) { return t.info, nil }
func (t *hostTool) InvokableRun(ctx context.Context, arguments string, _ ...tool.Option) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	id := compose.GetToolCallID(ctx)
	call, ok := t.bridge.prepared[id]
	if !ok || call.Name != t.info.Name || call.Arguments != arguments {
		return "", errors.New("uncommitted or altered tool call")
	}
	// Consume before external dispatch, even when its outcome is unknown.
	delete(t.bridge.prepared, id)
	return t.bridge.config.Hooks.Dispatch(ctx, ToolInvocation{Step: t.bridge.step, Call: call})
}

func toFramework(message modelcore.Message) (*schema.Message, error) {
	raw, err := json.Marshal(message)
	if err != nil {
		return nil, err
	}
	result := &schema.Message{Role: schema.RoleType(message.Role), Content: message.Content, ReasoningContent: message.Reasoning, ToolCallID: message.ToolCallID, Extra: map[string]any{nativeMessageKey: string(raw)}}
	if len(message.Images) > 0 {
		result.Extra[imageMessageKey] = append([]modelcore.ImagePart(nil), message.Images...)
	}
	for _, call := range message.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, schema.ToolCall{ID: call.ID, Type: "function", Function: schema.FunctionCall{Name: call.Name, Arguments: call.Arguments}})
	}
	return result, nil
}

func fromFramework(message *schema.Message) (modelcore.Message, error) {
	if message == nil {
		return modelcore.Message{}, modelcore.ErrInvalidRequest
	}
	if value, ok := message.Extra[nativeMessageKey]; ok {
		raw, valid := value.(string)
		if !valid {
			return modelcore.Message{}, modelcore.ErrInvalidRequest
		}
		var original modelcore.Message
		if json.Unmarshal([]byte(raw), &original) != nil {
			return modelcore.Message{}, modelcore.ErrInvalidRequest
		}
		if images, ok := message.Extra[imageMessageKey]; ok {
			typed, valid := images.([]modelcore.ImagePart)
			if !valid {
				return modelcore.Message{}, modelcore.ErrInvalidRequest
			}
			original.Images = append([]modelcore.ImagePart(nil), typed...)
		}
		for _, image := range original.Images {
			if image.DataBase64 == "" {
				return modelcore.Message{}, modelcore.ErrInvalidRequest
			}
		}
		return original, nil
	}
	result := modelcore.Message{Role: string(message.Role), Content: message.Content, Reasoning: message.ReasoningContent, ToolCallID: message.ToolCallID}
	for _, call := range message.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, modelcore.ToolCall{ID: call.ID, Name: call.Function.Name, Arguments: call.Function.Arguments})
	}
	return result, nil
}
