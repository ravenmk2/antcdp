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
			content, err := json.Marshal(map[string]any{
				"source_event_seq":    agentcore.Seq(row.Seq),
				"tool_call_id":        evidence.ToolCallID,
				"provider_call_id":    call.ProviderCallID,
				"tool_key":            call.ToolKey,
				"original_result_seq": agentcore.Seq(*call.ResultEventSeq),
				"original_status":     "outcome_unknown",
				"observed_status":     evidence.Status,
				"executed":            evidence.Executed,
				"reason":              evidence.Reason,
				"observed_at":         evidence.ObservedAt,
				"note":                "Later verified observation of the original tool execution, not a new execution. Only the reported status is confirmed; missing output has not been recovered. A null executed value still means it is unknown whether the action started. Do not automatically repeat an external action.",
			})
			if err != nil {
				return err
			}
			fact := agentcore.ContextFact{Kind: "context/tool_reconciliation", Content: content}
			if _, err = appendEvent(st, session, &runID, fact.Kind, "reconciliation-context:"+strconv.FormatUint(row.Seq, 10), json.RawMessage(content), &StoredEvent{Context: &fact}, now); err != nil {
				return err
			}
		}
	}
}
