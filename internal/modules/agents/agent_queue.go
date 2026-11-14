package agents

import (
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// Disabling admission cancels waiting inputs; it does not stop an admitted turn.
// Re-enabling never revives the cancelled inputs.
func (s *Service) cancelAgentQueue(tx identity.Tx, r Repository, out *Result, id uint64, reason string) error {
	st, err := StateFor(tx)
	if err != nil {
		return err
	}
	ids, err := r.AgentSessionIDs(id)
	if err != nil {
		return err
	}
	for _, sessionID := range ids {
		session, err := st.Session(sessionID, true)
		if err != nil {
			return err
		}
		if session == nil {
			return integrity()
		}
		receipt, err := cancelSessionQueue(st, session, reason, time.Now().UTC().Truncate(time.Millisecond))
		if err != nil {
			return err
		}
		if len(receipt.Ranges) > 0 {
			out.Commits = append(out.Commits, receipt)
		}
	}
	return nil
}

func cancelSessionQueue(st StateRepository, session *SessionRow, reason string, now time.Time) (agentcore.CommitReceipt, error) {
	from := session.LastSeq + 1
	for {
		rows, _, err := st.Inputs(session.ID, InputQuery{Page: 1, PageSize: 100, State: "pending"})
		if err != nil {
			return agentcore.CommitReceipt{}, err
		}
		if len(rows) == 0 {
			break
		}
		for i := range rows {
			input := &rows[i]
			input.Status = "cancelled"
			input.RowVersion++
			input.UpdatedAt = now
			input.EndedAt = &now
			input.EndReason = &reason
			if err = st.SaveInput(input); err != nil {
				return agentcore.CommitReceipt{}, err
			}
			if _, err = appendEvent(st, session, nil, "input/cancelled", "", map[string]any{"input_id": agentcore.ID(input.ID), "revision": agentcore.Version(input.ContentRevision), "reason": reason, "actor_ref": nil}, nil, now); err != nil {
				return agentcore.CommitReceipt{}, err
			}
		}
	}
	interactions, err := st.SessionInteractions(session.ID)
	if err != nil {
		return agentcore.CommitReceipt{}, err
	}
	for i := range interactions {
		q := &interactions[i]
		switch q.Status {
		case "pending", "waiting", "continued", "reply_queued", "approved_once":
		default:
			continue
		}
		if q.ApprovalConsumedAt != nil {
			continue
		}
		q.Status, q.PendingReplyInputID = "cancelled", nil
		q.RowVersion++
		q.UpdatedAt = now
		if err = st.SaveInteraction(q); err != nil {
			return agentcore.CommitReceipt{}, err
		}
		if _, err = appendEvent(st, session, &q.RunID, "interaction/decided", "", map[string]any{"interaction_id": agentcore.ID(q.ID), "kind": q.Kind, "status": "cancelled", "actor_ref": nil, "answer": nil, "decision": nil, "pending_reply_input_id": nil, "reason": reason}, nil, now); err != nil {
			return agentcore.CommitReceipt{}, err
		}
	}
	if session.LastSeq < from {
		return agentcore.CommitReceipt{}, nil
	}
	if err := st.SaveSession(session); err != nil {
		return agentcore.CommitReceipt{}, err
	}
	return eventReceipt(session.ID, from, session.LastSeq), nil
}
