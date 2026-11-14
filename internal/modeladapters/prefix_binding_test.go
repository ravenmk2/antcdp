package modeladapters

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func prefixRequest() modelcore.Request {
	request := testRequest(modelcore.AnthropicMessages)
	request.Messages = append([]modelcore.Message{{Role: "system", Content: "stable system"}}, request.Messages...)
	request.Tools = []modelcore.Tool{{Name: "echo", Description: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)}}
	return request
}

func boundPrefix(t *testing.T, request modelcore.Request) ([]byte, string) {
	t.Helper()
	raw, digest, err := encodeBoundRequest(modelcore.Custom, request)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(digest, thinkingPrefixVersion) || len(digest) != len(thinkingPrefixVersion)+64 {
		t.Fatal("missing versioned prefix digest", digest)
	}
	return raw, digest
}

func prefixReply(t *testing.T, request modelcore.Request, name string, tool bool) modelcore.Message {
	t.Helper()
	_, digest := boundPrefix(t, request)
	blocks := []any{
		map[string]string{"type": "thinking", "thinking": "reasoning " + name, "signature": "signature-" + name},
		map[string]string{"type": "redacted_thinking", "data": "redacted-" + name},
		map[string]string{"type": "text", "text": "answer " + name},
	}
	message := modelcore.Message{Role: "assistant", Content: "answer " + name, Reasoning: "reasoning " + name, NativeProtocol: modelcore.AnthropicMessages, PrefixDigest: digest}
	if tool {
		message.ToolCalls = []modelcore.ToolCall{{ID: "call-" + name, Name: "echo", Arguments: `{}`}}
		blocks = append(blocks, map[string]any{"type": "tool_use", "id": "call-" + name, "name": "echo", "input": map[string]any{}, "cache_control": map[string]string{"type": "ephemeral"}})
	}
	message.Native, _ = json.Marshal(map[string]any{"role": "assistant", "content": blocks, "provider_extension": "keep"})
	return message
}

func prefixResult(name, text string) modelcore.Message {
	return modelcore.Message{Role: "tool", ToolCallID: "call-" + name, Content: text}
}

func assertThinking(t *testing.T, wire []byte, name string, present bool) {
	t.Helper()
	for _, fragment := range []string{"signature-" + name, "redacted-" + name} {
		if bytes.Contains(wire, []byte(fragment)) != present {
			t.Fatalf("%s presence should be %v: %s", fragment, present, wire)
		}
	}
}

func TestThinkingPrefixTracksPruningCompactionAndNewReplies(t *testing.T) {
	request := prefixRequest()
	first := prefixReply(t, request, "first", true)
	request.Messages = append(request.Messages, first, prefixResult("first", "large output"))
	second := prefixReply(t, request, "second", true)
	request.Messages = append(request.Messages, second, prefixResult("second", "result"))
	original, _ := json.Marshal(request)
	unchanged, _ := boundPrefix(t, request)
	assertThinking(t, unchanged, "first", true)
	assertThinking(t, unchanged, "second", true)
	if bytes.Contains(unchanged, []byte("prefix_digest")) || bytes.Contains(unchanged, []byte(thinkingPrefixVersion)) {
		t.Fatal("local metadata leaked to provider")
	}
	request.Messages[3].Content = "pruned output"
	pruned, _ := boundPrefix(t, request)
	assertThinking(t, pruned, "first", true)
	assertThinking(t, pruned, "second", false)
	request.Messages[1].Content = "compacted summary"
	third := prefixReply(t, request, "third", false)
	request.Messages = append(request.Messages, third, modelcore.Message{Role: "user", Content: "continue"})
	compacted, _ := boundPrefix(t, request)
	assertThinking(t, compacted, "first", false)
	assertThinking(t, compacted, "second", false)
	assertThinking(t, compacted, "third", true)
	for _, retained := range []string{"answer first", "answer second", "call-first", "call-second", "cache_control", "provider_extension"} {
		if !bytes.Contains(compacted, []byte(retained)) {
			t.Fatal("lost non-thinking content", retained)
		}
	}
	if !strings.Contains(string(first.Native), "signature-first") || first.PrefixDigest == "" {
		t.Fatal("source message mutated")
	}
	var restored modelcore.Request
	if json.Unmarshal(original, &restored) != nil {
		t.Fatal("restore failed")
	}
	replayed, _ := boundPrefix(t, restored)
	if !bytes.Equal(unchanged, replayed) {
		t.Fatal("JSON replay changed valid prefix")
	}
}

