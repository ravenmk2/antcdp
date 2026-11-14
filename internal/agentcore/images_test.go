package agentcore

import (
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestPreparedToolImageRequiresVerifiedCapabilityAndInternalProvenance(t *testing.T) {
	locked := LockedModel{RemoteModelID: "model", Protocol: modelcore.ChatCompletions, Capabilities: modelcore.Capabilities{ImageInput: modelcore.Supported}}
	message := modelcore.Message{Role: "tool", ToolCallID: "call", Images: []modelcore.ImagePart{{MIME: "image/png", ContentSHA256: "hash", Origin: "tool_image"}}}
	build := func() (PreparedStep, error) {
		return BuildPreparedStep(ExecutionRef{}, 1, locked, PromptConfig{}, SurfaceManifest{}, []modelcore.Message{message}, nil, 1)
	}
	prepared, err := build()
	if err != nil || prepared.Request.Messages[0].Images[0].Origin != "tool_image" {
		t.Fatal(prepared, err)
	}
	locked.Capabilities.ImageInput = modelcore.Unknown
	if _, err = build(); err == nil {
		t.Fatal("unknown capability accepted")
	}
	locked.Capabilities.ImageInput = modelcore.Supported
	message.Images[0].Origin = ""
	if _, err = build(); err == nil {
		t.Fatal("ordinary tool image accepted")
	}
	message.Images[0].Origin = "tool_image"
	message.ToolCallID = ""
	if _, err = build(); err == nil {
		t.Fatal("uncorrelated image accepted")
	}
}
