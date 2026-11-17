package agentcore

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestContextPressureTracksUsageAdditionsAndReplacement(t *testing.T) {
	counter := modelcore.RequestTokenCounter{}
	request := modelcore.Request{Model: "model", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "system", Content: "rules"}, {Role: "user", Content: strings.Repeat("history ", 1000)}}}
	estimate, _ := counter.Count(request)
	anchor := &ContextAnchor{Envelope: request, Estimated: estimate, Input: estimate + 500}
	request.Messages = append(append([]modelcore.Message{}, request.Messages...), modelcore.Message{Role: "assistant", Content: "reply"}, modelcore.Message{Role: "tool", Content: strings.Repeat("output ", 100)})
	measurement, err := MeasureContext(counter, request, anchor)
	if err != nil || measurement.Source != "usage_adjusted" || measurement.Tokens != measurement.Estimated+500 {
		t.Fatal(measurement, err)
	}
	request.Messages = []modelcore.Message{{Role: "system", Content: "rules"}, {Role: "user", Content: "summary"}}
	compressed, err := MeasureContext(counter, request, anchor)
	if err != nil || compressed.Tokens >= measurement.Tokens || compressed.Tokens != compressed.Estimated+500 {
		t.Fatal("replacement did not reduce pressure", compressed, err)
	}
	request.Messages[0].Content = "changed system rules"
	changed, err := MeasureContext(counter, request, anchor)
	if err != nil || changed.Source != "estimated" {
		t.Fatal("reused mismatched system anchor", changed, err)
	}
	request.Messages[0].Content = "rules"
	request.Tools = []modelcore.Tool{{Name: "new", InputSchema: json.RawMessage(`{}`)}}
	changed, err = MeasureContext(counter, request, anchor)
	if err != nil || changed.Source != "estimated" {
		t.Fatal("reused mismatched tools anchor", changed, err)
	}
	anchor.Input = 1
	changed, err = MeasureContext(counter, anchor.Envelope, anchor)
	if err != nil || changed.Source != "estimated" || changed.Tokens != estimate {
		t.Fatal("usage undercut estimated scale", changed, err)
	}
}

func TestContextBudgetUsesRequestOutputAndScalesHeadroom(t *testing.T) {
	model := LockedModel{ContextWindow: 1000000, MaxOutputTokens: 128000, Parameters: map[string]json.RawMessage{"max_output_tokens": json.RawMessage(`8192`)}}
	b, err := ResolveContextBudget(model)
	if err != nil || b.Output != 8192 || b.Threshold != 800000 || b.Retain != (1000000-8192)*16/100 || b.Headroom != 65536 {
		t.Fatal(b, err)
	}
	model.ContextWindow, model.MaxOutputTokens, model.Parameters = 8192, 1024, nil
	b, err = ResolveContextBudget(model)
	if err != nil || b.Threshold == 0 || b.Headroom >= b.Limit || b.Retain >= b.Threshold {
		t.Fatal("small model exhausted by fixed headroom", b, err)
	}
	model.MaxOutputTokens = 8192
	if _, err = ResolveContextBudget(model); err == nil {
		t.Fatal("invalid input budget accepted")
	}
}

func TestCompactionCanReduceSingleLongTaskWithoutLosingInstruction(t *testing.T) {
	manifest := SurfaceManifest{SchemaVersion: 1, Revision: 1}
	facts := map[Seq]HistoryFact{}
	for i := 1; i <= 9; i++ {
		seq := Seq(i)
		role, kind := "assistant", "assistant/message"
		if i == 1 {
			role, kind = "user", "input/message"
		}
		message := modelcore.Message{Role: role, Content: strings.Repeat("completed evidence ", 100)}
		facts[seq] = HistoryFact{Seq: seq, Kind: kind, SchemaVersion: 1, Message: &message}
		manifest.Entries = append(manifest.Entries, SurfaceEntry{Kind: "message", Sequences: []Seq{seq}})
	}
	first, last, err := CompactionTokenRange(manifest, facts, 1000, modelcore.RequestTokenCounter{})
	if err != nil || first != 1 || last < first || last >= len(manifest.Entries)-1 {
		t.Fatal("long task not compactable", first, last, err)
	}
	// Complete tool calls and results form a single retained entry even when
	// that entry alone exceeds the requested tail budget.
	call := modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "c", Name: "read", Arguments: `{}`}}}
	result := modelcore.Message{Role: "tool", ToolCallID: "c", Content: strings.Repeat("large result", 1000)}
	facts[10] = HistoryFact{Seq: 10, Kind: "assistant/message", SchemaVersion: 1, Message: &call, ModelCallID: 1}
	facts[11] = HistoryFact{Seq: 11, Kind: "tool/result", SchemaVersion: 1, Message: &result, ToolCallID: "c", ModelCallID: 1}
	manifest.Entries = append(manifest.Entries, SurfaceEntry{Kind: "tool_group", Sequences: []Seq{10, 11}})
	_, last, err = CompactionTokenRange(manifest, facts, 1, modelcore.RequestTokenCounter{})
	if err != nil || last != 8 {
		t.Fatal("split newest tool group", last, err)
	}
	manifest.Entries[len(manifest.Entries)-1].Sequences = []Seq{10}
	if _, err := BuildSurface(manifest, facts); err == nil {
		t.Fatal("incomplete group allowed in model request")
	}
	if _, err := SurfaceForMeasurement(manifest, facts); err != nil {
		t.Fatal("cannot price committed pending tool declaration", err)
	}
}
