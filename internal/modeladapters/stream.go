package modeladapters

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// readSSE bounds both an individual frame and the whole attempt, including
// ignored comments. A terminal protocol marker is required by each decoder.
func readSSE(ctx context.Context, reader io.Reader, handle func([]byte) (bool, error)) error {
	scanner := bufio.NewScanner(io.LimitReader(reader, (8<<20)+1))
	scanner.Buffer(make([]byte, 4096), modelcore.MaxMessageBytes+1024)
	var data bytes.Buffer
	flush := func() (bool, error) {
		if data.Len() == 0 {
			return false, nil
		}
		raw := bytes.TrimSuffix(data.Bytes(), []byte("\n"))
		done, err := handle(raw)
		data.Reset()
		return done, err
	}
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line := scanner.Text()
		if line == "" {
			done, err := flush()
			if err != nil || done {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			part := strings.TrimPrefix(line, "data:")
			part = strings.TrimPrefix(part, " ")
			if data.Len()+len(part)+1 > modelcore.MaxMessageBytes {
				return modelcore.ErrOutputLimit
			}
			data.WriteString(part)
			data.WriteByte('\n')
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if scanner.Err() != nil {
		return transportError(scanner.Err())
	}
	if data.Len() > 0 {
		done, err := flush()
		if err != nil || done {
			return err
		}
	}
	return modelcore.ErrIncompleteStream
}

func rawString(raw json.RawMessage) (string, error) {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", modelcore.ErrInvalidResponse
	}
	return s, nil
}
func appendString(fields map[string]json.RawMessage, key string, fragment string) error {
	previous := ""
	if raw, ok := fields[key]; ok && string(raw) != "null" {
		var err error
		previous, err = rawString(raw)
		if err != nil {
			return err
		}
	}
	raw, _ := json.Marshal(previous + fragment)
	fields[key] = raw
	return nil
}
func putStable(fields map[string]json.RawMessage, key string, raw json.RawMessage) error {
	if previous, ok := fields[key]; ok && !bytes.Equal(previous, raw) {
		return fmt.Errorf("%w: unsupported changing field", modelcore.ErrUnsupported)
	}
	fields[key] = append(json.RawMessage(nil), raw...)
	return nil
}
func mergeUsage(u *modelcore.Usage, raw json.RawMessage, protocol modelcore.Protocol) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return
	}
	u.RawNumericFields = modelcore.FilterRawUsage(protocol, u.RawNumericFields)
	for _, path := range modelcore.RawUsageFields(protocol) {
		parts := strings.Split(path, ".")
		value := fields[parts[0]]
		for _, part := range parts[1:] {
			var object map[string]json.RawMessage
			if json.Unmarshal(value, &object) != nil {
				value = nil
				break
			}
			value = object[part]
		}
		var count int64
		if len(value) > 0 && string(value) != "null" && json.Unmarshal(value, &count) == nil && count >= 0 {
			u.RawNumericFields[path] = count
		}
	}
	counter := func(key string) *int64 {
		value, ok := u.RawNumericFields[key]
		if !ok {
			return nil
		}
		return &value
	}
	switch protocol {
	case modelcore.ChatCompletions:
		u.InputTokens = counter("prompt_tokens")
		u.OutputTokens = counter("completion_tokens")
		u.CacheReadTokens = counter("prompt_cache_hit_tokens")
		if cached := counter("prompt_tokens_details.cached_tokens"); cached != nil {
			u.CacheReadTokens = cached
		}
		u.NormalizationVersion = "chat-completions-v1"
	case modelcore.AnthropicMessages:
		// Messages reports uncached input separately. Normalize total input when
		// all cache counters are known, otherwise leave total unknown.
		input := counter("input_tokens")
		read := counter("cache_read_input_tokens")
		write := counter("cache_creation_input_tokens")
		u.CacheReadTokens = read
		u.CacheWriteTokens = write
		u.OutputTokens = counter("output_tokens")
		u.InputTokens = nil
		if input != nil && read != nil && write != nil && *input <= math.MaxInt64-*read && *input+*read <= math.MaxInt64-*write {
			total := *input + *read + *write
			u.InputTokens = &total
		}
		u.NormalizationVersion = "messages-v1-total-input"
	}
}

type chatCall struct {
	fields   map[string]json.RawMessage
	function map[string]json.RawMessage
	block    int
}

