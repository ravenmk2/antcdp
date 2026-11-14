package agentcore

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type compactionStub struct {
	committed, failed bool
	result            CompactionResult
}

func (*compactionStub) Begin(_ context.Context, r CompactionRequest) (CompactionRecord, error) {
	return CompactionRecord{ID: 7, Request: r}, nil
}
func (s *compactionStub) CommitReplacement(_ context.Context, r CompactionResult) (CommitReceipt, error) {
	s.committed = true
	s.result = r
	return CommitReceipt{}, nil
}
func (s *compactionStub) Fail(context.Context, CompactionFailure) (CommitReceipt, error) {
	s.failed = true
	return CommitReceipt{}, nil
}

type counterFunc func(modelcore.Request) (uint64, error)

func (f counterFunc) Count(r modelcore.Request) (uint64, error) { return f(r) }

type summaryFunc func(context.Context, CompactionRecord, modelcore.Request) (modelcore.Response, error)

func (f summaryFunc) Summarize(c context.Context, r CompactionRecord, q modelcore.Request) (modelcore.Response, error) {
	return f(c, r, q)
}

func TestCompactionKeepsSurfaceOnInvalidSummaryAndRechecksRevision(t *testing.T) {
	old := modelcore.Message{Role: "user", Content: "long previous task text"}
	recent := modelcore.Message{Role: "user", Content: "current task"}
	manifest := SurfaceManifest{SchemaVersion: 1, Revision: 3, Entries: []SurfaceEntry{{Kind: "message", Sequences: []Seq{1}}, {Kind: "message", Sequences: []Seq{2}}}}
	facts := map[Seq]HistoryFact{1: {Seq: 1, SchemaVersion: 1, Kind: "input/message", Message: &old}, 2: {Seq: 2, SchemaVersion: 1, Kind: "input/message", Message: &recent}}
	first, last, err := CompactionRange(manifest, facts, 1)
	if err != nil || first != 0 || last != 0 {
		t.Fatalf("range %d %d %v", first, last, err)
	}
	request := CompactionRequest{SessionID: 1, Source: manifest, First: first, Last: last, Deadline: time.Now().Add(time.Second)}
	store := &compactionStub{}
	compactor := Compactor{Store: store, Tokens: counterFunc(func(r modelcore.Request) (uint64, error) {
		var n uint64
		for _, m := range r.Messages {
			n += uint64(len(m.Content))
		}
		return n, nil
	}), Models: summaryFunc(func(context.Context, CompactionRecord, modelcore.Request) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Content: ""}}, nil
	})}
	_, err = compactor.Compact(t.Context(), request, modelcore.Request{Messages: []modelcore.Message{old, recent}}, facts)
	code(t, err, "COMPACTION_INVALID_SUMMARY")
	if !store.failed || store.committed {
		t.Fatal("invalid summary replaced surface")
	}
	store = &compactionStub{}
	compactor.Store = store
	compactor.Models = summaryFunc(func(context.Context, CompactionRecord, modelcore.Request) (modelcore.Response, error) {
		return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "short"}}, nil
	})
	_, err = compactor.Compact(t.Context(), request, modelcore.Request{Messages: []modelcore.Message{old, recent}}, facts)
	if err != nil {
		t.Fatal(err)
	}
	r := store.result.Replacement
	r.SummarySeq = 4
	replaced, err := ApplyReplacement(manifest, r)
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Entries[1].Sequences[0] != 2 || replaced.Revision != 4 {
		t.Fatal("recent task removed")
	}
	manifest.Revision++
	_, err = ApplyReplacement(manifest, r)
	code(t, err, "COMPACTION_SOURCE_CHANGED")
}

func TestOrdinaryPromptClearAndInterruptedProjection(t *testing.T) {
	locked := LockedModel{RemoteModelID: "model", Protocol: modelcore.ChatCompletions, Parameters: map[string]json.RawMessage{"max_output_tokens": json.RawMessage(`100`)}}
	partial := modelcore.Message{Role: "assistant", Content: "partial", Reasoning: "incomplete signature", NativeProtocol: modelcore.ChatCompletions, Native: json.RawMessage(`{"incomplete":true}`)}
	facts := map[Seq]HistoryFact{1: {Seq: 1, SchemaVersion: 1, Kind: "assistant/attempt", Message: &partial, Interrupted: true}}
	manifest := SurfaceManifest{SchemaVersion: 1, Revision: 1, Entries: []SurfaceEntry{{Kind: "message", Sequences: []Seq{1}}}}
	messages, err := BuildSurface(manifest, facts)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages[0].Native) > 0 || messages[0].Reasoning != "" || messages[0].Content != "[Interrupted partial answer]\npartial" {
		t.Fatal("partial native was replayed")
	}
	spec := ToolSpec{Key: "b", Policy: "allow", Definition: modelcore.Tool{Name: "tool", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}}
	prepared, err := BuildPreparedStep(ExecutionRef{}, 1, locked, PromptConfig{Platform: "stable platform", Administrator: ""}, manifest, messages, []ToolSpec{spec}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.Request.Messages) != 2 || prepared.Request.Messages[0].Content != "stable platform" {
		t.Fatal("cleared administrator prompt leaked")
	}
	prepared.Request.Parameters["max_output_tokens"][0] = '9'
	if string(locked.Parameters["max_output_tokens"]) != "100" {
		t.Fatal("request mutated frozen session parameters")
	}
}