func TestThinkingPrefixInvalidationBoundaries(t *testing.T) {
	for _, change := range []string{"system", "tools", "history", "missing", "unknown_version", "parameters", "display_projection", "object_order"} {
		t.Run(change, func(t *testing.T) {
			request := prefixRequest()
			request.Tools[0].InputSchema = json.RawMessage(`{"type":"object","properties":{}}`)
			message := prefixReply(t, request, "old", false)
			request.Messages = append(request.Messages, message, modelcore.Message{Role: "user", Content: "next"})
			keep := false
			switch change {
			case "system":
				request.Messages[0].Content = "changed system"
			case "tools":
				request.Tools[0].Description = "changed tool"
			case "history":
				request.Messages[1].Content = "replacement summary"
			case "missing":
				request.Messages[2].PrefixDigest = ""
			case "unknown_version":
				request.Messages[2].PrefixDigest = "future:" + message.PrefixDigest
			case "parameters":
				request.Parameters["max_output_tokens"] = json.RawMessage(`512`)
				keep = true
			case "display_projection":
				request.Messages[2].Content = "different display text"
				request.Messages[2].Reasoning = "different display reasoning"
				keep = true
			case "object_order":
				request.Tools[0].InputSchema = json.RawMessage(`{ "properties": {}, "type": "object" }`)
				keep = true
			}
			before, _ := json.Marshal(request)
			wire, digest := boundPrefix(t, request)
			assertThinking(t, wire, "old", keep)
			again, againDigest := boundPrefix(t, request)
			after, _ := json.Marshal(request)
			if digest != againDigest || !bytes.Equal(wire, again) || !bytes.Equal(before, after) {
				t.Fatal("retry or source changed during binding")
			}
		})
	}
}

func TestThinkingPrefixManualRoundException(t *testing.T) {
	for _, mode := range []string{"enabled", "adaptive", "disabled", "absent"} {
		t.Run(mode, func(t *testing.T) {
			request := prefixRequest()
			if mode != "absent" {
				request.Parameters["thinking"] = json.RawMessage(`{"type":"` + mode + `"}`)
			}
			first := prefixReply(t, request, "first", true)
			request.Messages = append(request.Messages, first, prefixResult("first", "result"))
			second := prefixReply(t, request, "second", true)
			second.PrefixDigest = "" // Legacy records follow the same exception.
			request.Messages = append(request.Messages, second, prefixResult("second", "result"))
			request.Messages[0].Content = "changed system"
			wire, _ := boundPrefix(t, request)
			assertThinking(t, wire, "first", false)
			assertThinking(t, wire, "second", mode == "enabled")
			request.Messages = append(request.Messages, modelcore.Message{Role: "user", Content: "new user or platform context"})
			wire, _ = boundPrefix(t, request)
			assertThinking(t, wire, "second", false)
		})
	}
}

func TestThinkingPrefixDropsEmptyMessagesAndRetainsUnsignedBlocks(t *testing.T) {
	request := prefixRequest()
	only := modelcore.Message{Role: "assistant", NativeProtocol: modelcore.AnthropicMessages, Native: json.RawMessage(`{"role":"assistant","content":[{"type":"thinking","thinking":"stale","signature":"old"},{"type":"redacted_thinking","data":"hidden"}]}`)}
	unsigned := modelcore.Message{Role: "assistant", NativeProtocol: modelcore.AnthropicMessages, Native: json.RawMessage(`{"role":"assistant","content":[{"type":"thinking","thinking":"unsigned","signature":""},{"type":"text","text":"reply"},{"type":"extension","data":"retained"}]}`)}
	request.Messages = append(request.Messages, only, modelcore.Message{Role: "user", Content: "next"}, unsigned)
	wire, _ := boundPrefix(t, request)
	var body struct{ Messages []json.RawMessage }
	if json.Unmarshal(wire, &body) != nil || len(body.Messages) != 3 || bytes.Contains(wire, []byte("stale")) || bytes.Contains(wire, []byte("hidden")) || !bytes.Contains(wire, []byte("unsigned")) || !bytes.Contains(wire, []byte("retained")) {
		t.Fatal("incorrect filtered contents", string(wire))
	}
	request.Messages = []modelcore.Message{only}
	if _, _, err := encodeBoundRequest(modelcore.Custom, request); err == nil {
		t.Fatal("empty request should fail before HTTP")
	}
}

