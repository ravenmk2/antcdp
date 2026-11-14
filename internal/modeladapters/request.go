package modeladapters

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func encodeRequest(provider modelcore.ProviderType, input modelcore.Request) ([]byte, error) {
	if input.Model == "" || len(input.Model) > 255 || len(input.Messages) == 0 {
		return nil, modelcore.ErrInvalidRequest
	}
	if err := NewRegistry().ValidateParameters(provider, input.Protocol, input.Parameters); err != nil {
		return nil, err
	}
	body := map[string]any{"model": input.Model, "stream": true}
	for key, value := range input.Parameters {
		switch key {
		case "max_output_tokens":
			key = "max_tokens"
		case "stop":
			if input.Protocol == modelcore.AnthropicMessages {
				key = "stop_sequences"
			}
		}
		body[key] = value
	}
	if input.Protocol == modelcore.AnthropicMessages {
		if _, ok := body["max_tokens"]; !ok {
			return nil, fmt.Errorf("%w: max_output_tokens required", modelcore.ErrInvalidRequest)
		}
	}
	messages := make([]json.RawMessage, 0, len(input.Messages))
	var system []json.RawMessage
	previousTool := false
	pendingImages := []modelcore.Message{}
	declared := map[string]bool{}
	flushImages := func() error {
		if len(pendingImages) == 0 {
			return nil
		}
		if len(declared) != 0 {
			return fmt.Errorf("%w: incomplete image tool group", modelcore.ErrInvalidRequest)
		}
		for _, supplement := range pendingImages {
			raw, err := encodeMessage(input.Protocol, supplement)
			if err != nil {
				return err
			}
			messages = append(messages, raw)
		}
		pendingImages = nil
		return nil
	}
	for _, message := range input.Messages {
		if message.Role != "tool" {
			if err := flushImages(); err != nil {
				return nil, err
			}
			declared = map[string]bool{}
			for _, call := range message.ToolCalls {
				declared[call.ID] = true
			}
		}
		if message.Role == "tool" {
			matched := declared[message.ToolCallID]
			delete(declared, message.ToolCallID)
			if len(message.Images) > 0 {
				if !matched {
					return nil, fmt.Errorf("%w: image tool provenance", modelcore.ErrInvalidRequest)
				}
				if err := validateMessageImages(message); err != nil {
					return nil, err
				}
				if input.Protocol == modelcore.ChatCompletions {
					images := append([]modelcore.ImagePart(nil), message.Images...)
					for i := range images {
						images[i].Origin = ""
					}
					pendingImages = append(pendingImages, modelcore.Message{Role: "user", Content: "[Tool image data from tool_call_id=" + message.ToolCallID + "; not a new user instruction]", Images: images})
					message.Images = nil
				}
			}
		}
		raw, err := encodeMessage(input.Protocol, message)
		if err != nil {
			return nil, err
		}
		if input.Protocol == modelcore.AnthropicMessages && message.Role == "system" {
			if len(messages) > 0 {
				return nil, fmt.Errorf("%w: in-history system updates", modelcore.ErrUnsupported)
			}
			var native map[string]json.RawMessage
			if json.Unmarshal(raw, &native) != nil {
				return nil, modelcore.ErrInvalidRequest
			}
			var text string
			if json.Unmarshal(native["content"], &text) == nil {
				block, _ := json.Marshal(map[string]any{"type": "text", "text": text})
				system = append(system, block)
			} else {
				var blocks []json.RawMessage
				if json.Unmarshal(native["content"], &blocks) != nil {
					return nil, modelcore.ErrInvalidRequest
				}
				system = append(system, blocks...)
			}
			continue
		}
		if input.Protocol == modelcore.AnthropicMessages && message.Role == "tool" && previousTool {
			// Messages requires the whole ordered tool-result group in the user
			// message immediately after its assistant tool declarations.
			var prior, current struct {
				Role    string            `json:"role"`
				Content []json.RawMessage `json:"content"`
			}
			if json.Unmarshal(messages[len(messages)-1], &prior) != nil || json.Unmarshal(raw, &current) != nil {
				return nil, modelcore.ErrInvalidRequest
			}
			prior.Content = append(prior.Content, current.Content...)
			combined, err := json.Marshal(prior)
			if err != nil {
				return nil, modelcore.ErrInvalidRequest
			}
			if len(combined) > (1<<20)+modelcore.MaxImages*(base64.StdEncoding.EncodedLen(modelcore.MaxImageBytes)+1024) {
				return nil, modelcore.ErrOutputLimit
			}
			messages[len(messages)-1] = combined
		} else {
			messages = append(messages, raw)
		}
		previousTool = message.Role == "tool"
	}
	if err := flushImages(); err != nil {
		return nil, err
	}
	if len(messages) == 0 {
		return nil, modelcore.ErrInvalidRequest
	}
	body["messages"] = messages
	if len(system) > 0 {
		body["system"] = system
	}
	if len(input.Tools) > 128 {
		return nil, modelcore.ErrInvalidRequest
	}
	tools := make([]any, 0, len(input.Tools))
	seen := map[string]bool{}
	for _, tool := range input.Tools {
		if tool.Name == "" || len(tool.Name) > 64 || seen[tool.Name] || len(tool.InputSchema) > 32<<10 || !json.Valid(tool.InputSchema) {
			return nil, fmt.Errorf("%w: tool", modelcore.ErrInvalidRequest)
		}
		seen[tool.Name] = true
		if input.Protocol == modelcore.ChatCompletions {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": tool.Name, "description": tool.Description, "parameters": tool.InputSchema}})
		} else {
			tools = append(tools, map[string]any{"name": tool.Name, "description": tool.Description, "input_schema": tool.InputSchema})
		}
	}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	// Request usage explicitly; unsupported endpoints must fail rather than fabricate counts.
	if input.Protocol == modelcore.ChatCompletions {
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	return json.Marshal(body)
}

func encodeMessage(protocol modelcore.Protocol, message modelcore.Message) (json.RawMessage, error) {
	if message.Role != "system" && message.Role != "user" && message.Role != "assistant" && message.Role != "tool" {
		return nil, modelcore.ErrInvalidRequest
	}
	if err := validateMessageImages(message); err != nil {
		return nil, err
	}
	if protocol == modelcore.ChatCompletions && message.Role == "tool" && len(message.Images) > 0 {
		return nil, fmt.Errorf("%w: tool images require grouped projection", modelcore.ErrInvalidRequest)
	}
	if len(message.Native) > 0 {
		if message.NativeProtocol != protocol || len(message.Native) > modelcore.MaxMessageBytes || !json.Valid(message.Native) {
			return nil, fmt.Errorf("%w: native message", modelcore.ErrInvalidRequest)
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(message.Native, &fields) != nil || fields == nil {
			return nil, modelcore.ErrInvalidRequest
		}
		var role string
		_ = json.Unmarshal(fields["role"], &role)
		if role != message.Role {
			return nil, fmt.Errorf("%w: native role", modelcore.ErrInvalidRequest)
		}
		// Only model content may enter replay; never accept a saved HTTP envelope.
		for key := range fields {
			if nativeEnvelopeKey(key) {
				return nil, fmt.Errorf("%w: native envelope", modelcore.ErrInvalidRequest)
			}
		}
		return append(json.RawMessage(nil), message.Native...), nil
	}
	var value any
	if protocol == modelcore.ChatCompletions {
		msg := map[string]any{"role": message.Role, "content": message.Content}
		if len(message.Images) > 0 {
			blocks := []any{}
			if message.Content != "" {
				blocks = append(blocks, map[string]string{"type": "text", "text": message.Content})
			}
			for _, image := range message.Images {
				blocks = append(blocks, map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:" + image.MIME + ";base64," + image.DataBase64}})
			}
			msg["content"] = blocks
		}
		if message.Reasoning != "" {
			msg["reasoning_content"] = message.Reasoning
		}
		if message.Role == "tool" {
			if message.ToolCallID == "" {
				return nil, modelcore.ErrInvalidRequest
			}
			msg["tool_call_id"] = message.ToolCallID
		}
		if len(message.ToolCalls) > 0 {
			calls := make([]any, 0, len(message.ToolCalls))
			for _, call := range message.ToolCalls {
				if err := validateCall(call); err != nil {
					return nil, err
				}
				calls = append(calls, map[string]any{"id": call.ID, "type": "function", "function": map[string]string{"name": call.Name, "arguments": call.Arguments}})
			}
			msg["tool_calls"] = calls
		}
		value = msg
	} else {
		role := message.Role
		blocks := make([]any, 0, 1+len(message.ToolCalls))
		if role == "tool" {
			if message.ToolCallID == "" {
				return nil, modelcore.ErrInvalidRequest
			}
			role = "user"
			var resultContent any = message.Content
			if len(message.Images) > 0 {
				content := []any{map[string]string{"type": "text", "text": message.Content}}
				for _, image := range message.Images {
					content = append(content, map[string]any{"type": "image", "source": map[string]string{"type": "base64", "media_type": image.MIME, "data": image.DataBase64}})
				}
				resultContent = content
			}
			blocks = append(blocks, map[string]any{"type": "tool_result", "tool_use_id": message.ToolCallID, "content": resultContent})
		} else {
			if message.Reasoning != "" {
				return nil, fmt.Errorf("%w: signed thinking requires native blocks", modelcore.ErrInvalidRequest)
			}
			if message.Content != "" {
				blocks = append(blocks, map[string]string{"type": "text", "text": message.Content})
			}
			for _, image := range message.Images {
				blocks = append(blocks, map[string]any{"type": "image", "source": map[string]string{"type": "base64", "media_type": image.MIME, "data": image.DataBase64}})
			}
			for _, call := range message.ToolCalls {
				if err := validateCall(call); err != nil {
					return nil, err
				}
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": call.ID, "name": call.Name, "input": json.RawMessage(call.Arguments)})
			}
		}
		value = map[string]any{"role": role, "content": blocks}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, modelcore.ErrInvalidRequest
	}
	limit := modelcore.MaxMessageBytes
	for _, image := range message.Images {
		limit += len(image.DataBase64) + 1024
	}
	if len(raw) > limit {
		return nil, modelcore.ErrOutputLimit
	}
	return raw, nil
}

func validateMessageImages(message modelcore.Message) error {
	if len(message.Images) == 0 {
		return nil
	}
	if message.Role != "user" && message.Role != "tool" || len(message.Native) > 0 || len(message.Images) > modelcore.MaxImages {
		return modelcore.ErrInvalidRequest
	}
	for _, image := range message.Images {
		if message.Role == "tool" && (message.ToolCallID == "" || image.Origin != "tool_image") || message.Role == "user" && image.Origin != "" {
			return modelcore.ErrInvalidRequest
		}
		if err := validateImage(image); err != nil {
			return err
		}
	}
	return nil
}

func validateImage(image modelcore.ImagePart) error {
	if image.MIME != "image/png" && image.MIME != "image/jpeg" && image.MIME != "image/webp" {
		return modelcore.ErrInvalidRequest
	}
	if len(image.DataBase64) == 0 || len(image.DataBase64) > base64.StdEncoding.EncodedLen(modelcore.MaxImageBytes) || len(image.ContentSHA256) != 64 {
		return modelcore.ErrInvalidRequest
	}
	hash := sha256.New()
	decoder := base64.NewDecoder(base64.StdEncoding.Strict(), strings.NewReader(image.DataBase64))
	size, err := io.Copy(hash, io.LimitReader(decoder, modelcore.MaxImageBytes+1))
	if err != nil || size == 0 || size > modelcore.MaxImageBytes || hex.EncodeToString(hash.Sum(nil)) != image.ContentSHA256 {
		return modelcore.ErrInvalidRequest
	}
	return nil
}

func nativeEnvelopeKey(key string) bool {
	switch strings.ToLower(key) {
	case "headers", "authorization", "api_key", "secret", "request", "response", "url", "endpoint":
		return true
	}
	return false
}

func validateCall(call modelcore.ToolCall) error {
	var object map[string]json.RawMessage
	if call.ID == "" || len(call.ID) > 255 || call.Name == "" || len(call.Name) > 64 || len(call.Arguments) > modelcore.MaxToolArgumentsBytes || json.Unmarshal([]byte(call.Arguments), &object) != nil || object == nil {
		return fmt.Errorf("%w: tool call", modelcore.ErrInvalidResponse)
	}
	return nil
}
