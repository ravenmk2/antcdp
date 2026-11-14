package agents

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestReasoningDurationPublicProjection(t *testing.T) {
	message := modelcore.Message{Reasoning: "think", Content: "answer"}
	duration := int64(1523)
	blocks := uiAssistant(message, nil, &duration)
	if blocks[0].DurationMS == nil || *blocks[0].DurationMS != duration || blocks[1].DurationMS != nil {
		t.Fatal(blocks)
	}
	raw, err := json.Marshal(blocks)
	if err != nil || !strings.Contains(string(raw), `"duration_ms":1523`) {
		t.Fatal(string(raw), err)
	}
	old, err := json.Marshal(uiAssistant(message, nil))
	if err != nil || strings.Contains(string(old), "duration_ms") {
		t.Fatal("invented historic timing", string(old), err)
	}
}
