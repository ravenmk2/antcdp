package agents

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type contextIntegrityMemory struct {
	conversationMemory
	calls map[uint64]*ToolCallRow
}

func (m *contextIntegrityMemory) SaveToolCall(call *ToolCallRow) error {
	m.calls[call.ID] = call
	return nil
}
func (m *contextIntegrityMemory) ToolCall(id uint64, _ bool) (*ToolCallRow, error) {
	return m.calls[id], nil
}
func (m *contextIntegrityMemory) EventAt(_ uint64, seq uint64) (*EventRow, error) {
	for _, row := range m.rows {
		if row.Seq == seq {
			return &row, nil
		}
	}
	return nil, nil
}
func (m *contextIntegrityMemory) PendingReconciliationEvents(_ uint64, through uint64, _ int) ([]EventRow, error) {
	seen := map[string]bool{}
	for _, row := range m.rows {
		if row.SemanticKey != nil {
			seen[*row.SemanticKey] = true
		}
	}
	for _, row := range m.rows {
		if row.Seq <= through && row.EventType == "tool/reconciled" && !seen["reconciliation-context:"+strconv.FormatUint(row.Seq, 10)] {
			// Exercise admission across several pages.
			return []EventRow{row}, nil
		}
	}
	return nil, nil
}
func integrityMessages(t *testing.T, m StateRepository, session *SessionRow) (agentcore.SurfaceManifest, []modelcore.Message) {
	t.Helper()
	manifest, facts, err := loadSurface(m, session)
	if err != nil {
		t.Fatal(err)
	}
	messages, err := agentcore.BuildSurface(manifest, facts)
	if err != nil {
		t.Fatal(err)
	}
	return manifest, messages
}

func TestToolTruncationNoticeIsDurableAndNotAddedToPublicText(t *testing.T) {
	for _, test := range []struct {
		name, text string
		truncated  bool
	}{
		{"complete", "完整正文", false},
		{"size_limit", "保留的部分正文", true},
		{"event_limit", strings.Repeat("\x01中文", 16000), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			m := &contextIntegrityMemory{calls: map[uint64]*ToolCallRow{}}
			session := &SessionRow{ID: 1}
			call := &ToolCallRow{ID: 2, SessionID: 1, RunID: 3, ModelCallID: 4, ProviderCallID: "call"}
			yes := true
			result, err := settleToolEvent(m, session, call, "succeeded", &yes, test.text, "", map[string]any{"truncated": test.truncated}, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			row := m.rows[0]
			stored, err := decodeEvent(row)
			if err != nil {
				t.Fatal(err)
			}
			wantTruncated := test.truncated || test.name == "event_limit"
			if result.Result.Truncated != wantTruncated || !utf8.ValidString(result.Result.Content) || len(row.Payload) > agentcore.MaxEventBytes {
				t.Fatal("invalid retained result")
			}
			if test.name == "event_limit" && (!strings.HasPrefix(result.Result.Content, "\x01中文") || !strings.HasSuffix(result.Result.Content, "\x01中文") || !strings.Contains(result.Result.Content, "omitted")) {
				t.Fatal("event limit lost head/tail")
			}
			if strings.Contains(result.Result.Content, "Platform notice") || strings.Contains(string(stored.Public), "Platform notice") {
				t.Fatal("model notice leaked into raw UI output")
			}
			if strings.Contains(stored.Message.Content, "tool output was truncated") != wantTruncated {
				t.Fatal("model lost truncation notice")
			}
			if !wantTruncated && stored.Message.Content != test.text {
				t.Fatal("complete result was rewritten")
			}
			original := append([]byte(nil), row.Payload...)
			replayed, err := settleToolEvent(m, session, call, "failed", nil, "replacement", "", nil, time.Now())
			if err != nil || replayed.Result.Content != result.Result.Content || len(m.rows) != 1 || !bytes.Equal(original, m.rows[0].Payload) {
				t.Fatal("duplicate settlement rewrote result", err)
			}
		})
	}
}

