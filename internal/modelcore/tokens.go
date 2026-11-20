package modelcore

import (
	"encoding/json"
	"unicode/utf8"
)

// TextTokens is an estimate, never provider usage. ASCII prose/code uses four
// characters per token; other Unicode code points use one token rather than
// treating a UTF-8 byte as a token or underpricing CJK with the ASCII density.
func TextTokens(text string) uint64 {
	var ascii, other uint64
	for _, r := range text {
		if r < utf8.RuneSelf {
			ascii++
		} else {
			other++
		}
	}
	return (ascii+3)/4 + other
}

func jsonTokens(raw json.RawMessage) (uint64, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	return valueTokens(value), nil
}

func valueTokens(value any) uint64 {
	switch v := value.(type) {
	case string:
		return TextTokens(v) + 1
	case []any:
		var count uint64 = 2
		for _, item := range v {
			count += valueTokens(item)
		}
		return count
	case map[string]any:
		var count uint64 = 2
		for key, item := range v {
			count += TextTokens(key) + 1 + valueTokens(item)
		}
		return count
	default:
		return 1
	}
}

// EstimateRequestTokens prices model-visible content exactly once. Native is
// authoritative when present; local replay hashes, file IDs, hydration bytes,
// request settings and duplicate orchestration projections are not input text.
func EstimateRequestTokens(request Request) (uint64, error) {
	var count uint64
	if format := request.Parameters["response_format"]; format != nil {
		n, err := jsonTokens(format)
		if err != nil {
			return 0, err
		}
		count += n
	}
	for _, message := range request.Messages {
		count += 4
		if len(message.Native) > 0 {
			n, err := jsonTokens(message.Native)
			if err != nil {
				return 0, err
			}
			count += n
		} else {
			count += TextTokens(message.Content) + TextTokens(message.Reasoning)
			for _, call := range message.ToolCalls {
				count += 4 + TextTokens(call.Name) + TextTokens(call.Arguments)
			}
		}
		for _, image := range message.Images {
			count += EstimateImageTokens(image)
		}
	}
	for _, tool := range request.Tools {
		n, err := jsonTokens(tool.InputSchema)
		if err != nil {
			return 0, err
		}
		count += 4 + TextTokens(tool.Name) + TextTokens(tool.Description) + n
	}
	return count, nil
}

type RequestTokenCounter struct{}

func (RequestTokenCounter) Count(request Request) (uint64, error) {
	return EstimateRequestTokens(request)
}

// EffectiveOutputTokens resolves the actual request cap; fallback is the
// configured model cap when no request override exists.
func EffectiveOutputTokens(parameters map[string]json.RawMessage, fallback uint64) (uint64, error) {
	if raw, ok := parameters["max_output_tokens"]; ok {
		var n uint64
		if json.Unmarshal(raw, &n) != nil || n == 0 || fallback > 0 && n > fallback {
			return 0, ErrInvalidRequest
		}
		return n, nil
	}
	return fallback, nil
}
