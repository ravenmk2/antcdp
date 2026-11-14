package modeladapters

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// Change this version when the digest inputs or wire projection change. Replay
// metadata is deliberately excluded; hashing it would invalidate later turns.
const thinkingPrefixVersion = "antcdp/anthropic-prefix/v1:"

func prefixChain(previous string, raw json.RawMessage) (string, error) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return "", modelcore.ErrInvalidRequest
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", modelcore.ErrInvalidRequest
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte(previous))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(canonical)
	return thinkingPrefixVersion + hex.EncodeToString(hash.Sum(nil)), nil
}

// Match DSH's manual-thinking exception: only the assistant immediately before
// the trailing tool results keeps its thinking even when the prefix changed.
func openThinkingRound(input modelcore.Request) int {
	var thinking struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(input.Parameters["thinking"], &thinking) != nil || thinking.Type != "enabled" {
		return -1
	}
	results := 0
	for i := len(input.Messages) - 1; i >= 0; i-- {
		switch input.Messages[i].Role {
		case "tool":
			results++
		case "assistant":
			if results > 0 {
				return i
			}
			return -1
		default:
			return -1
		}
	}
	return -1
}

// Work on the actual Messages wire shape, after system extraction, image
// hydration and tool-result grouping. Original event/native bytes stay intact.
func encodeBoundRequest(provider modelcore.ProviderType, input modelcore.Request) ([]byte, string, error) {
	raw, err := encodeUnboundRequest(provider, input)
	if err != nil || input.Protocol != modelcore.AnthropicMessages {
		return raw, "", err
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(raw, &body) != nil {
		return nil, "", modelcore.ErrInvalidRequest
	}
	head, err := json.Marshal(map[string]json.RawMessage{"system": body["system"], "tools": body["tools"]})
	if err != nil {
		return nil, "", err
	}
	digest, err := prefixChain(thinkingPrefixVersion, head)
	if err != nil {
		return nil, "", err
	}
	var messages []json.RawMessage
	if json.Unmarshal(body["messages"], &messages) != nil {
		return nil, "", modelcore.ErrInvalidRequest
	}
	assistants := []int{}
	for i, message := range input.Messages {
		if message.Role == "assistant" {
			assistants = append(assistants, i)
		}
	}
	kept, assistant := openThinkingRound(input), 0
	changed := false
	sent := make([]json.RawMessage, 0, len(messages))
	for _, message := range messages {
		var fields struct {
			Role string `json:"role"`
		}
		if json.Unmarshal(message, &fields) != nil {
			return nil, "", modelcore.ErrInvalidRequest
		}
		if fields.Role == "assistant" {
			if assistant >= len(assistants) {
				return nil, "", modelcore.ErrInvalidRequest
			}
			index := assistants[assistant]
			assistant++
			if index != kept && input.Messages[index].PrefixDigest != digest {
				var removed bool
				message, removed, err = omitSignedThinking(message)
				if err != nil {
					return nil, "", err
				}
				changed = changed || removed
				if len(message) == 0 {
					continue
				}
			}
		}
		sent = append(sent, message)
		digest, err = prefixChain(digest, message)
		if err != nil {
			return nil, "", err
		}
	}
	if !changed {
		return raw, digest, nil
	}
	if len(sent) == 0 {
		return nil, "", fmt.Errorf("%w: no messages after thinking replay filtering", modelcore.ErrInvalidRequest)
	}
	body["messages"], err = json.Marshal(sent)
	if err != nil {
		return nil, "", err
	}
	raw, err = json.Marshal(body)
	return raw, digest, err
}

func omitSignedThinking(raw json.RawMessage) (json.RawMessage, bool, error) {
	var message map[string]json.RawMessage
	if json.Unmarshal(raw, &message) != nil {
		return nil, false, modelcore.ErrInvalidRequest
	}
	var blocks []json.RawMessage
	if json.Unmarshal(message["content"], &blocks) != nil {
		var text string
		if json.Unmarshal(message["content"], &text) == nil {
			return raw, false, nil
		}
		return nil, false, modelcore.ErrInvalidRequest
	}
	kept := make([]json.RawMessage, 0, len(blocks))
	for _, block := range blocks {
		var fields struct {
			Type      string `json:"type"`
			Signature string `json:"signature"`
		}
		if json.Unmarshal(block, &fields) != nil {
			return nil, false, modelcore.ErrInvalidRequest
		}
		if fields.Type != "redacted_thinking" && (fields.Type != "thinking" || fields.Signature == "") {
			kept = append(kept, block)
		}
	}
	if len(kept) == len(blocks) {
		return raw, false, nil
	}
	if len(kept) == 0 {
		return nil, true, nil
	}
	var err error
	message["content"], err = json.Marshal(kept)
	if err != nil {
		return nil, false, err
	}
	filtered, err := json.Marshal(message)
	return filtered, true, err
}
