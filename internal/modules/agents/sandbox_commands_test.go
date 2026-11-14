package agents

import (
	"context"
	"errors"
	"strings"
	"testing"

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
	got, err := normalizeCommandRequest(CommandRequest{Command: "printf ok"})
	if err != nil || got.TimeoutSeconds != 60 || got.MaxOutputBytes != 32<<10 {
		t.Fatalf("defaults %+v %v", got, err)
	}
	for _, w := range []CommandRequest{{Command: " "}, {Command: "a\x00b"}, {Command: strings.Repeat("x", (32<<10)+1)}, {Command: "echo", TimeoutSeconds: 601}, {Command: "echo", MaxOutputBytes: 1}} {
		if _, err := normalizeCommandRequest(w); err == nil {
			t.Fatalf("unbounded command accepted %+v", w)
		}
	}
}

func TestProcessArgumentsCannotChangeAfterAuthorization(t *testing.T) {
	raw := `{"execution_id":"42","cursor":"8","max_output_bytes":4096}`
	valid := processArguments{ExecutionID: 42, Cursor: "8", MaxOutputBytes: 4096}
	if !matchesProcessArguments(raw, valid) {
		t.Fatal("frozen arguments rejected")
	}
	for _, changed := range []processArguments{{ExecutionID: 43, Cursor: "8", MaxOutputBytes: 4096}, {ExecutionID: 42, Cursor: "9", MaxOutputBytes: 4096}, {ExecutionID: 42, Cursor: "8", MaxOutputBytes: 8192}} {
		if matchesProcessArguments(raw, changed) {
			t.Fatal("authorized process request changed")
		}
	}
	result := observedCommand(SandboxExecutionMetadata{State: "outcome_unknown"})
	if result.Executed == nil || !*result.Executed || result.Execution.State != "outcome_unknown" {
		t.Fatal("successful observation confused with process completion")
	}
}
