package agents

import (
	"crypto/sha256"
	"encoding/json"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

type childObservationMemory struct {
	StateRepository
	rows  []ToolCallRow
	event EventRow
}

func (m childObservationMemory) RunTools(uint64) ([]ToolCallRow, error)    { return m.rows, nil }
func (m childObservationMemory) EventAt(uint64, uint64) (*EventRow, error) { return &m.event, nil }

func TestChildListSummaryUsesCommittedPublicResult(t *testing.T) {
	seq := uint64(12)
	raw, e := agentcore.CanonicalJSON(StoredEvent{Public: json.RawMessage(`{"child_result":{"run_id":"23","result_summary":"Committed child summary"}}`)})
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(raw)
	m := childObservationMemory{rows: []ToolCallRow{{ExecutionClass: "child", ResultEventSeq: &seq}}, event: EventRow{EventType: "tool/result", SchemaVersion: 1, Payload: raw, PayloadSizeBytes: uint64(len(raw)), PayloadSHA256: hash[:]}}
	out, e := childResultSummaries(m, 1)
	if e != nil {
		t.Fatal(e)
	}
	if out[23] == nil || *out[23] != "Committed child summary" {
		t.Fatalf("summary=%v", out)
	}
	m.event.PayloadSHA256[0] ^= 1
	if _, e = childResultSummaries(m, 1); e == nil {
		t.Fatal("corrupt result accepted")
	}
}

func TestModelCallMetadataProjectsStatusWithoutFabricatingRawCounters(t *testing.T) {
	input := uint64(20)
	for _, tc := range []struct{ internal, public string }{{"running", "streaming"}, {"completed", "succeeded"}, {"failed", "failed"}} {
		view, e := modelCallMetadata(ModelCallRow{Status: tc.internal, Thinking: json.RawMessage(`{"option_key":"standard"}`), InputTokens: &input, UsageRaw: json.RawMessage(`{"secret":"must-not-forward"}`)})
		if e != nil {
			t.Fatal(e)
		}
		if view["status"] != tc.public {
			t.Fatal("internal status exposed")
		}
		usage := view["usage"].(map[string]any)
		if len(usage["raw_numeric_fields"].(map[string]any)) != 0 {
			t.Fatal("invented raw provider facts")
		}
	}
}

func TestModelCallMetadataExposesOnlyWhitelistedActualRawCounters(t *testing.T) {
	view, e := modelCallMetadata(ModelCallRow{Protocol: "chat_completions", Status: "completed", Thinking: json.RawMessage(`{"option_key":"standard"}`), UsageRaw: json.RawMessage(`{"prompt_tokens":20,"prompt_cache_hit_tokens":12,"completion_tokens":null,"total_tokens":"27","prompt_cache_miss_tokens":-1,"secret":"never","nested":{"prompt_tokens":42}}`)})
	if e != nil {
		t.Fatal(e)
	}
	raw := view["usage"].(map[string]any)["raw_numeric_fields"].(map[string]any)
	if len(raw) != 2 || raw["prompt_tokens"] != "20" || raw["prompt_cache_hit_tokens"] != "12" {
		t.Fatalf("unsafe raw projection: %v", raw)
	}
}
