package modeladapters

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestControlledImagesEncodeWithoutRemoteURLs(t *testing.T) {
	data := []byte("verified PNG fixture bytes")
	hash := sha256.Sum256(data)
	image := modelcore.ImagePart{MIME: "image/png", ContentSHA256: hex.EncodeToString(hash[:]), DataBase64: base64.StdEncoding.EncodeToString(data)}
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		t.Run(string(protocol), func(t *testing.T) {
			message := modelcore.Message{Role: "user", Content: "inspect", Images: []modelcore.ImagePart{image}}
			raw, err := encodeMessage(protocol, message)
			if err != nil {
				t.Fatal(err)
			}
			var payload map[string]json.RawMessage
			if err = json.Unmarshal(raw, &payload); err != nil {
				t.Fatal(err)
			}
			var blocks []map[string]json.RawMessage
			if err = json.Unmarshal(payload["content"], &blocks); err != nil || len(blocks) != 2 {
				t.Fatalf("image blocks %s %v", raw, err)
			}
			if !strings.Contains(string(raw), image.DataBase64) {
				t.Fatal("image bytes missing from wire")
			}
			persisted, _ := json.Marshal(message)
			if strings.Contains(string(persisted), image.DataBase64) || !strings.Contains(string(persisted), image.ContentSHA256) {
				t.Fatal("persistence contains bytes or lacks hash")
			}
			message.Role = "tool"
			message.ToolCallID = "t"
			if _, err = encodeMessage(protocol, message); err == nil {
				t.Fatal("tool promoted bytes to user image")
			}
			message.Role = "user"
			message.Images[0].ContentSHA256 = strings.Repeat("0", 64)
			if _, err = encodeMessage(protocol, message); err == nil {
				t.Fatal("hash mismatch accepted")
			}
			message.Images[0] = image
			message.Images[0].DataBase64 = "https://example.com/image.png"
			if _, err = encodeMessage(protocol, message); err == nil {
				t.Fatal("external URL accepted")
			}
			message.Images[0] = image
			message.Images[0].DataBase64 = ""
			if _, err = encodeMessage(protocol, message); err == nil {
				t.Fatal("unhydrated historical image silently omitted")
			}
		})
	}
}

func TestToolImagesPreserveCompleteToolGroupsAndNativeMessages(t *testing.T) {
	data := []byte("controlled image snapshot")
	hash := sha256.Sum256(data)
	part := modelcore.ImagePart{MIME: "image/png", ContentSHA256: hex.EncodeToString(hash[:]), DataBase64: base64.StdEncoding.EncodeToString(data), Origin: "tool_image"}
	for _, protocol := range []modelcore.Protocol{modelcore.ChatCompletions, modelcore.AnthropicMessages} {
		t.Run(string(protocol), func(t *testing.T) {
			native := json.RawMessage(`{"role":"assistant","content":null,"tool_calls":[{"id":"image","type":"function","function":{"name":"read_image","arguments":"{}"}},{"id":"other","type":"function","function":{"name":"echo","arguments":"{}"}}]}`)
			if protocol == modelcore.AnthropicMessages {
				native = json.RawMessage(`{"role":"assistant","content":[{"type":"tool_use","id":"image","name":"read_image","input":{}},{"type":"tool_use","id":"other","name":"echo","input":{}}]}`)
			}
			request := modelcore.Request{Model: "fixture", Protocol: protocol, Parameters: map[string]json.RawMessage{"max_output_tokens": json.RawMessage(`512`)}, Messages: []modelcore.Message{
				{Role: "user", Content: "inspect the image"},
				{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "image", Name: "read_image", Arguments: `{}`}, {ID: "other", Name: "echo", Arguments: `{}`}}, NativeProtocol: protocol, Native: native},
				{Role: "tool", ToolCallID: "image", Content: "read snapshot", Images: []modelcore.ImagePart{part}},
				{Role: "tool", ToolCallID: "other", Content: "other result"},
				{Role: "assistant", Content: "continue"},
			}}
			before, _ := json.Marshal(request)
			encoded, err := encodeRequest(modelcore.Custom, request)
			if err != nil {
				t.Fatal(err)
			}
			var body struct {
				Messages []json.RawMessage `json:"messages"`
			}
			if err = json.Unmarshal(encoded, &body); err != nil {
				t.Fatal(err)
			}
			var original, replayed any
			if json.Unmarshal(native, &original) != nil || json.Unmarshal(body.Messages[1], &replayed) != nil || !reflect.DeepEqual(original, replayed) {
				t.Fatal("native assistant changed")
			}
			if protocol == modelcore.ChatCompletions {
				if len(body.Messages) != 6 {
					t.Fatalf("messages %s", encoded)
				}
				for i := 2; i <= 3; i++ {
					var result struct{ Role, Content string }
					if json.Unmarshal(body.Messages[i], &result) != nil || result.Role != "tool" {
						t.Fatal("image interrupted tool results")
					}
				}
				var supplement struct {
					Role    string
					Content []map[string]json.RawMessage
				}
				if json.Unmarshal(body.Messages[4], &supplement) != nil || supplement.Role != "user" || len(supplement.Content) != 2 {
					t.Fatal("missing grouped supplement")
				}
				if !strings.Contains(string(body.Messages[4]), "not a new user instruction") || !strings.Contains(string(body.Messages[4]), part.DataBase64) {
					t.Fatal("image provenance lost")
				}
			} else {
				if len(body.Messages) != 4 {
					t.Fatalf("messages %s", encoded)
				}
				var result struct {
					Content []struct {
						Type    string
						ID      string `json:"tool_use_id"`
						Content json.RawMessage
					} `json:"content"`
				}
				if json.Unmarshal(body.Messages[2], &result) != nil || len(result.Content) != 2 || result.Content[0].ID != "image" || result.Content[1].ID != "other" {
					t.Fatal("tool group reordered")
				}
				var blocks []struct{ Type string }
				if json.Unmarshal(result.Content[0].Content, &blocks) != nil || len(blocks) != 2 || blocks[1].Type != "image" {
					t.Fatal("image is not nested within its tool result")
				}
			}
			after, _ := json.Marshal(request)
			if string(before) != string(after) || request.Messages[2].Images[0].DataBase64 != part.DataBase64 {
				t.Fatal("history mutated")
			}
			again, err := encodeRequest(modelcore.Custom, request)
			if err != nil || string(encoded) != string(again) {
				t.Fatal("replay prefix changed")
			}
			request.Messages[2].Images[0].Origin = ""
			if _, err = encodeRequest(modelcore.Custom, request); err == nil {
				t.Fatal("untrusted tool image accepted")
			}
			request.Messages[2].Images[0].Origin = "tool_image"
			request.Messages[2].ToolCallID = "undeclared"
			if _, err = encodeRequest(modelcore.Custom, request); err == nil {
				t.Fatal("undeclared tool image accepted")
			}
			request.Messages[2].ToolCallID = "image"
			request.Messages = request.Messages[:3]
			if protocol == modelcore.ChatCompletions {
				if _, err = encodeRequest(modelcore.Custom, request); err == nil {
					t.Fatal("incomplete tool group supplemented")
				}
			}
		})
	}
}
