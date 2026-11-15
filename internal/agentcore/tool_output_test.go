package agentcore

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestToolOutputHeadTailAndReplay(t *testing.T) {
	text := "START\n" + strings.Repeat("中文😀\n", 9000) + "\nERROR: final diagnostic"
	preview := HeadTail(text, ToolOutputInlineBytes, "\n[omitted]\n")
	if len(preview) > ToolOutputInlineBytes || !utf8.ValidString(preview) || !strings.HasPrefix(preview, "START") || !strings.HasSuffix(preview, "ERROR: final diagnostic") {
		t.Fatal("lost boundary or exceeded budget")
	}
	if HeadTail("short", 100, "gap") != "short" {
		t.Fatal("small result changed")
	}
	image := modelcore.ImagePart{MIME: "image/png", ContentSHA256: strings.Repeat("a", 64), Origin: "tool_image"}
	assistant := modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "tool", Name: "read_image", Arguments: `{}`}}}
	result := modelcore.Message{Role: "tool", ToolCallID: "tool", Content: preview, Images: []modelcore.ImagePart{image}}
	facts := map[Seq]HistoryFact{1: {Seq: 1, Kind: "assistant/message", SchemaVersion: 1, ModelCallID: 1, Message: &assistant}, 2: {Seq: 2, Kind: "tool/result", SchemaVersion: 1, ModelCallID: 1, ToolCallID: "tool", Message: &result}}
	manifest := SurfaceManifest{SchemaVersion: 1, Entries: []SurfaceEntry{{Kind: "tool_group", Sequences: []Seq{1, 2}}}, ToolOutputPrunes: []ToolOutputPrune{{Seq: 2, SHA256: ToolOutputHash(preview)}}}
	before, _ := ContentHash(facts)
	got, err := BuildSurface(manifest, facts)
	if err != nil || len(got) != 2 || len(got[1].Content) > 5120 || len(got[1].Images) != 1 || !reflect.DeepEqual(got[0], assistant) {
		t.Fatal("invalid projected group", err)
	}
	encoded, _ := json.Marshal(manifest)
	var restored SurfaceManifest
	if err = json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	again, err := BuildSurface(restored, facts)
	if err != nil || !reflect.DeepEqual(got, again) {
		t.Fatal("replay changed content", err)
	}
	after, _ := ContentHash(facts)
	if before != after {
		t.Fatal("immutable source mutated")
	}
	manifest.ImageOffloads = []ImageOffload{{Seq: 2, Index: 0, SHA256: image.ContentSHA256}}
	got, err = BuildSurface(manifest, facts)
	if err != nil || len(got[1].Images) != 0 || !strings.Contains(got[1].Content, "Earlier image omitted") {
		t.Fatal("image offload and pruning conflict", err)
	}
	manifest.ToolOutputPrunes[0].SHA256 = strings.Repeat("b", 64)
	if _, err = BuildSurface(manifest, facts); err == nil {
		t.Fatal("stale source accepted")
	}
}

func TestToolOutputPruningConverges(t *testing.T) {
	for _, text := range []string{"", strings.Repeat("x", 8192), strings.Repeat("界", 5000)} {
		got := PruneToolOutput(text)
		if !utf8.ValidString(got) || PruneToolOutput(got) != got {
			t.Fatal("unstable prune")
		}
	}
}
