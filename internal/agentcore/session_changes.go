package agentcore

// SessionChange is a post-commit invalidation hint, not a durable event or a
// content stream. UserID restricts personal preferences to their owner.
type SessionChange struct {
	SessionID ID
	UserID    ID
}

// SessionChanges coalesces pending hints. Overflow requires a fresh list read;
// it must never silently drop the final state of a session.
type SessionChanges struct {
	hub     *Hub
	wake    chan struct{}
	pending map[SessionChange]struct{}
	resync  bool
}

func (h *Hub) SubscribeSessions() *SessionChanges {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := &SessionChanges{hub: h, wake: make(chan struct{}, 1), pending: map[SessionChange]struct{}{}}
	h.changes[s] = struct{}{}
	return s
}

func (s *SessionChanges) Ready() <-chan struct{} { return s.wake }

func (s *SessionChanges) Drain() ([]SessionChange, bool) {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	changes := make([]SessionChange, 0, len(s.pending))
	for change := range s.pending {
		changes = append(changes, change)
	}
	clear(s.pending)
	resync := s.resync
	s.resync = false
	return changes, resync
}

func (s *SessionChanges) Close() {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	delete(s.hub.changes, s)
	clear(s.pending)
}

func (h *Hub) SessionChanged(change SessionChange) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sessionChanged(change)
}

func (h *Hub) sessionChanged(change SessionChange) {
	for sub := range h.changes {
		if !sub.resync {
			sub.pending[change] = struct{}{}
			if len(sub.pending) > h.maxNotices {
				clear(sub.pending)
				sub.resync = true
			}
		}
		select {
		case sub.wake <- struct{}{}:
		default:
		}
	}
}
