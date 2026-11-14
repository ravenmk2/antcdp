package agents

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

// A human answer is input to a new turn. It can satisfy confirmation for one
// identical, never-executed action only after this turn has independently
// authorized the tool and its actual resource arguments.
func consumeApprovalResponse(st StateRepository, x executionRows, row *ToolCallRow, call agentcore.PreparedToolCall, now time.Time) (bool, error) {
	if x.Run.ID != x.Root.ID || x.Root.TriggerInputID == nil {
		return false, nil
	}
	input, err := st.Input(*x.Root.TriggerInputID, false)
	if err != nil {
		return false, err
	}
	if input == nil || input.InputKind != "approval_reply" || input.QuestionInteractionID == nil {
		return false, nil
	}
	q, err := st.Interaction(*input.QuestionInteractionID, true)
	if err != nil {
		return false, err
	}
	if q == nil || q.Kind != "approval" || q.Status != "approved_once" || q.SessionID != x.Session.ID || q.ApprovalConsumedAt != nil || q.RunID == x.Run.ID {
		return false, nil
	}
	old, err := st.ToolCall(q.ToolCallID, false)
	if err != nil {
		return false, err
	}
	if old == nil || old.DispatchToken != nil || old.Executed == nil || *old.Executed || old.ResultEventSeq == nil || old.ToolKey != row.ToolKey || !bytes.Equal(old.ArgumentsHash, row.ArgumentsHash) {
		return false, nil
	}
	var spec agentcore.ToolSpec
	if json.Unmarshal(old.ToolDefinitionSnapshot, &spec) != nil {
		return false, integrity()
	}
	if !semanticSame(spec.Definition, call.Spec.Definition) || !semanticSame(spec.MCP, call.Spec.MCP) {
		return false, nil
	}
	q.ApprovalConsumedAt, q.UpdatedAt = &now, now
	q.RowVersion++
	if err = st.SaveInteraction(q); err != nil {
		return false, err
	}
	row.InteractionID = &q.ID
	return true, nil
}