func TestThinkingPrefixUsesImagesAndGroupedToolResults(t *testing.T) {
	request := prefixRequest()
	makeImage := func(data string) modelcore.ImagePart {
		hash := sha256.Sum256([]byte(data))
		return modelcore.ImagePart{MIME: "image/png", ContentSHA256: hex.EncodeToString(hash[:]), DataBase64: base64.StdEncoding.EncodeToString([]byte(data))}
	}
	request.Messages[1].Images = []modelcore.ImagePart{makeImage("first image")}
	first := prefixReply(t, request, "first", true)
	first.ToolCalls = append(first.ToolCalls, modelcore.ToolCall{ID: "other", Name: "echo", Arguments: `{}`})
	var native map[string]json.RawMessage
	_ = json.Unmarshal(first.Native, &native)
	var blocks []json.RawMessage
	_ = json.Unmarshal(native["content"], &blocks)
	blocks = append(blocks, json.RawMessage(`{"type":"tool_use","id":"other","name":"echo","input":{}}`))
	native["content"], _ = json.Marshal(blocks)
	first.Native, _ = json.Marshal(native)
	imageResult := prefixResult("first", "image result")
	imageResult.Images = []modelcore.ImagePart{makeImage("tool image")}
	imageResult.Images[0].Origin = "tool_image"
	request.Messages = append(request.Messages, first, imageResult, modelcore.Message{Role: "tool", ToolCallID: "other", Content: "second result"})
	second := prefixReply(t, request, "second", false)
	request.Messages = append(request.Messages, second, modelcore.Message{Role: "user", Content: "continue"})
	wire, _ := boundPrefix(t, request)
	assertThinking(t, wire, "first", true)
	assertThinking(t, wire, "second", true)
	request.Messages[3].Images[0] = makeImage("changed tool image")
	request.Messages[3].Images[0].Origin = "tool_image"
	wire, _ = boundPrefix(t, request)
	assertThinking(t, wire, "first", true)
	assertThinking(t, wire, "second", false)
	request.Messages[1].Images[0] = makeImage("changed user image")
	wire, _ = boundPrefix(t, request)
	assertThinking(t, wire, "first", false)
	assertThinking(t, wire, "second", false)
}

func TestThinkingPrefixDoesNotRoundLargeJSONNumbers(t *testing.T) {
	request := prefixRequest()
	request.Tools[0].InputSchema = json.RawMessage(`{"type":"object","maximum":9007199254740992}`)
	_, first := boundPrefix(t, request)
	request.Tools[0].InputSchema = json.RawMessage(`{"type":"object","maximum":9007199254740993}`)
	_, second := boundPrefix(t, request)
	if first == second {
		t.Fatal("distinct tool schemas collapsed to the same prefix")
	}
}

func TestThinkingPrefixClientPersistsActualSentPrefix(t *testing.T) {
	for _, protocol := range []modelcore.Protocol{modelcore.AnthropicMessages, modelcore.ChatCompletions} {
		t.Run(string(protocol), func(t *testing.T) {
			var captured [][]byte
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				captured = append(captured, body)
				w.Header().Set("Content-Type", "text/event-stream")
				stream := messagesToolStream
				if protocol == modelcore.ChatCompletions {
					stream = chatToolStream
				}
				_, _ = fmt.Fprint(w, stream)
			}))
			defer server.Close()
			client, err := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: protocol, BaseURL: server.URL, APIKey: "test"}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			request := testRequest(protocol)
			if protocol == modelcore.AnthropicMessages {
				request.Messages = append(request.Messages, modelcore.Message{Role: "assistant", NativeProtocol: protocol, Native: json.RawMessage(`{"role":"assistant","content":[{"type":"thinking","thinking":"stale","signature":"stale-signature"},{"type":"text","text":"old answer"}]}`)}, modelcore.Message{Role: "user", Content: "next"})
			}
			response, err := client.Generate(t.Context(), request, nil)
			if err != nil || (response.Message.PrefixDigest != "") != (protocol == modelcore.AnthropicMessages) {
				t.Fatal("incorrect prefix metadata", err)
			}
			encoded, _ := json.Marshal(response.Message)
			var restored modelcore.Message
			if json.Unmarshal(encoded, &restored) != nil {
				t.Fatal("replay failed")
			}
			request.Messages = append(request.Messages, restored, modelcore.Message{Role: "tool", ToolCallID: "call-1", Content: "result"})
			if _, err = client.Generate(t.Context(), request, nil); err != nil {
				t.Fatal(err)
			}
			if len(captured) != 2 || bytes.Contains(captured[1], []byte("prefix_digest")) || bytes.Contains(captured[1], []byte("stale-signature")) {
				t.Fatal("wrong wire metadata or stale history")
			}
			if protocol == modelcore.AnthropicMessages && !bytes.Contains(captured[1], []byte("opaque-signature")) {
				t.Fatal("response was bound to unfiltered instead of sent prefix")
			}
		})
	}
}
