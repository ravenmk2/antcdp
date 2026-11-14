package modeladapters

import (
	"context"
	"encoding/json"
	"io"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type messageBlock struct {
	fields    map[string]json.RawMessage
	arguments string
	closed    bool
}

func decodeMessages(ctx context.Context, reader io.Reader, emit modelcore.Emit) (modelcore.Response, error) {
	result := modelcore.Response{}
	var blocks []*messageBlock
	started, finished := false, false
	err := readSSE(ctx, reader, func(data []byte) (bool, error) {
		var frame struct {
			Type    string                     `json:"type"`
			Index   int                        `json:"index"`
			Message json.RawMessage            `json:"message"`
			Block   map[string]json.RawMessage `json:"content_block"`
			Delta   map[string]json.RawMessage `json:"delta"`
			Usage   json.RawMessage            `json:"usage"`
		}
		if json.Unmarshal(data, &frame) != nil {
			return false, modelcore.ErrInvalidResponse
		}
		switch frame.Type {
		case "ping":
			return false, nil
		case "message_start":
			if started {
				return false, modelcore.ErrInvalidResponse
			}
			started = true
			var message struct {
				Role    string            `json:"role"`
				Model   string            `json:"model"`
				Content []json.RawMessage `json:"content"`
				Usage   json.RawMessage   `json:"usage"`
			}
			if json.Unmarshal(frame.Message, &message) != nil || message.Role != "assistant" || len(message.Content) > 0 || len(message.Model) > 255 || strings.ContainsAny(message.Model, "\r\n\x00") {
				return false, modelcore.ErrInvalidResponse
			}
			result.ReturnedModel = message.Model
			mergeUsage(&result.Usage, message.Usage, modelcore.AnthropicMessages)
		case "content_block_start":
			if !started || finished || frame.Index != len(blocks) || frame.Block == nil {
				return false, modelcore.ErrInvalidResponse
			}
			kind, err := rawString(frame.Block["type"])
			if err != nil {
				return false, err
			}
			block := &messageBlock{fields: frame.Block}
			blocks = append(blocks, block)
			switch kind {
			case "text":
				text, err := rawString(frame.Block["text"])
				if err != nil {
					return false, err
				}
				result.Message.Content += text
				if err = emit(modelcore.Delta{Kind: "text", BlockIndex: frame.Index, Text: text}); err != nil {
					return false, err
				}
			case "thinking":
				text, err := rawString(frame.Block["thinking"])
				if err != nil {
					return false, err
				}
				result.Message.Reasoning += text
				if err = emit(modelcore.Delta{Kind: "reasoning", BlockIndex: frame.Index, Text: text}); err != nil {
					return false, err
				}
			case "tool_use":
				name, err := rawString(frame.Block["name"])
				if err != nil {
					return false, err
				}
				if err = emit(modelcore.Delta{Kind: "tool_call", BlockIndex: frame.Index, DraftCallID: "draft-" + strconv.Itoa(frame.Index), Name: name}); err != nil {
					return false, err
				}
			case "redacted_thinking":
				// Preserve the opaque block without leaking its data as visible reasoning.
				if err = emit(modelcore.Delta{Kind: "reasoning", BlockIndex: frame.Index}); err != nil {
					return false, err
				}
			default:
				return false, modelcore.ErrUnsupported
			}
		case "content_block_delta":
			if !started || finished || frame.Index < 0 || frame.Index >= len(blocks) || blocks[frame.Index].closed {
				return false, modelcore.ErrInvalidResponse
			}
			block := blocks[frame.Index]
			kind, _ := rawString(frame.Delta["type"])
			blockKind, _ := rawString(block.fields["type"])
			var field, valueField, display string
			switch kind {
			case "text_delta":
				if blockKind != "text" {
					return false, modelcore.ErrInvalidResponse
				}
				field, valueField, display = "text", "text", "text"
			case "thinking_delta":
				if blockKind != "thinking" {
					return false, modelcore.ErrInvalidResponse
				}
				field, valueField, display = "thinking", "thinking", "reasoning"
			case "signature_delta":
				if blockKind != "thinking" {
					return false, modelcore.ErrInvalidResponse
				}
				field, valueField = "signature", "signature"
			case "input_json_delta":
				if blockKind != "tool_use" {
					return false, modelcore.ErrInvalidResponse
				}
				valueField = "partial_json"
				display = "tool_call"
			default:
				return false, modelcore.ErrUnsupported
			}
			if len(frame.Delta) != 2 {
				return false, modelcore.ErrUnsupported
			}
			text, err := rawString(frame.Delta[valueField])
			if err != nil {
				return false, err
			}
			if kind == "input_json_delta" {
				block.arguments += text
				if len(block.arguments) > modelcore.MaxToolArgumentsBytes {
					return false, modelcore.ErrOutputLimit
				}
			} else if err = appendString(block.fields, field, text); err != nil {
				return false, err
			}
			if display == "text" {
				result.Message.Content += text
			}
			if display == "reasoning" {
				result.Message.Reasoning += text
			}
			if display != "" {
				delta := modelcore.Delta{Kind: display, BlockIndex: frame.Index, Text: text}
				if display == "tool_call" {
					delta.DraftCallID = "draft-" + strconv.Itoa(frame.Index)
				}
				if err = emit(delta); err != nil {
					return false, err
				}
			}
		case "content_block_stop":
			if !started || finished || frame.Index < 0 || frame.Index >= len(blocks) || blocks[frame.Index].closed {
				return false, modelcore.ErrInvalidResponse
			}
			block := blocks[frame.Index]
			block.closed = true
			kind, _ := rawString(block.fields["type"])
			if kind == "tool_use" {
				args := block.arguments
				if args == "" {
					args = string(block.fields["input"])
				}
				id, _ := rawString(block.fields["id"])
				name, _ := rawString(block.fields["name"])
				call := modelcore.ToolCall{ID: id, Name: name, Arguments: args}
				if err := validateCall(call); err != nil {
					return false, err
				}
				block.fields["input"] = json.RawMessage(args)
				result.Message.ToolCalls = append(result.Message.ToolCalls, call)
			}
		case "message_delta":
			if !started || finished {
				return false, modelcore.ErrInvalidResponse
			}
			for _, block := range blocks {
				if !block.closed {
					return false, modelcore.ErrIncompleteStream
				}
			}
			finish, err := rawString(frame.Delta["stop_reason"])
			if err != nil {
				return false, err
			}
			result.FinishReason = finish
			finished = true
			mergeUsage(&result.Usage, frame.Usage, modelcore.AnthropicMessages)
		case "message_stop":
			if !finished {
				return false, modelcore.ErrIncompleteStream
			}
			return true, nil
		default:
			return false, modelcore.ErrInvalidResponse
		}
		size := 0
		for _, block := range blocks {
			raw, _ := json.Marshal(block.fields)
			size += len(raw) + len(block.arguments)
		}
		if size > modelcore.MaxMessageBytes {
			return false, modelcore.ErrOutputLimit
		}
		return false, nil
	})
	if err != nil {
		return result, err
	}
	if result.FinishReason != "end_turn" && result.FinishReason != "tool_use" && result.FinishReason != "stop_sequence" {
		return result, modelcore.ErrIncompleteStream
	}
	if len(blocks) == 0 {
		return result, modelcore.ErrInvalidResponse
	}
	content := make([]map[string]json.RawMessage, 0, len(blocks))
	seen := map[string]bool{}
	for _, call := range result.Message.ToolCalls {
		if seen[call.ID] {
			return result, modelcore.ErrInvalidResponse
		}
		seen[call.ID] = true
	}
	for _, block := range blocks {
		content = append(content, block.fields)
	}
	raw, _ := json.Marshal(map[string]any{"role": "assistant", "content": content})
	if len(raw) > modelcore.MaxMessageBytes {
		return result, modelcore.ErrOutputLimit
	}
	result.Message.Role = "assistant"
	result.Message.NativeProtocol = modelcore.AnthropicMessages
	result.Message.Native = raw
	return result, nil
}
