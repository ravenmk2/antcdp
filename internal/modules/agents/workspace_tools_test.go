package agents

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

func TestWorkspaceToolPathsStayWithinPublicData(t *testing.T) {
	for raw, want := range map[string]string{"": "sessions/11", ".": "sessions/11", "note.txt": "sessions/11/note.txt", "/data/storage/note.txt": "storage/note.txt", "/data": "."} {
		got, err := workspaceToolPath("/data/sessions/11", raw)
		if err != nil || got != want {
			t.Fatalf("%q => %q %v", raw, got, err)
		}
	}
	for _, raw := range []string{"../other", "/etc/passwd", "/data/../etc", "/data/.system/staging/a", "/data/.system/skills/1/a", "x\\y", "/data/workspace/../../x"} {
		if _, err := workspaceToolPath("/data/sessions/11", raw); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
}

func TestWorkspaceReadOutputKeepsValidJSONAndContinuation(t *testing.T) {
	data := []byte(strings.Repeat("\x01", 32768))
	raw, _ := json.Marshal(map[string]any{"path": "sessions/11/note.txt", "data_base64": base64.StdEncoding.EncodeToString(data), "offset": 0, "next_offset": len(data), "size_bytes": "32768", "has_more": false, "identity": strings.Repeat("a", 64)})
	text, err := workspaceToolContent("read_file", raw)
	if err != nil || len(text) > 60<<10 || !json.Valid([]byte(text)) {
		t.Fatalf("bounded output: %v %d", err, len(text))
	}
	var result struct {
		Text string `json:"text"`
		Next int    `json:"next_offset"`
		More bool   `json:"has_more"`
	}
	if json.Unmarshal([]byte(text), &result) != nil || result.Next != len(result.Text) || result.Next >= len(data) || !result.More {
		t.Fatalf("continuation: %#v", result)
	}
	data = []byte("报告😀")
	raw, _ = json.Marshal(map[string]any{"path": "a", "data_base64": base64.StdEncoding.EncodeToString(data[:len(data)-1]), "offset": 0, "next_offset": len(data) - 1, "size_bytes": "100", "has_more": true})
	text, err = workspaceToolContent("read_file", raw)
	if err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal([]byte(text), &result) != nil || result.Text != "报告" || result.Next != 6 {
		t.Fatalf("UTF8 boundary: %s", text)
	}
}

func TestWorkspaceSearchOutputBoundsWholeRecords(t *testing.T) {
	matches := make([]workspacefs.Match, 200)
	for i := range matches {
		matches[i] = workspacefs.Match{Path: strings.Repeat("x", 1024), Line: i + 1, Text: strings.Repeat("\x01", 2048)}
	}
	raw, _ := json.Marshal(map[string]any{"paths": []string{}, "matches": matches, "truncated": false, "visited_entries": 500})
	text, err := workspaceToolContent("grep", raw)
	if err != nil || len(text) > 60<<10 || !json.Valid([]byte(text)) {
		t.Fatalf("bounded result: %v", err)
	}
	var result struct {
		Matches   []workspacefs.Match `json:"matches"`
		Truncated bool                `json:"truncated"`
	}
	_ = json.Unmarshal([]byte(text), &result)
	if len(result.Matches) == 0 || len(result.Matches) >= len(matches) || !result.Truncated {
		t.Fatalf("result was not explicitly truncated")
	}
}

func TestWorkspaceToolRejectsEncodedOversizeBeforeDispatch(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"path": "a", "content": strings.Repeat("中", 32768)})
	if _, _, err := workspaceToolRequest("write_file", raw); err == nil {
		t.Fatal("accepted oversized UTF-8 bytes")
	}
	for _, raw := range []string{`{"path":"a","old_text":"","new_text":"b"}`, `{"path":"a","old_text":"x","new_text":"b","unexpected":true}`, `{"path":"a","old_text":"x","new_text":"b"}{}`} {
		if _, _, err := workspaceToolRequest("edit_file", []byte(raw)); err == nil {
			t.Fatal("accepted invalid edit")
		}
	}
}

func TestWorkspaceSearchPathsRoundTripThroughRead(t *testing.T) {
	result, err := workspaceToolContent("glob", json.RawMessage(`{"paths":["sessions/11/workspace/note.md"],"matches":[],"truncated":false,"visited_entries":2}`))
	if err != nil {
		t.Fatal(err)
	}
	var found struct {
		Paths []string `json:"paths"`
	}
	if json.Unmarshal([]byte(result), &found) != nil || len(found.Paths) != 1 {
		t.Fatal(result)
	}
	name, err := workspaceToolPath("/data/sessions/11/workspace", found.Paths[0])
	if err != nil || name != "sessions/11/workspace/note.md" {
		t.Fatalf("tool path did not round trip: %q %v", name, err)
	}
}
