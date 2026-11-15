package agentcore

import "testing"

func TestSessionChangesCoalesceOverflowAndClose(t *testing.T) {
	h := NewHub("test")
	h.maxNotices = 2
	s := h.SubscribeSessions()
	h.Committed(t.Context(), CommitReceipt{Ranges: []EventRange{{SessionID: 1}, {SessionID: 1}}})
	h.SessionChanged(SessionChange{SessionID: 1})
	<-s.Ready()
	changes, resync := s.Drain()
	if resync || len(changes) != 1 || changes[0].SessionID != 1 {
		t.Fatal(changes, resync)
	}
	for i := ID(1); i <= 3; i++ {
		h.SessionChanged(SessionChange{SessionID: i})
	}
	<-s.Ready()
	changes, resync = s.Drain()
	if !resync || len(changes) != 0 {
		t.Fatal("overflow must request a fresh baseline", changes, resync)
	}
	h.SessionChanged(SessionChange{SessionID: 1, UserID: 2})
	<-s.Ready()
	changes, resync = s.Drain()
	if resync || len(changes) != 1 || changes[0].UserID != 2 {
		t.Fatal("subscription did not recover", changes, resync)
	}
	s.Close()
	h.SessionChanged(SessionChange{SessionID: 1})
	select {
	case <-s.Ready():
		t.Fatal("closed subscriber received a change")
	default:
	}
}
