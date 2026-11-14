package agentcore

import (
	"reflect"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestImageOffloadIsOccurrenceScopedAndPreservesToolGroup(t *testing.T) {
	image := modelcore.ImagePart{MIME: "image/png", ContentSHA256: strings.Repeat("a", 64)}
	toolImage := image
	toolImage.Origin = "tool_image"
	user := modelcore.Message{Role: "user", Content: "original", Images: []modelcore.ImagePart{image, image}}
	assistant := modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "read", Name: "read_image", Arguments: `{}`}}}
	tool := modelcore.Message{Role: "tool", ToolCallID: "read", Content: "/data/original.png", Images: []modelcore.ImagePart{toolImage}}
	facts := map[Seq]HistoryFact{1: {Seq: 1, SchemaVersion: 1, Kind: "input/message", Message: &user}, 2: {Seq: 2, SchemaVersion: 1, Kind: "assistant/message", ModelCallID: 9, Message: &assistant}, 3: {Seq: 3, SchemaVersion: 1, Kind: "tool/result", ModelCallID: 9, ToolCallID: "read", Message: &tool}}
	manifest := SurfaceManifest{SchemaVersion: 1, Entries: []SurfaceEntry{{Kind: "message", Sequences: []Seq{1}}, {Kind: "tool_group", Sequences: []Seq{2, 3}}}, ImageOffloads: []ImageOffload{{Seq: 1, Index: 0, SHA256: image.ContentSHA256}}}
	before, _ := ContentHash(facts)
	messages, err := BuildSurface(manifest, facts)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 || len(messages[0].Images) != 1 || len(messages[2].Images) != 1 || !reflect.DeepEqual(messages[1], assistant) || messages[2].ToolCallID != "read" {
		t.Fatal("group or new occurrence lost", messages)
	}
	after, _ := ContentHash(facts)
	if before != after || len(user.Images) != 2 {
		t.Fatal("immutable facts mutated")
	}
	if !strings.Contains(messages[0].Content, "Earlier image omitted") || !strings.Contains(messages[0].Content, image.ContentSHA256) {
		t.Fatal("missing truthful placeholder")
	}
	manifest.ImageOffloads[0].SHA256 = strings.Repeat("b", 64)
	if _, err = BuildSurface(manifest, facts); err == nil {
		t.Fatal("stale occurrence accepted")
	}
}