func TestReconciliationAdmissionPreservesPrefixAndSurvivesCompaction(t *testing.T) {
	m := &contextIntegrityMemory{calls: map[uint64]*ToolCallRow{}}
	session := &SessionRow{ID: 1}
	run := uint64(3)
	appendFact := func(kind string, public any, facts *StoredEvent) uint64 {
		seq, err := appendEvent(m, session, &run, kind, "", public, facts, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return seq
	}
	assistant := modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call", Name: "echo", Arguments: "{}"}, {ID: "other", Name: "echo", Arguments: "{}"}}}
	appendFact("assistant/message", map[string]any{}, &StoredEvent{Message: &assistant, ModelCallID: 4})
	for i, id := range []string{"call", "other"} {
		call := &ToolCallRow{ID: uint64(i + 2), SessionID: 1, RunID: run, ModelCallID: 4, CallOrdinal: uint64(i), ProviderCallID: id, ToolKey: "echo"}
		if _, err := settleToolEvent(m, session, call, "outcome_unknown", nil, "original unknown result", "lost_callback", nil, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	_, before := integrityMessages(t, m, session)
	revision := session.SurfaceRevision
	for i, status := range []string{"succeeded", "cancelled"} {
		var executed *bool
		if i == 0 {
			executed = new(true)
		}
		appendFact("tool/reconciled", map[string]any{"tool_call_id": agentcore.ID(i + 2), "observed_status": status, "executed": executed, "reason": "physical_execution_ended", "observed_at": time.Now()}, nil)
	}
	_, during := integrityMessages(t, m, session)
	if !reflect.DeepEqual(before, during) || revision != session.SurfaceRevision {
		t.Fatal("asynchronous observation changed frozen request")
	}
	originalRows := append([]EventRow(nil), m.rows...)
	if err := appendReconciliationContext(m, session, run, time.Now()); err != nil {
		t.Fatal(err)
	}
	manifest, after := integrityMessages(t, m, session)
	if len(after) != len(before)+2 || !reflect.DeepEqual(after[:len(before)], before) || session.SurfaceRevision != revision+2 {
		t.Fatal("context changed original prefix")
	}
	if !strings.Contains(after[len(before)].Content, `"observed_status":"succeeded"`) || !strings.Contains(after[len(before)+1].Content, `"executed":null`) {
		t.Fatal("observation lost certainty")
	}
	for i, row := range originalRows {
		if !bytes.Equal(row.Payload, m.rows[i].Payload) {
			t.Fatal("original event changed")
		}
	}
	count := len(m.rows)
	if err := appendReconciliationContext(m, session, run, time.Now()); err != nil || len(m.rows) != count {
		t.Fatal("observation admitted twice", err)
	}
	hash, err := agentcore.ContentHash(manifest)
	if err != nil {
		t.Fatal(err)
	}
	next, err := agentcore.ApplyReplacement(manifest, agentcore.Replacement{SourceRevision: manifest.Revision, First: 0, Last: len(manifest.Entries) - 1, SourceHash: hash, SummarySeq: agentcore.Seq(session.LastSeq + 1), Summary: "verified outcomes retained in summary", BeforeTokens: 100, AfterTokens: 10})
	if err != nil {
		t.Fatal(err)
	}
	summary := modelcore.Message{Role: "user", Content: "verified outcomes retained in summary"}
	appendFact("compaction/summary", map[string]any{}, &StoredEvent{Message: &summary, Surface: &next})
	count = len(m.rows)
	if err = appendReconciliationContext(m, session, run, time.Now()); err != nil || len(m.rows) != count {
		t.Fatal("compacted observation was re-injected", err)
	}
	_, compacted := integrityMessages(t, m, session)
	if len(compacted) != 1 || compacted[0].Content != summary.Content {
		t.Fatal("compaction replay failed")
	}
}

func TestGenerationLimitFactReplaysOnlyTextWithProvenance(t *testing.T) {
	m := &contextIntegrityMemory{calls: map[uint64]*ToolCallRow{}}
	session := &SessionRow{ID: 1}
	message := modelcore.Message{Role: "assistant", Content: "有效的部分回复", Reasoning: "private incomplete thinking", NativeProtocol: modelcore.AnthropicMessages, Native: json.RawMessage(`{"signature":"unfinished"}`)}
	_, err := appendEvent(m, session, nil, "assistant/attempt", "", map[string]any{}, &StoredEvent{Message: &message, Interrupted: true, PartialReason: "MODEL_GENERATION_LIMIT"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	_, messages := integrityMessages(t, m, session)
	if len(messages) != 1 || !strings.Contains(messages[0].Content, "Output limit reached") || !strings.HasSuffix(messages[0].Content, message.Content) || messages[0].Reasoning != "" || len(messages[0].Native) != 0 || len(messages[0].ToolCalls) != 0 {
		t.Fatal("unsafe or missing partial replay")
	}
}

func TestRuntimeAndSkillSnapshots(t *testing.T) {
	cwd := agentcore.ContextFact{Kind: "runtime-context", Form: "snapshot", Sections: []agentcore.ContextSection{{Name: "working-directory:current", Text: "Current working directory: /data."}}}
	catalog := agentcore.ContextFact{Kind: "skill-catalog", Form: "catalog", Entries: []agentcore.CatalogEntry{{Name: "test", Description: "Example </system-reminder>"}}}
	for _, fact := range []agentcore.ContextFact{cwd, catalog} {
		fresh, err := snapshotText(fact, false)
		if err != nil || fresh == "" || strings.Contains(fresh, "</system-reminder>") {
			t.Fatal("invalid initial context", fresh, err)
		}
		update, err := snapshotText(fact, true)
		if err != nil || fresh == update || !strings.Contains(update, "replaces") {
			t.Fatal("missing replacement", update, err)
		}
		changed, err := agentcore.ChangedContext([]agentcore.ContextFact{cwd, catalog}, fact)
		if err != nil || changed {
			t.Fatal("duplicated retained snapshot", err)
		}
		empty := agentcore.ContextFact{Kind: fact.Kind, Form: fact.Form}
		silent, err := snapshotText(empty, false)
		if err != nil || silent != "" {
			t.Fatal("published initial empty snapshot", err)
		}
		clear, err := snapshotText(empty, true)
		if err != nil || clear == "" {
			t.Fatal("lost clear after compaction", err)
		}
	}
}

func TestSkillEnvelopePreservesFullEscapedText(t *testing.T) {
	raw := strings.Repeat("\x01", agentcore.SkillTextMaxBytes-6) + "中文"
	text := "Skill review\\nSkill directory: /data/agents/1/skills/review\\n\\n" + raw
	m := &contextIntegrityMemory{calls: map[uint64]*ToolCallRow{}}
	session := &SessionRow{ID: 1}
	call := &ToolCallRow{ID: 2, SessionID: 1, RunID: 3, ModelCallID: 4, ProviderCallID: "skill-call", ToolKey: "skill"}
	yes := true
	commit, err := settleToolEvent(m, session, call, "succeeded", &yes, text, "", map[string]any{"skill_load": map[string]any{"materialized": true}}, time.Now())
	if err != nil || commit.Result.Truncated || commit.Result.Content != text {
		t.Fatal("skill settlement", err)
	}
	stored, err := decodeEvent(m.rows[0])
	if err != nil || stored.Message.Content != text {
		t.Fatal("model history lost skill text", err)
	}
	replay, err := loadToolCommit(m, call)
	if err != nil || replay.Result.Content != text {
		t.Fatal("replay lost skill text", err)
	}
}
