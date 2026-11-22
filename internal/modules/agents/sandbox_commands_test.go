package agents

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestManagedCommandOutcomeRequiresPhysicalEvidence(t *testing.T) {
	handle := &sandboxcore.ExecutionHandle{ID: "physical-id"}
	zero := int32(0)
	for _, tt := range []struct {
		name   string
		result sandboxcore.ExecResult
		err    error
		sent   bool
		state  string
		exit   bool
	}{
		{"exit", sandboxcore.ExecResult{Handle: handle, ExitCode: &zero}, nil, true, "completed", true},
		{"background_ack", sandboxcore.ExecResult{Handle: handle, Running: true}, nil, true, "running", false},
		{"cancel_ack_not_exit", sandboxcore.ExecResult{Handle: handle}, nil, true, "outcome_unknown", false},
		{"missing_init", sandboxcore.ExecResult{}, &sandboxcore.Error{Code: "LOST", Unknown: true}, true, "outcome_unknown", false},
		{"explicit_rejection", sandboxcore.ExecResult{}, &sandboxcore.Error{Code: "REJECTED"}, true, "completed", false},
		{"local_failure", sandboxcore.ExecResult{}, errors.New("local"), false, "completed", false},
		{"cancel_after_dispatch", sandboxcore.ExecResult{}, context.Canceled, true, "outcome_unknown", false},
		{"known_id_missing_status", sandboxcore.ExecResult{Handle: handle}, &sandboxcore.Error{Code: "NOT_FOUND"}, true, "outcome_unknown", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			state, exit := commandProjection(tt.result, tt.err, tt.sent)
			if state != tt.state || (exit != nil) != tt.exit {
				t.Fatalf("got %s/%v", state, exit)
			}
		})
	}
}

func TestManagedCommandArgumentsAreBounded(t *testing.T) {
	got, err := normalizeCommandRequest(CommandRequest{Description: "Print message", Command: "printf ok"})
	if err != nil || got.WaitMS == nil || *got.WaitMS != 60_000 {
		t.Fatalf("defaults %+v %v", got, err)
	}
	for _, ms := range []int{0, 250, 600_000} {
		got, err := normalizeCommandRequest(CommandRequest{Description: "Print message", Command: "echo", WaitMS: &ms})
		if err != nil || *got.WaitMS != ms {
			t.Fatalf("wait_ms %d: %+v %v", ms, got, err)
		}
	}
	for _, w := range []CommandRequest{{Command: " "}, {Command: "a\x00b"}, {Command: strings.Repeat("x", (32<<10)+1)}, {Description: "Print", Command: "echo", WaitMS: new(-1)}, {Description: "Print", Command: "echo", WaitMS: new(600_001)}, {Command: "echo", Description: "a\nb"}} {
		if _, err := normalizeCommandRequest(w); err == nil {
			t.Fatalf("unbounded command accepted %+v", w)
		}
	}
}

func TestProcessArgumentsCannotChangeAfterAuthorization(t *testing.T) {
	raw := `{"task_id":"42","cursor":"8","wait_ms":4096}`
	valid := processArguments{ExecutionID: 42, Cursor: "8", WaitMS: 4096}
	if !matchesProcessArguments(raw, valid) {
		t.Fatal("frozen arguments rejected")
	}
	for _, changed := range []processArguments{{ExecutionID: 43, Cursor: "8", WaitMS: 4096}, {ExecutionID: 42, Cursor: "9", WaitMS: 4096}, {ExecutionID: 42, Cursor: "8", WaitMS: 8192}} {
		if matchesProcessArguments(raw, changed) {
			t.Fatal("authorized process request changed")
		}
	}
	result := observedCommand(SandboxExecutionMetadata{State: "outcome_unknown"})
	if result.Executed == nil || !*result.Executed || result.Execution.State != "outcome_unknown" {
		t.Fatal("successful observation confused with process completion")
	}
}

func TestTaskMetadataAfterStreamCompletion(t *testing.T) {
	now := time.Now()
	exit := 7
	row := CloudExecutionRow{ID: 41, Status: "completed", FinishedAt: &now, ExitCode: &exit, LastObservation: []byte(`{"task_id":"41","state":"running"}`)}
	meta, err := metadataFromCommand(&row)
	if err != nil || meta.State != "completed" || meta.ExitCode == nil || *meta.ExitCode != exit {
		t.Fatalf("finished task projection: %+v, %v", meta, err)
	}
}
