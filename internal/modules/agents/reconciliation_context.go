package agents

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

// Admit asynchronous observations at a step boundary, not while a frozen
// request may still be retried. The original result and preceding prefix stay
// immutable. The semantic key also prevents re-admission after compaction.
func appendReconciliationContext(st StateRepository, session *SessionRow, runID uint64, now time.Time) error {
	through := session.LastSeq
	for {
		rows, err := st.PendingReconciliationEvents(session.ID, through, 500)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			stored, err := decodeEvent(row)
			if err != nil {
				return err
			}
			var evidence struct {
				ToolCallID agentcore.ID `json:"tool_call_id"`
				Status     string       `json:"observed_status"`
				Executed   *bool        `json:"executed"`
				Reason     string       `json:"reason"`
				ObservedAt time.Time    `json:"observed_at"`
			}
			if row.SessionID != session.ID || row.EventType != "tool/reconciled" || json.Unmarshal(stored.Public, &evidence) != nil || evidence.ToolCallID == 0 || evidence.Status != "succeeded" && evidence.Status != "failed" && evidence.Status != "cancelled" {
				return integrity()
			}
			call, err := st.ToolCall(uint64(evidence.ToolCallID), false)
			if err != nil {
				return err
			}
			if call == nil || call.SessionID != session.ID || call.ResultEventSeq == nil || row.RunID == nil || call.RunID != *row.RunID {
				return integrity()
			}
			fact := agentcore.ContextFact{Kind: "tool-reconciliation", Form: "notice", SourceEventSeq: agentcore.Seq(row.Seq), ToolCallID: evidence.ToolCallID, Summary: "Updated tool execution result"}
			update, err := json.Marshal(map[string]any{
				"provider_call_id": call.ProviderCallID, "tool": call.ToolKey, "original_status": "outcome_unknown", "observed_status": evidence.Status, "executed": evidence.Executed,
			})
			if err != nil {
				return err
			}
			if err = appendContextMessage(st, session, runID, "reconciliation-context:"+strconv.FormatUint(row.Seq, 10), fact, "Updated tool execution result:\n"+string(update), now); err != nil {
				return err
			}
		}
	}
}
