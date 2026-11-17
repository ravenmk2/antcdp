package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestAttemptValidationDistinguishesToolContracts(t *testing.T) {
	tool := agentcore.ToolSpec{Definition: modelcore.Tool{Name: "echo", InputSchema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}`)}}
	for _, tc := range []struct{ name, arguments, code string }{
		{"echo", `{"text":"hello"}`, ""},
		{"unknown-private-name", `{}`, "MODEL_TOOL_NAME_UNKNOWN"},
		{"echo", `"private-value"`, "MODEL_TOOL_ARGUMENTS_NOT_OBJECT"},
		{"echo", `{"wrong":"private-value"}`, "MODEL_TOOL_ARGUMENTS_SCHEMA_MISMATCH"},
		{"echo", `{"text":1}`, "MODEL_TOOL_ARGUMENTS_SCHEMA_MISMATCH"},
	} {
		_, err := attemptValidation(attemptSnapshot{Tools: []agentcore.ToolSpec{tool}}, modelcore.Response{Message: modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-1", Name: tc.name, Arguments: tc.arguments}}}})
		if tc.code == "" {
			if err != nil {
				t.Fatal(err)
			}
			continue
		}
		detail := diagnostic.From(err)
		if !errors.Is(err, modelcore.ErrInvalidResponse) || modelOutcomeReason(agentcore.AttemptOutcome{Err: err}) != "MODEL_RESPONSE_INVALID" || detail == nil || detail.Stage != "response_validation" || detail.Code != tc.code {
			t.Fatalf("err=%v diagnostic=%+v", err, detail)
		}
		if strings.Contains(err.Error(), "private") {
			t.Fatal("tool arguments leaked")
		}
	}
}

func TestModelOutcomeSeparatesTransportAttemptAndRunTimeout(t *testing.T) {
	for _, test := range []struct {
		name    string
		outcome agentcore.AttemptOutcome
		want    string
	}{
		{"transport", agentcore.AttemptOutcome{Err: modelcore.ErrTransportTimeout}, "MODEL_REQUEST_TIMEOUT"},
		{"attempt", agentcore.AttemptOutcome{Err: &agentcore.Error{Code: "MODEL_ATTEMPT_TIMEOUT"}}, "MODEL_ATTEMPT_TIMEOUT"},
		{"run", agentcore.AttemptOutcome{Err: context.DeadlineExceeded}, "DEADLINE_EXCEEDED"},
		{"stop", agentcore.AttemptOutcome{Err: context.Canceled, Cancelled: true}, "CANCELLED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := modelOutcomeReason(test.outcome); got != test.want {
				t.Fatalf("got %s want %s", got, test.want)
			}
		})
	}
}

func TestModelOutcomeUsesSafeRemoteFailureClasses(t *testing.T) {
	for _, test := range []struct {
		err  error
		want string
	}{
		{modelcore.ErrRateLimited, "MODEL_RATE_LIMITED"},
		{modelcore.ErrAuthenticationFailed, "MODEL_AUTHENTICATION_FAILED"},
		{modelcore.ErrRequestRejected, "MODEL_REQUEST_REJECTED"},
		{modelcore.ErrRemoteService, "MODEL_REMOTE_SERVICE_ERROR"},
		{modelcore.ErrTransport, "MODEL_CONNECTION_FAILED"},
		{modelcore.ErrTransportTimeout, "MODEL_REQUEST_TIMEOUT"},
		{errors.New("unclassified failure with private provider data"), "MODEL_REQUEST_FAILED"},
	} {
		t.Run(test.want, func(t *testing.T) {
			err := fmt.Errorf("private wrapper: %w", test.err)
			if got := modelOutcomeReason(agentcore.AttemptOutcome{Err: err}); got != test.want {
				t.Fatalf("got %s want %s", got, test.want)
			}
			if got := modelOutcomeReason(agentcore.AttemptOutcome{Err: err, Cancelled: true}); got != "CANCELLED" {
				t.Fatal("remote class replaced explicit cancellation")
			}
		})
	}
}

func TestRequestSnapshotRebuildsGenerationAndSummaryHash(t *testing.T) {
	for _, suffix := range []int{0, 1} {
		history := []modelcore.Message{{Role: "user", Content: "committed user input", Images: []modelcore.ImagePart{{MIME: "image/png", ContentSHA256: strings.Repeat("a", 64), DataBase64: "must-not-persist"}}}}
		request := modelcore.Request{Model: "model-a", Protocol: modelcore.ChatCompletions, Messages: []modelcore.Message{{Role: "system", Content: "platform prompt"}, {Role: "system", Content: "administrator prompt before edit"}}, Tools: []modelcore.Tool{{Name: "read", Description: "actual frozen tool", InputSchema: json.RawMessage(`{"type":"object"}`)}}, Parameters: map[string]json.RawMessage{"temperature": json.RawMessage(`0.1`)}}
		request.Messages = append(request.Messages, history...)
		if suffix == 1 {
			request.Messages = append(request.Messages, modelcore.Message{Role: "user", Content: "exact summary-only instruction"})
		}
		snapshot, e := snapshotRequest(request, agentcore.LockedModel{Connection: json.RawMessage(`{"base_url":"https://model.example/v1"}`)}, nil, suffix)
		if e != nil {
			t.Fatal(e)
		}
		encoded, e := json.Marshal(snapshot)
		if e != nil || strings.Contains(string(encoded), "must-not-persist") {
			t.Fatal("snapshot contains image bytes", e)
		}
		var restored attemptSnapshot
		if e = json.Unmarshal(encoded, &restored); e != nil {
			t.Fatal(e)
		}
		rebuilt := modelcore.Request{Model: restored.Model, Protocol: restored.Protocol, Messages: append(restored.System, history...), Tools: restored.ModelTools, Parameters: restored.Parameters}
		rebuilt.Messages = append(rebuilt.Messages, restored.Suffix...)
		want, e := agentcore.ContentHash(request)
		if e != nil {
			t.Fatal(e)
		}
		got, e := agentcore.ContentHash(rebuilt)
		if e != nil || got != want {
			t.Fatal("persisted non-conversation inputs cannot reconstruct request", suffix, e)
		}
	}
}
