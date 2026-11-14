package agents

import (
	"crypto/sha256"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type historyMemory struct {
	StateRepository
	ObservationRepository
	rows   []EventRow
	ranges []SequenceRange
}

func (m *historyMemory) Events(_ uint64, after, through uint64, limit int, desc bool) ([]EventRow, error) {
	out := []EventRow{}
	if desc {
		for i := len(m.rows) - 1; i >= 0; i-- {
			r := m.rows[i]
			if r.Seq > after && r.Seq <= through {
				out = append(out, r)
				if len(out) == limit {
					break
				}
			}
		}
	} else {
		for _, r := range m.rows {
			if r.Seq > after && r.Seq <= through {
				out = append(out, r)
				if len(out) == limit {
					break
				}
			}
		}
	}
	return out, nil
}
func (m *historyMemory) HistoryGroups(uint64, uint64, uint64) ([]SequenceRange, error) {
	return m.ranges, nil
}
func publicTestEvent(t *testing.T, seq uint64) EventRow {
	t.Helper()
	raw, e := agentcore.CanonicalJSON(StoredEvent{Public: json.RawMessage(`{"content":[{"type":"text","text":"visible"}]}`), Message: &modelcore.Message{Role: "assistant", Native: json.RawMessage(`{"opaque":"PRIVATE_NATIVE"}`)}})
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(raw)
	return EventRow{Seq: seq, SessionID: 1, EventType: "assistant/message", SchemaVersion: 1, Payload: raw, PayloadSizeBytes: uint64(len(raw)), PayloadSHA256: hash[:]}
}
func TestPublicHistoryPreservesGroupsAndNeverReturnsNative(t *testing.T) {
	m := &historyMemory{ranges: []SequenceRange{{From: 2, Through: 4}}}
	for n := uint64(1); n <= 6; n++ {
		m.rows = append(m.rows, publicTestEvent(t, n))
	}
	before := uint64(5)
	page, e := historyPage(m, m, &SessionRow{ID: 1, LastSeq: 6}, HistoryQuery{Before: &before, Limit: 1})
	if e != nil {
		t.Fatal(e)
	}
	if len(page.Records) != 3 || page.Records[0].Seq != 2 || page.Before == nil || *page.Before != 2 || !page.HasMore {
		t.Fatalf("split group: %+v", page)
	}
	raw, _ := json.Marshal(page)
	if strings.Contains(string(raw), "PRIVATE_NATIVE") || strings.Contains(string(raw), `"model"`) {
		t.Fatal("native disclosure")
	}
	bad := uint64(4)
	if _, e = historyPage(m, m, &SessionRow{ID: 1, LastSeq: 6}, HistoryQuery{Before: &bad, Limit: 1}); e == nil {
		t.Fatal("cursor bisected complete group")
	}
	through := uint64(2)
	if _, e = historyPage(m, m, &SessionRow{ID: 1, LastSeq: 6}, HistoryQuery{Through: &through, Limit: 1}); e == nil {
		t.Fatal("history cut bisected complete declaration group")
	}
	m.rows[1].Payload[0] = ' '
	if _, e = historyPage(m, m, &SessionRow{ID: 1, LastSeq: 6}, HistoryQuery{Before: &before, Limit: 1}); e == nil {
		t.Fatal("corrupt event accepted")
	}
}
func TestSnapshotBudgetDropsHistoryAndKeepsBackfillCursor(t *testing.T) {
	snapshot := ObservationSnapshot{SessionID: 1, Through: 9, Records: []DurableRecord{{Seq: 9, Data: strings.Repeat("x", 1200<<10)}}}
	stream := agentcore.StreamSnapshot{Epoch: "e", Active: &agentcore.ActiveStream{Content: []agentcore.StreamBlock{{Type: "text", Text: strings.Repeat("y", 950<<10)}}}}
	frame, e := TrimSnapshot(snapshot, stream, "main")
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(frame)
	if len(raw) > 2<<20 || frame["has_more"] != true {
		t.Fatal("snapshot exceeds budget or lost backfill")
	}
	if cursor := frame["before_seq"].(*agentcore.Seq); cursor == nil || *cursor != 10 {
		t.Fatal("bad empty-history cursor")
	}
}

func TestHistoryPagesInterleavedInputsAndLaterToolResultIndependently(t *testing.T) {
	m := &historyMemory{ranges: []SequenceRange{{From: 1, Through: 3}}}
	for seq := uint64(1); seq <= 45; seq++ {
		typeName := "input/received"
		if seq == 1 {
			typeName = "assistant/message"
		}
		if seq == 2 || seq == 3 {
			typeName = "tool/call"
		}
		if seq == 45 {
			typeName = "tool/result"
		}
		public, e := json.Marshal(map[string]any{"content": strings.Repeat("x", 32<<10), "tool_call_id": "1"})
		if e != nil {
			t.Fatal(e)
		}
		raw, e := agentcore.CanonicalJSON(StoredEvent{Public: public})
		if e != nil {
			t.Fatal(e)
		}
		hash := sha256.Sum256(raw)
		m.rows = append(m.rows, EventRow{Seq: seq, SessionID: 1, EventType: typeName, SchemaVersion: 1, Payload: raw, PayloadSizeBytes: uint64(len(raw)), PayloadSHA256: hash[:]})
	}
	var before *uint64
	seen := map[agentcore.Seq]bool{}
	for pages := 0; pages < 10; pages++ {
		page, e := historyPage(m, m, &SessionRow{ID: 1, LastSeq: 45}, HistoryQuery{Before: before, Limit: 200})
		if e != nil {
			t.Fatal(e)
		}
		wire, e := json.Marshal(page)
		if e != nil {
			t.Fatal(e)
		}
		if len(wire) > agentcore.MaxHistoryBytes || len(page.Records) == 0 {
			t.Fatal("unbounded or nonprogressing history")
		}
		for _, row := range page.Records {
			if seen[row.Seq] {
				t.Fatal("duplicate observation")
			}
			seen[row.Seq] = true
		}
		if !page.HasMore {
			break
		}
		before = page.Before
	}
	if len(seen) != 45 {
		t.Fatalf("lost queued input or result: %d records", len(seen))
	}
}
