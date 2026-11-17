package agents

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestChangeFrozenThinkingPreservesModelAndReplacesParameters(t *testing.T) {
	original := agentcore.LockedModel{ProviderID: 1, DefinitionID: 2, BindingID: 3, RemoteModelID: "original", Protocol: modelcore.ChatCompletions, Connection: json.RawMessage(`{"base_url":"https://original.example"}`), ThinkingKey: "high", Parameters: map[string]json.RawMessage{"temperature": json.RawMessage(`0.2`), "thinking": json.RawMessage(`{"type":"enabled"}`), "reasoning_effort": json.RawMessage(`"high"`)}, SelectionHash: "before"}
	frozen := frozenModel{LockedModel: original}
	options := []modelcore.ThinkingOption{{Key: "low", Label: "低", Parameters: json.RawMessage(`{"reasoning_effort":"low"}`)}, {Key: "high", Label: "高", Parameters: json.RawMessage(`{"thinking":{"type":"enabled"},"reasoning_effort":"high"}`)}}
	if err := changeFrozenThinking(&frozen, "low", []string{"low", "high"}, options); err != nil {
		t.Fatal(err)
	}
	if frozen.ThinkingKey != "low" || frozen.Display.Thinking != "low" || frozen.Display.ThinkingLabel != "低" || frozen.SelectionHash == "before" || frozen.Display.Hash != frozen.SelectionHash {
		t.Fatal("thinking selection was not updated", frozen)
	}
	if string(frozen.Parameters["temperature"]) != "0.2" || string(frozen.Parameters["reasoning_effort"]) != `"low"` || frozen.Parameters["thinking"] != nil {
		t.Fatal("reasoning parameters were not replaced", frozen.Parameters)
	}
	identity := frozen.LockedModel
	identity.Parameters, identity.ThinkingKey, identity.SelectionHash = original.Parameters, original.ThinkingKey, original.SelectionHash
	if !reflect.DeepEqual(identity, original) || string(original.Parameters["reasoning_effort"]) != `"high"` {
		t.Fatal("model identity or active snapshot changed")
	}
	firstHash := frozen.SelectionHash
	if err := changeFrozenThinking(&frozen, "high", []string{"high", "low"}, options); err != nil {
		t.Fatal(err)
	}
	if err := changeFrozenThinking(&frozen, "low", []string{"high", "low"}, options); err != nil || frozen.SelectionHash != firstHash {
		t.Fatal("selection hash is not stable across repeated switches", err)
	}
	if err := changeFrozenThinking(&frozen, "high", []string{"low"}, options); err == nil {
		t.Fatal("unauthorized thinking level accepted")
	}
	if err := changeFrozenThinking(&frozen, "missing", []string{"missing"}, options); err == nil {
		t.Fatal("unknown thinking level accepted")
	}
}
