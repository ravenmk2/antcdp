package agents

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type conversationMemory struct {
	historyMemory
	ConversationRepository
	cache *ConversationProjectionRow
	reads int
}

func (m *conversationMemory) ConversationProjection(uint64) (*ConversationProjectionRow, error) {
	return m.cache, nil
}
func (m *conversationMemory) SaveConversationProjection(row *ConversationProjectionRow) error {
	m.cache = row
	return nil
}
func (m *conversationMemory) InsertEvent(row *EventRow) error {
	m.rows = append(m.rows, *row)
	return nil
}
func (m *conversationMemory) Events(id, after, through uint64, limit int, descending bool) ([]EventRow, error) {
	m.reads++
	return m.historyMemory.Events(id, after, through, limit, descending)
}
func (m *conversationMemory) SurfaceEvents(id, after, through uint64, limit int) ([]EventRow, error) {
	return m.Events(id, after, through, limit, false)
}

func TestConversationCheckpointReplayRecoveryAndImmutableState(t *testing.T) {
	m := &conversationMemory{}
	v := &SessionRow{ID: 1}
	run := uint64(7)
	for _, event := range []struct {
		kind string
		data string
	}{
		{"run/started", `{"run_id":"7"}`},
		{"assistant/message", `{"step_no":1,"content":[]}`},
		{"tool/call", `{"tool_call_id":"8","tool_key":"update_plan"}`},
		{"tool/result", `{"tool_call_id":"8","status":"succeeded","content":[{"type":"text","text":"plan"}]}`},
		{"run/ended", `{"run_id":"7","status":"succeeded"}`},
		{"run/settled", `{"run_id":"7"}`},
	} {
		if _, err := appendEvent(m, v, &run, event.kind, "", json.RawMessage(event.data), nil, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	reads := m.reads
	want, err := loadConversationProjection(m, 1, v.LastSeq)
	if err != nil || m.reads != reads || want.LatestRun == nil || !want.LatestRun.Settled || len(want.LatestRun.Plan) == 0 {
		t.Fatal("checkpoint was not used", want, err)
	}
	cache := *m.cache
	for _, kind := range []string{"missing", "version", "checksum", "ahead"} {
		row := cache
		m.cache = &row
		switch kind {
		case "missing":
			m.cache = nil
		case "version":
			row.Version++
		case "checksum":
			row.Hash = []byte("bad")
		case "ahead":
			row.Through++
		}
		got, err := loadConversationProjection(m, 1, v.LastSeq)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatal(kind, "did not replay", got, err)
		}
	}
	next, err := FoldConversation(want, DurableRecord{Seq: 7, SchemaVersion: 1, Type: "run/state", Data: map[string]any{"run_id": "7", "status": "failed"}})
	if err != nil || next.LatestRun.Status != "failed" || want.LatestRun.Status != "succeeded" {
		t.Fatal("fold mutated preceding state", err)
	}
	if _, err = FoldConversation(want, DurableRecord{Seq: 8, SchemaVersion: 1, Type: "run/state", Data: map[string]any{}}); err == nil {
		t.Fatal("gap accepted")
	}
}

func TestDisplayEventsAndNamingLeaveModelRequestPrefixUnchanged(t *testing.T) {
	m := &conversationMemory{}
	v := &SessionRow{ID: 1}
	message := modelcore.Message{Role: "user", Content: "分析当前架构"}
	if _, err := appendEvent(m, v, nil, "input/message", "", map[string]any{"content": []any{}}, &StoredEvent{Message: &message}, time.Now()); err != nil {
		t.Fatal(err)
	}
	build := func() []byte {
		manifest, facts, err := loadSurface(m, v)
		if err != nil {
			t.Fatal(err)
		}
		messages, err := agentcore.BuildSurface(manifest, facts)
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := agentcore.BuildPreparedStep(agentcore.ExecutionRef{}, 1, agentcore.LockedModel{RemoteModelID: "test", Protocol: modelcore.ChatCompletions}, agentcore.PromptConfig{Platform: "stable system"}, manifest, messages, nil, 1)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := agentcore.CanonicalJSON(prepared.Request)
		if err != nil {
			t.Fatal(err)
		}
		return encoded
	}
	before := build()
	revision := v.SurfaceRevision
	if _, err := appendEvent(m, v, nil, "session/title", "", map[string]any{"configuration": map[string]string{"title": "架构分析"}}, nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := appendEvent(m, v, nil, "tool/state", "", map[string]string{"tool_call_id": "9", "status": "running"}, nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, build()) || v.SurfaceRevision != revision {
		t.Fatal("display metadata changed model context")
	}
}

func TestSummaryRequestPreservesSystemToolsAndNativePrefix(t *testing.T) {
	user := modelcore.Message{Role: "user", Content: "task"}
	assistant := modelcore.Message{Role: "assistant", Content: "answer", NativeProtocol: modelcore.AnthropicMessages, Native: json.RawMessage(`[{"type":"thinking","thinking":"reason","signature":"opaque-signature"},{"type":"text","text":"answer"}]`)}
	m := agentcore.SurfaceManifest{SchemaVersion: 1, Entries: []agentcore.SurfaceEntry{{Kind: "message", Sequences: []agentcore.Seq{1}}, {Kind: "message", Sequences: []agentcore.Seq{2}}}}
	facts := map[agentcore.Seq]agentcore.HistoryFact{1: {Seq: 1, SchemaVersion: 1, Kind: "input/message", Message: &user}, 2: {Seq: 2, SchemaVersion: 1, Kind: "assistant/message", Message: &assistant}}
	tools := []agentcore.ToolSpec{{Key: "z", Policy: "allow", Definition: modelcore.Tool{Name: "z", InputSchema: json.RawMessage(`{"properties":{},"type":"object"}`)}}, {Key: "a", Policy: "allow", Definition: modelcore.Tool{Name: "a", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}}}
	locked := agentcore.LockedModel{RemoteModelID: "test", Protocol: modelcore.AnthropicMessages}
	step, err := agentcore.BuildPreparedStep(agentcore.ExecutionRef{}, 1, locked, agentcore.PromptConfig{Platform: "stable system"}, m, []modelcore.Message{user, assistant}, tools, 1)
	if err != nil {
		t.Fatal(err)
	}
	tools[0], tools[1] = tools[1], tools[0]
	reordered, err := agentcore.BuildPreparedStep(agentcore.ExecutionRef{}, 2, locked, agentcore.PromptConfig{Platform: "stable system"}, m, []modelcore.Message{user, assistant}, tools, 1)
	if err != nil || !reflect.DeepEqual(step.Request, reordered.Request) {
		t.Fatal("tool discovery order changed prefix", err)
	}
	summary, err := summaryRequest(step.Request, m, facts, 0, 1)
	if err != nil || !reflect.DeepEqual(summary.Messages[:3], step.Request.Messages) || !reflect.DeepEqual(summary.Tools, step.Request.Tools) {
		t.Fatal("summary lost original prefix", err)
	}
}
