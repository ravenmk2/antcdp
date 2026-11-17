package agentcore

import (
	"testing"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestToolDraftNameCanExtendButCannotChangeIdentity(t *testing.T) {
	h := NewHub("epoch")
	permit := AttemptPermit{Ref: ExecutionRef{SessionID: 1, RunID: 2, Epoch: "epoch"}, CallID: 3, Step: 1}
	if err := h.Start(permit); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"write_", "write_file"} {
		if err := h.Emit(t.Context(), permit, modelcore.Delta{Kind: "tool_call", BlockIndex: 0, DraftCallID: "draft", Name: name}); err != nil {
			t.Fatal(err)
		}
	}
	sub, snapshot := h.Subscribe(1)
	defer sub.Close()
	if name := snapshot.Active.Content[0].Name; name == nil || *name != "write_file" {
		t.Fatal("snapshot lost assembled name")
	}
	for _, name := range []string{"write_", "read_file"} {
		code(t, h.Emit(t.Context(), permit, modelcore.Delta{Kind: "tool_call", BlockIndex: 0, DraftCallID: "draft", Name: name}), "STREAM_INVALID")
	}
}