func decodeChat(ctx context.Context, reader io.Reader, emit modelcore.Emit) (modelcore.Response, error) {
	result := modelcore.Response{}
	fields := map[string]json.RawMessage{"role": json.RawMessage(`"assistant"`)}
	var calls []*chatCall
	blockByKind := map[string]int{}
	nextBlock := 0
	finished := false
	blockFor := func(kind string) int {
		if n, ok := blockByKind[kind]; ok {
			return n
		}
		n := nextBlock
		nextBlock++
		blockByKind[kind] = n
		return n
	}
	err := readSSE(ctx, reader, func(data []byte) (bool, error) {
		if string(data) == "[DONE]" {
			if !finished {
				return false, modelcore.ErrIncompleteStream
			}
			return true, nil
		}
		var frame struct {
			Error   json.RawMessage `json:"error"`
			Model   string          `json:"model"`
			Usage   json.RawMessage `json:"usage"`
			Choices []struct {
				Index  int                        `json:"index"`
				Delta  map[string]json.RawMessage `json:"delta"`
				Finish *string                    `json:"finish_reason"`
			} `json:"choices"`
		}
		if json.Unmarshal(data, &frame) != nil || len(frame.Error) > 0 {
			return false, modelcore.ErrInvalidResponse
		}
		if frame.Model != "" {
			if len(frame.Model) > 255 || strings.ContainsAny(frame.Model, "\r\n\x00") || (result.ReturnedModel != "" && result.ReturnedModel != frame.Model) {
				return false, modelcore.ErrInvalidResponse
			}
			result.ReturnedModel = frame.Model
		}
		mergeUsage(&result.Usage, frame.Usage, modelcore.ChatCompletions)
		if len(frame.Choices) == 0 {
			return false, nil
		}
		if len(frame.Choices) != 1 || frame.Choices[0].Index != 0 {
			return false, modelcore.ErrUnsupported
		}
		choice := frame.Choices[0]
		if finished {
			return false, modelcore.ErrInvalidResponse
		}
		keys := make([]string, 0, len(choice.Delta))
		for key := range choice.Delta {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if nativeEnvelopeKey(key) {
				return false, modelcore.ErrInvalidResponse
			}
			raw := choice.Delta[key]
			switch key {
			case "content", "reasoning_content", "refusal":
				if string(raw) == "null" {
					continue
				}
				fragment, e := rawString(raw)
				if e != nil {
					return false, e
				}
				if e = appendString(fields, key, fragment); e != nil {
					return false, e
				}
				kind := "text"
				if key == "reasoning_content" {
					kind = "reasoning"
					result.Message.Reasoning += fragment
				} else {
					result.Message.Content += fragment
				}
				if e = emit(modelcore.Delta{Kind: kind, BlockIndex: blockFor(key), Text: fragment}); e != nil {
					return false, e
				}
			case "tool_calls":
				var fragments []map[string]json.RawMessage
				if json.Unmarshal(raw, &fragments) != nil {
					return false, modelcore.ErrInvalidResponse
				}
				for _, fragment := range fragments {
					var index int
					if json.Unmarshal(fragment["index"], &index) != nil || index < 0 || index > len(calls) {
						return false, modelcore.ErrInvalidResponse
					}
					if index == len(calls) {
						calls = append(calls, &chatCall{fields: map[string]json.RawMessage{}, function: map[string]json.RawMessage{}, block: nextBlock})
						nextBlock++
						if e := emit(modelcore.Delta{Kind: "tool_call", BlockIndex: calls[index].block, DraftCallID: "draft-" + strconv.Itoa(index)}); e != nil {
							return false, e
						}
					}
					call := calls[index]
					for field, value := range fragment {
						if field == "index" {
							continue
						}
						if field != "function" {
							if e := putStable(call.fields, field, value); e != nil {
								return false, e
							}
							continue
						}
						var fn map[string]json.RawMessage
						if json.Unmarshal(value, &fn) != nil {
							return false, modelcore.ErrInvalidResponse
						}
						for k, v := range fn {
							if k == "name" || k == "arguments" {
								text, e := rawString(v)
								if e != nil {
									return false, e
								}
								if e = appendString(call.function, k, text); e != nil {
									return false, e
								}
								if k == "arguments" {
									if e = emit(modelcore.Delta{Kind: "tool_call", BlockIndex: call.block, DraftCallID: "draft-" + strconv.Itoa(index), Text: text}); e != nil {
										return false, e
									}
								}
							} else if e := putStable(call.function, k, v); e != nil {
								return false, e
							}
						}
					}
				}
			default:
				if e := putStable(fields, key, raw); e != nil {
					return false, e
				}
			}
		}
		if choice.Finish != nil {
			finished = true
			result.FinishReason = *choice.Finish
		}
		encoded, _ := json.Marshal(fields)
		size := len(encoded)
		for _, call := range calls {
			f, _ := json.Marshal(call.function)
			size += len(f)
		}
		if size > modelcore.MaxMessageBytes {
			return false, modelcore.ErrOutputLimit
		}
		return false, nil
	})
	if err != nil {
		return result, err
	}
	if result.FinishReason != "stop" && result.FinishReason != "tool_calls" {
		return result, modelcore.ErrIncompleteStream
	}
	if len(calls) == 0 && result.Message.Content == "" && result.Message.Reasoning == "" {
		return result, modelcore.ErrInvalidResponse
	}
	if role, e := rawString(fields["role"]); e != nil || role != "assistant" {
		return result, modelcore.ErrInvalidResponse
	}
	if len(calls) > 0 {
		seenIDs := map[string]bool{}
		nativeCalls := make([]map[string]json.RawMessage, 0, len(calls))
		for index, call := range calls {
			kind, err := rawString(call.fields["type"])
			if err != nil || kind != "function" {
				return result, modelcore.ErrInvalidResponse
			}
			id, _ := rawString(call.fields["id"])
			name, _ := rawString(call.function["name"])
			args, _ := rawString(call.function["arguments"])
			value := modelcore.ToolCall{ID: id, Name: name, Arguments: args}
			if seenIDs[id] {
				return result, modelcore.ErrInvalidResponse
			}
			seenIDs[id] = true
			if e := validateCall(value); e != nil {
				return result, e
			}
			result.Message.ToolCalls = append(result.Message.ToolCalls, value)
			fn, _ := json.Marshal(call.function)
			call.fields["function"] = fn
			nativeCalls = append(nativeCalls, call.fields)
			if e := emit(modelcore.Delta{Kind: "tool_call", BlockIndex: call.block, DraftCallID: "draft-" + strconv.Itoa(index), Name: name}); e != nil {
				return result, e
			}
		}
		raw, _ := json.Marshal(nativeCalls)
		fields["tool_calls"] = raw
	}
	if _, ok := fields["content"]; !ok {
		fields["content"] = json.RawMessage("null")
	}
	raw, _ := json.Marshal(fields)
	if len(raw) > modelcore.MaxMessageBytes {
		return result, modelcore.ErrOutputLimit
	}
	result.Message.Role = "assistant"
	result.Message.NativeProtocol = modelcore.ChatCompletions
	result.Message.Native = raw
	return result, nil
}
