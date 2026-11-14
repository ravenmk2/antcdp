package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// Logical completion fences callbacks immediately. The session activity slot is
// retained until every child, remote execution and file operation has settled.
func settleFamily(st StateRepository, root *RunRow, sessions map[uint64]*SessionRow, now time.Time) error {
	if root.SettledAt != nil || !agentcore.RunStatus(root.Status).Terminal() {
		return nil
	}
	pending, err := st.RootPhysicalPending(root.ID)
	if err != nil {
		return err
	}
	if pending {
		root.UpdatedAt = now
		return st.SaveRun(root)
	}
	if err = st.ReleaseRootSkills(root.ID, now); err != nil {
		return err
	}
	family, err := st.FamilyRuns(root.ID)
	if err != nil {
		return err
	}
	for i := range family {
		run := &family[i]
		if run.SettledAt != nil {
			continue
		}
		if !agentcore.RunStatus(run.Status).Terminal() {
			return integrity()
		}
		session := sessions[run.SessionID]
		if session == nil || session.ActiveRunID == nil || *session.ActiveRunID != run.ID {
			return integrity()
		}
		run.SettledAt, run.UpdatedAt = &now, now
		session.ActiveRunID = nil
		seq, err := appendEvent(st, session, &run.ID, "run/settled", "", map[string]any{"run_id": agentcore.ID(run.ID), "settled_at": now, "physical_activity_state": "none"}, nil, now)
		if err != nil {
			return err
		}
		run.ProjectionSeq = seq
		if err = st.SaveRun(run); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) settleCompletedRoots(ctx context.Context, limit int) ([]agentcore.CommitReceipt, error) {
	var candidates []RunRow
	err := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		var err error
		candidates, err = st.UnsettledRoots(limit)
		return err
	})
	if err != nil {
		return nil, err
	}
	out := []agentcore.CommitReceipt{}
	for _, candidate := range candidates {
		err = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			rootSession, err := st.Session(candidate.SessionID, true)
			if err != nil {
				return err
			}
			if rootSession == nil {
				return integrity()
			}
			family, err := st.FamilyRuns(candidate.ID)
			if err != nil {
				return err
			}
			sessions := map[uint64]*SessionRow{rootSession.ID: rootSession}
			starts := map[uint64]uint64{rootSession.ID: rootSession.LastSeq + 1}
			for _, member := range family {
				if member.SessionID == rootSession.ID {
					continue
				}
				v, err := st.Session(member.SessionID, true)
				if err != nil {
					return err
				}
				if v == nil {
					return integrity()
				}
				sessions[v.ID], starts[v.ID] = v, v.LastSeq+1
			}
			root, err := st.Run(candidate.ID, true)
			if err != nil {
				return err
			}
			if root == nil {
				return integrity()
			}
			if err = settleFamily(st, root, sessions, time.Now().UTC().Truncate(time.Millisecond)); err != nil {
				return err
			}
			receipt := agentcore.CommitReceipt{}
			for _, member := range family {
				v := sessions[member.SessionID]
				if v.LastSeq < starts[v.ID] {
					continue
				}
				if err = st.SaveSession(v); err != nil {
					return err
				}
				receipt.Ranges = append(receipt.Ranges, agentcore.EventRange{SessionID: agentcore.ID(v.ID), From: agentcore.Seq(starts[v.ID]), Through: agentcore.Seq(v.LastSeq)})
			}
			if len(receipt.Ranges) > 0 {
				out = append(out, receipt)
			}
			return nil
		})
		if err != nil {
			return out, err
		}
	}
	return out, nil
}
