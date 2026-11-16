package jobs

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestLogTruncationUsesEncodedBytes(t *testing.T) {
	message := strings.Repeat("\x00中", 10000)
	fields := map[string]json.RawMessage{"a": json.RawMessage(`"kept"`), "large": safeJSON(strings.Repeat("x", 1<<20)), "z": json.RawMessage(`42`)}
	got, raw := boundedLog(message, fields)
	encoded, err := json.Marshal(got)
	if err != nil || !utf8.ValidString(got) || len(encoded)+len(raw) > 16<<10 {
		t.Fatal("invalid encoded log size", len(encoded), len(raw), err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out["truncated"] != true || out["a"] != "kept" || out["z"] != float64(42) {
		t.Fatal("lost bounded fields or truncation marker", out, err)
	}
	if _, exists := out["large"]; exists {
		t.Fatal("oversized field retained")
	}
}
