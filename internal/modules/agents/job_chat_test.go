package agents

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type jobChatState struct {
	StateRepository
	input InputRow
	run   RunRow
}

func (s jobChatState) Input(uint64, bool) (*InputRow, error) { return &s.input, nil }
func (s jobChatState) Run(uint64, bool) (*RunRow, error)     { return &s.run, nil }

func (s jobChatState) LastAssistantMessage(uint64) (*EventRow, error) { return nil, nil }

func TestJobChatRequiresFinalMessage(t *testing.T) {
	reply, err := finalJobReply(jobChatState{}, ChatReceipt{}, &RunRow{Status: "succeeded"})
	var public *httpx.Error
	if reply != nil || !errors.As(err, &public) || public.Code != "AGENT_REPLY_MISSING" {
		t.Fatal(reply, err)
	}
}

func TestJobChatReplyJSON(t *testing.T) {
	reply := JobChatReply{ChatReceipt: ChatReceipt{SessionID: 3, InputID: 4, Status: "succeeded", Replayed: true}, RunID: 5, Text: "final\nreply"}
	data, err := json.Marshal(reply)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	want := map[string]any{"sessionId": "3", "inputId": "4", "runId": "5", "status": "succeeded", "replayed": true, "text": "final\nreply"}
	if err := json.Unmarshal(data, &got); err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal(string(data), err)
	}
}

func TestJobChatTerminalErrors(t *testing.T) {
	receipt := ChatReceipt{SessionID: 1, InputID: 2}
	request := AutomationChat{JobRun: true, CallerID: 3}
	for _, tc := range []struct{ input, run, code string }{
		{"expired", "", "AGENT_INPUT_EXPIRED"},
		{"cancelled", "", "AGENT_INPUT_CANCELLED"},
		{"removed", "", "AGENT_INPUT_REMOVED"},
		{"claimed", "failed", "AGENT_RUN_FAILED"},
		{"claimed", "cancelled", "AGENT_RUN_CANCELLED"},
		{"claimed", "interrupted", "AGENT_RUN_INTERRUPTED"},
		{"claimed", "waiting_input", "AGENT_RUN_WAITING_INPUT"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			state := jobChatState{
				input: InputRow{ID: 2, SessionID: 1, SourceKind: new("job_run"), SourceID: new("3"), Status: tc.input, ClaimedRunID: new(uint64(4)), EndReason: new("input_reason")},
				run:   RunRow{ID: 4, SessionID: 1, TriggerInputID: new(uint64(2)), Status: tc.run, EndedSeq: new(uint64(10)), EndReason: new("run_reason")},
			}
			reply, err := jobChatReply(nil, nil, state, request, receipt)
			var public *httpx.Error
			if reply != nil || !errors.As(err, &public) || public.Code != tc.code || !strings.Contains(public.Message, "_reason") {
				t.Fatal("terminal status lost its error", reply, err)
			}
		})
	}
}
