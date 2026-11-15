package server

import (
	"errors"
	"slices"

	"github.com/gorilla/websocket"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (w *agentWS) globalAuthenticationError(err error) error {
	_ = w.problem("", "UNAUTHENTICATED")
	w.close(websocket.ClosePolicyViolation)
	return err
}

func (w *agentWS) writeSessionChanges(ids []agentcore.ID, resync bool) error {
	if ids == nil {
		ids = []agentcore.ID{}
	}
	return w.write(map[string]any{"type": "sessions_changed", "subscription_id": w.globalID, "session_ids": ids, "resync": resync})
}

func (w *agentWS) sessionsChanged() error {
	if _, e := w.options.Identity.ObserveAccess(w.ctx, w.raw, nil); e != nil {
		return w.globalAuthenticationError(e)
	}
	changes, resync := w.changes.Drain()
	if resync {
		return w.writeSessionChanges(nil, true)
	}
	ids := []agentcore.ID{}
	seen := map[agentcore.ID]bool{}
	for _, change := range changes {
		if change.UserID != 0 && uint64(change.UserID) != w.userID || seen[change.SessionID] {
			continue
		}
		seen[change.SessionID] = true
		if e := w.options.Agents.CheckObservation(w.ctx, w.raw, uint64(change.SessionID)); e != nil {
			var problem *httpx.Error
			if errors.As(e, &problem) {
				if problem.Status == 401 || problem.Code == "PASSWORD_CHANGE_REQUIRED" {
					return w.globalAuthenticationError(e)
				}
				if problem.Status == 403 || problem.Status == 404 {
					continue
				}
			}
			// A failed permission read is not evidence of revocation. Reconnect
			// and synchronize instead of losing this invalidation permanently.
			return e
		}
		ids = append(ids, change.SessionID)
	}
	if len(ids) == 0 {
		return nil
	}
	slices.Sort(ids)
	return w.writeSessionChanges(ids, false)
}
