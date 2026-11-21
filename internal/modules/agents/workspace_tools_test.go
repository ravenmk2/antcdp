package agents

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
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

func TestWorkspaceSearchOutputBoundsWholeRecords(t *testing.T) {
	matches := make([]workspace.Match, 200)
	for i := range matches {
		matches[i] = workspace.Match{Line: i + 1, Text: strings.Repeat("\x01", 2048)}
	}
	raw, _ := json.Marshal(map[string]any{"paths": []string{}, "groups": []workspace.MatchGroup{{Path: strings.Repeat("x", 1024), Lines: matches}}, "truncated": false, "visited_entries": 500})
	text, err := workspaceToolContent("grep", raw)
	if err != nil || len(text) > 60<<10 || !json.Valid([]byte(text)) {
		t.Fatalf("bounded result: %v", err)
	}
	var result struct {
		Groups    []workspace.MatchGroup `json:"groups"`
		Truncated bool                   `json:"truncated"`
	}
	_ = json.Unmarshal([]byte(text), &result)
	if len(result.Groups) != 1 || len(result.Groups[0].Lines) == 0 || len(result.Groups[0].Lines) >= len(matches) || !result.Truncated {
		t.Fatalf("result was not explicitly truncated")
	}
}

func TestWorkspaceToolRejectsEncodedOversizeBeforeDispatch(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"file_path": "a", "content": strings.Repeat("中", 32768)})
	if _, _, err := workspaceToolRequest("write", raw); err == nil {
		t.Fatal("accepted oversized UTF-8 bytes")
	}
	for _, raw := range []string{`{"file_path":"a","old_string":"","new_string":"b"}`, `{"file_path":"a","old_string":"x","new_string":"b","unexpected":true}`, `{"file_path":"a","old_string":"x","new_string":"b"}{}`} {
		if _, _, err := workspaceToolRequest("edit", []byte(raw)); err == nil {
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
