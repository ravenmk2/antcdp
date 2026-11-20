package mysql

import (
	"encoding/json"
	"strconv"
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func runtimeThinkingSelection(t *testing.T, f *agentIntegrationFixture) {
	provider, err := f.Models.CreateProvider(f.Context, f.AdminToken, m.ProviderCreate{Name: "Thinking selection", Type: "ollama", Config: &m.Config{BaseURL: "http://127.0.0.1:11434/v1"}, Authentication: &m.AuthenticationWrite{Method: "none", Secret: m.SecretWrite{Operation: "clear"}}})
	if err != nil {
		t.Fatal(err)
	}
	definition, err := f.Models.CreateDefinition(f.Context, f.AdminToken, m.DefinitionCreate{ProviderID: strconv.FormatUint(provider.Data.(*m.Provider).ID, 10), RemoteModelID: "thinking-selection", Name: "Thinking selection", Protocol: "chat_completions", Capabilities: m.Capabilities{Text: "supported", Tools: "supported", Image: "unsupported", Thinking: "supported", Streaming: "supported"}, ContextWindow: 32768, MaxOutput: 4096, ThinkingLevels: []string{"low", "high"}, ThinkingMapping: map[string]json.RawMessage{"high": json.RawMessage(`{"reasoning_effort":"vendor-high"}`)}})
	if err != nil {
		t.Fatal(err)
	}
	modelID := definition.Data.(*m.Definition).ID
	agent := runtimeTestAgentModel(t, f, modelID)
	bindings, err := f.Agents.GetModelBindings(f.Context, f.AdminToken, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	model := strconv.FormatUint(modelID, 10)
	_, err = f.Agents.PutModelBindings(f.Context, f.AdminToken, agent.ID, bindings.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: model, ThinkingOptions: []string{"low", "high"}, DefaultThinking: "low", GenerationParameters: json.RawMessage(`{"temperature":0.2}`)}}, DefaultModelID: model, DefaultThinking: "low"})
	if err != nil {
		t.Fatal(err)
	}
	session := runtimeSession(t, f, agent.ID)
	id := session.Configuration.ID
	x := runtimeClaim(t, f, id, "start with low effort")
	config, err := f.Agents.GetSessionConfiguration(f.Context, f.AdminToken, id)
	if err != nil {
		t.Fatal(err)
	}
	selection := config.Data.(a.SessionConfiguration).Selection
	selection.Thinking = "high"
	patch := a.SessionPatch{Selection: a.Field[a.ModelSelection]{Set: true, Value: selection}}
	updated, err := f.Agents.PatchSessionConfiguration(f.Context, f.AdminToken, id, config.Tag, patch)
	if err != nil {
		t.Fatal("locked session must accept thinking changes", err)
	}
	if updated.Data.(a.SessionConfiguration).ModelLockedAt == nil {
		t.Fatal("model was unlocked")
	}
	_, err = f.Agents.PatchSessionConfiguration(f.Context, f.AdminToken, id, config.Tag, patch)
	modelsExpectCode(t, err, "VERSION_CONFLICT")
	selection.BindingID = "1"
	if selection.BindingID == config.Data.(a.SessionConfiguration).Selection.BindingID {
		selection.BindingID = "2"
	}
	_, err = f.Agents.PatchSessionConfiguration(f.Context, f.AdminToken, id, updated.Tag, a.SessionPatch{Selection: a.Field[a.ModelSelection]{Set: true, Value: selection}})
	modelsExpectCode(t, err, "MODEL_SELECTION_LOCKED")
	selection = patch.Selection.Value
	selection.Thinking = "invalid"
	_, err = f.Agents.PatchSessionConfiguration(f.Context, f.AdminToken, id, updated.Tag, a.SessionPatch{Selection: a.Field[a.ModelSelection]{Set: true, Value: selection}})
	modelsExpectCode(t, err, "VALIDATION_FAILED")
	active, err := f.Agents.AuthorizeExecution(f.Context, x.Ref)
	if err != nil || active.Model.ThinkingKey != "low" || active.Model.SelectionHash != x.Model.SelectionHash {
		t.Fatal("active run changed", err)
	}
	detail, err := f.Agents.GetSession(f.Context, f.AdminToken, id)
	if err != nil {
		t.Fatal(err)
	}
	current := detail.Data.(a.SessionDetail)
	if current.Selection.Thinking != "high" || current.Selection.Hash == x.Model.SelectionHash {
		t.Fatal("effective selection was not persisted")
	}
	_, err = f.Agents.SubmitInput(f.Context, f.AdminToken, id, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "stale selection"}}, ExpectedHash: x.Model.SelectionHash})
	modelsExpectCode(t, err, "MODEL_SELECTION_CHANGED")
	prepared, err := f.Agents.PrepareStep(f.Context, x, 1)
	if err != nil {
		t.Fatal(err)
	}
	commit := runtimePreparedAttempt(t, f, x, prepared, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "thinking-child", Name: "delegate", Arguments: `{"task":"verify inherited thinking","file_refs":[]}`}}})
	estimate, err := modelcore.EstimateRequestTokens(prepared.Request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Store.db.ExecContext(f.Context, "UPDATE agent_model_call SET input_tokens=? WHERE session_id=? AND purpose='generation'", estimate+100, id); err != nil {
		t.Fatal(err)
	}
	usage, err := f.Agents.SessionUsage(f.Context, f.AdminToken, id)
	if err != nil {
		t.Fatal(err)
	}
	pressure := usage.Data.(a.SessionUsageReport).Context
	if pressure.Projected == nil || pressure.Estimated == nil || *pressure.Projected != *pressure.Estimated+100 || pressure.MeasurementSource != "usage_adjusted" {
		t.Fatal("UI used next-turn thinking instead of active frozen request", pressure)
	}
	permit, err := f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID)
	if err != nil || permit.Kind != "execute" {
		t.Fatal("prepare child", err)
	}
	child, err := f.Agents.CreateChild(f.Context, core.ChildRequest{Parent: commit.Calls[0], Content: []core.TextBlock{{Type: "text", Text: "verify inherited thinking"}}})
	if err != nil || !child.Created || child.Execution.Model.ThinkingKey != "low" {
		t.Fatal("child did not inherit the active run", err)
	}
	childDetail, err := f.Agents.GetSession(f.Context, f.AdminToken, uint64(child.Execution.Ref.SessionID))
	if err != nil {
		t.Fatal(err)
	}
	if childDetail.Data.(a.SessionDetail).Selection.Thinking != "low" || childDetail.Data.(a.SessionDetail).Selection.Hash != x.Model.SelectionHash {
		t.Fatal("child metadata diverged from its execution")
	}
	runtimeAttempt(t, f, child.Execution, 1, modelcore.Message{Role: "assistant", Content: "inherited low effort"})
	if _, err = f.Agents.EndChild(f.Context, child.Execution.Ref, core.ChildEnd{End: core.RunEnd{Status: core.Succeeded}}); err != nil {
		t.Fatal(err)
	}
	runtimeEnd(t, f, x)
	next := runtimeClaim(t, f, id, "next turn uses high effort")
	if next.Model.ThinkingKey != "high" || string(next.Model.Parameters["reasoning_effort"]) != `"vendor-high"` || next.Model.RemoteModelID != x.Model.RemoteModelID || string(next.Model.Connection) != string(x.Model.Connection) || string(next.Model.Parameters["temperature"]) != "0.2" {
		t.Fatal("next run did not preserve model and apply thinking")
	}
	runtimeEnd(t, f, next)
	latest, err := f.Agents.GetSessionConfiguration(f.Context, f.AdminToken, id)
	if err != nil {
		t.Fatal(err)
	}
	archived, err := f.Agents.ArchiveSession(f.Context, f.AdminToken, id, latest.Tag, cryptox.ID())
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Agents.PatchSessionConfiguration(f.Context, f.AdminToken, id, archived.Tag, patch)
	modelsExpectCode(t, err, "SESSION_ARCHIVED")
}
