package agentcore

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestReasoningClockExcludesTextAndAccumulatesWindows(t *testing.T) {
	var clock reasoningClock
	start := time.Unix(0, 0)
	clock.start(0, start)
	if ms := clock.finish(start.Add(1500 * time.Millisecond)); ms == nil || *ms != 1500 {
		t.Fatal(ms)
	}
	if clock.finish(start.Add(10*time.Second)) != nil {
		t.Fatal("text time counted")
	}
	clock.start(0, start.Add(20*time.Second))
	if ms := clock.finish(start.Add(21 * time.Second)); ms == nil || *ms != 2500 {
		t.Fatal(ms)
	}
}

func TestReasoningTimingSurvivesStreamSnapshotAndFinalCommit(t *testing.T) {
	hub := NewHub("epoch")
	permit := AttemptPermit{Ref: ExecutionRef{SessionID: 1, RunID: 2, Epoch: "epoch"}, CallID: 3, Step: 1}
	if err := hub.Start(permit); err != nil {
		t.Fatal(err)
	}
	if hub.FinishReasoning(permit) != nil {
		t.Fatal("fabricated duration")
	}
	if err := hub.Emit(t.Context(), permit, modelcore.Delta{Kind: "reasoning", BlockIndex: 5, Text: "think"}); err != nil {
		t.Fatal(err)
	}
	hub.sessions[1].reasoning.started = time.Now().Add(-2500 * time.Millisecond)
	if err := hub.Emit(t.Context(), permit, modelcore.Delta{Kind: "text", BlockIndex: 9, Text: "answer"}); err != nil {
		t.Fatal(err)
	}
	sub, snapshot := hub.Subscribe(1)
	defer sub.Close()
	ms := snapshot.Active.Content[0].DurationMS
	if ms == nil || *ms < 2500 {
		t.Fatal("missing completed reasoning duration", ms)
	}
	if total := hub.FinishReasoning(permit); total == nil || *total != *ms {
		t.Fatal("timing changed during text output", total)
	}
	raw, err := json.Marshal(snapshot.Active.Content)
	if err != nil || !strings.Contains(string(raw), `"duration_ms":`) {
		t.Fatal(string(raw), err)
	}
	if snapshot.Active.Content[1].DurationMS != nil {
		t.Fatal("text marked as reasoning")
	}
	// A resumed reasoning window clears its completed timer until it closes again.
	if err := hub.Emit(t.Context(), permit, modelcore.Delta{Kind: "reasoning", BlockIndex: 5, Text: " more"}); err != nil {
		t.Fatal(err)
	}
	if hub.sessions[1].snapshot.Active.Content[0].DurationMS != nil {
		t.Fatal("stale duration")
	}
	if snapshot.Active.Content[0].DurationMS == nil {
		t.Fatal("snapshot mutated")
	}
}
