package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/webaccess"
)

func TestAgentBuiltinSchemasSupportControlAndRejectExtraArguments(t *testing.T) {
	valid := map[string]string{
		"read_tool_output": `{"file_id":"1","query":"ERROR"}`,
		"read":             `{"file_path":"note.md"}`,
		"read_image":       `{"path":"/data/storage/plot.png"}`,
		"write":            `{"file_path":"note.md","content":"report"}`,
		"edit":             `{"file_path":"note.md","old_string":"old","new_string":"new"}`,
		"glob":             `{"pattern":"*.go"}`,
		"grep":             `{"pattern":"TODO","literal":true}`,
		"load_artifacts":   `{"items":[{"artifact_id":"1"}]}`,
		"list_artifacts":   `{}`,
		"show_artifacts":   `{"artifact_ids":["1"]}`,
		"exec":             `{"description":"Show working directory","command":"pwd"}`,
		"task_list":        `{}`,
		"task_output":      `{"task_id":"1"}`,
		"task_kill":        `{"task_id":"1"}`,
		"save_artifacts":   `{"files":[{"path":"report.md","description":"排查结果"}]}`,
		"web_search":       `{"queries":["public test"]}`,
		"web_fetch":        `{"url":"https://example.com/"}`,
		"skill":            `{"name":"review-code"}`,
		"ask_question":     `{"questions":[{"id":"scope","question":"Choose a scope","options":[{"id":"one","label":"First","description":"One item"}]}]}`,
		"todo_write":       `{"todos":[{"content":"Check the current state","status":"in_progress"}]}`,
		"subagent":         `{"task":"Explain the public example"}`,
		papi.ListTool:      `{"offset":0,"limit":20}`,
		papi.DescTool:      `{"api":"echo"}`,
		papi.CallTool:      `{"api":"echo","args":{"nested":{"value":true}}}`,
	}
	seen := map[string]bool{}
	for _, tool := range builtinAgentTools() {
		for _, forbidden := range []string{"sandbox", "沙箱", "antcdp"} {
			if strings.Contains(strings.ToLower(tool.Definition.Description), forbidden) {
				t.Errorf("%s description mentions %s", tool.Key, forbidden)
			}
		}

		if seen[tool.Key] {
			t.Fatal("duplicate builtin identity")
		}
		seen[tool.Key] = true
		args, ok := valid[tool.Key]
		if !ok {
			t.Fatalf("missing contract example for %s", tool.Key)
		}
		if err := mcp.ValidateArguments(tool.Definition.InputSchema, json.RawMessage(args)); err != nil {
			t.Fatalf("%s rejected valid arguments: %v", tool.Key, err)
		}
		var object map[string]any
		if err := json.Unmarshal([]byte(args), &object); err != nil {
			t.Fatal(err)
		}
		object["grant_admin"] = true
		injected, err := json.Marshal(object)
		if err != nil {
			t.Fatal(err)
		}
		if mcp.ValidateArguments(tool.Definition.InputSchema, injected) == nil {
			t.Fatalf("%s accepted unknown fields", tool.Key)
		}
		if tool.ExecutionClass == "question" || tool.ExecutionClass == "child" || papi.IsTool(tool.Key) {
			for _, policy := range tool.SupportedPolicies {
				if policy == "confirm" {
					t.Fatal("control tools must not produce nested approvals")
				}
			}
		}
	}
	if len(seen) != len(valid) {
		t.Fatal("missing builtin")
	}
}

func TestQuestionSchemaAcceptsOptionalRecommendationBoolean(t *testing.T) {
	for _, tool := range builtinAgentTools() {
		if tool.Key != "ask_question" {
			continue
		}
		for _, value := range []string{"", `,"recommended":true`, `,"recommended":false`, `,"recommended":"yes"`} {
			args := `{"questions":[{"id":"scope","question":"Choose","options":[{"id":"one","label":"One","description":"Tradeoff"` + value + `}]}]}`
			err := mcp.ValidateArguments(tool.Definition.InputSchema, json.RawMessage(args))
			if (err != nil) != strings.Contains(value, `"yes"`) {
				t.Fatalf("recommendation %s: %v", value, err)
			}
		}
		return
	}
	t.Fatal("question tool missing")
}

func TestWebToolUnknownOutcomeIsNotKnownFailure(t *testing.T) {
	unknown := webToolFailure(context.DeadlineExceeded, []webaccess.Attempt{{Outcome: "unknown"}})
	if unknown.Status != "outcome_unknown" || unknown.Executed != nil {
		t.Fatal("unknown remote outcome was discarded")
	}
	undispatched := webToolFailure(webaccess.Fail("WEB_ACCESS_NOT_CONFIGURED"), nil)
	if undispatched.Status != "failed" || undispatched.Executed == nil || *undispatched.Executed {
		t.Fatal("unconfigured retrieval was treated as executed")
	}
	unknown = webToolFailure(&webaccess.Failure{Code: "WEB_ACCESS_TIMEOUT", Unknown: true}, nil)
	if unknown.Executed != nil {
		t.Fatal("typed unknown was treated as known")
	}
	failed := webToolFailure(errors.New("private upstream detail"), nil)
	if failed.Content != "Tool did not produce a confirmed successful result: WEB_ACCESS_FAILED" {
		t.Fatal("raw diagnostic leaked")
	}
}

func TestAgentModelSnapshotMismatchFailsBeforeCredentialLookup(t *testing.T) {
	factory := agentModelFactory{}
	_, err := factory.Open(t.Context(), agentcore.LockedModel{ProviderID: 1, DefinitionID: 2, Connection: json.RawMessage(`{"provider_id":"9","model_id":"2"}`)})
	if err == nil {
		t.Fatal("mismatched identity accepted")
	}
}

func TestAgentBudgetIncludesImagesWithoutPersistingThem(t *testing.T) {
	request := modelcore.Request{Messages: []modelcore.Message{{Role: "user", Images: []modelcore.ImagePart{{MIME: "image/png", DataBase64: "private-image-bytes"}}}}, Parameters: map[string]json.RawMessage{"max_output_tokens": json.RawMessage(`512`)}}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	budget, err := estimateAgentRequest(request)
	if err != nil || budget.ModelCalls != 1 || budget.OutputTokens != 512 || budget.InputTokens < 8192 || strings.Contains(string(encoded), "private-image-bytes") {
		t.Fatal("image input reservation missing", err)
	}
	request.Messages[0].Images = nil
	textOnly, err := estimateAgentRequest(request)
	if err != nil || budget.InputTokens-textOnly.InputTokens != 8192 {
		t.Fatal("image counted more than once", budget, textOnly, err)
	}
}
