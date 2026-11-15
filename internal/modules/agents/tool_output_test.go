package agents

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestToolOutputReadRangesSearchAndValidation(t *testing.T) {
	text := "头😀\nfirst\nERROR: tail"
	for _, input := range []ToolOutputRead{{Offset: 1, Limit: 1}, {Offset: 3, Limit: 2}, {Offset: 999, Limit: 10}, {Limit: 20, Query: "ERROR"}} {
		got := toolOutputSlice(text, input)
		if !utf8.ValidString(got) {
			t.Fatal("split UTF-8", got)
		}
	}
	if got := toolOutputSlice(text, ToolOutputRead{Limit: 20, Query: "ERROR"}); !strings.Contains(got, "ERROR: tail") || !strings.Contains(got, "has_more=false") {
		t.Fatal(got)
	}
	if got := toolOutputSlice(text, ToolOutputRead{Limit: 20, Query: "absent"}); !strings.Contains(got, "No literal match") {
		t.Fatal(got)
	}
	for _, raw := range []string{`{}`, `{"file_id":"1","offset":-1}`, `{"file_id":"1","limit":8193}`, `{"file_id":"1","path":"/etc/passwd"}`, `{"file_id":"1"} {}`} {
		if _, err := parseToolOutputRead(json.RawMessage(raw)); err == nil {
			t.Fatal("accepted invalid input", raw)
		}
	}
	if got, err := parseToolOutputRead(json.RawMessage(`{"file_id":"1"}`)); err != nil || got.Limit != 4096 {
		t.Fatal(got, err)
	}
}
