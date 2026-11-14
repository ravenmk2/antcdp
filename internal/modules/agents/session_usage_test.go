package agents

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSessionContextUsage(t *testing.T) {
	now := time.Now().UTC()
	session := &SessionRow{ModelLockedAt: &now, LockedModelConfig: json.RawMessage(`{"selection_hash":"locked","context_window":128000,"max_output_tokens":8192}`)}
	input, read := uint64(32000), uint64(0)
	call := &ModelCallRow{ID: 5, InputTokens: &input, CacheReadTokens: &read, FinishedAt: &now, SurfaceManifest: json.RawMessage(`{"entries":[{"sequences":["10","11"]}]}`)}
	for _, test := range []struct {
		name  string
		seq   uint64
		stale bool
	}{{"no compression", 0, false}, {"included summary", 10, false}, {"new summary", 12, true}} {
		t.Run(test.name, func(t *testing.T) {
			result, err := sessionContextUsage(session, call, test.seq)
			if err != nil || result.Window != 128000 || result.ReservedOutput != 8192 || result.Input == nil || *result.Input != input || result.CacheRead == nil || *result.CacheRead != 0 || result.Stale != test.stale || result.ObservedAt != &now {
				t.Fatalf("context=%+v err=%v", result, err)
			}
		})
	}
	call.InputTokens, call.CacheReadTokens = nil, nil
	result, err := sessionContextUsage(session, call, 0)
	if err != nil || result.Input != nil || result.CacheRead != nil {
		t.Fatal("unknown counters must stay null", result, err)
	}
	call.SurfaceManifest = json.RawMessage(`null`)
	result, err = sessionContextUsage(session, call, 12)
	if err != nil || !result.Stale {
		t.Fatal("missing surface cannot prove compression included", result, err)
	}
	result, err = sessionContextUsage(&SessionRow{}, nil, 0)
	if err != nil || result.Window != 0 || result.Input != nil || result.CallID != nil {
		t.Fatal("unstarted session", result, err)
	}
}
