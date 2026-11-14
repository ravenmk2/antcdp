package agentresources

import (
	"context"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type debugStub struct{ closed int }

func (s *debugStub) Close() error                                  { s.closed++; return nil }
func (*debugStub) Discover(context.Context) (mcp.Discovery, error) { return mcp.Discovery{}, nil }
func (*debugStub) Call(context.Context, mcp.CallRequest) (mcp.CallResult, error) {
	return mcp.CallResult{}, nil
}

func TestDebugRegistryOwnershipConcurrencyAndInvalidation(t *testing.T) {
	s := &Service{}
	auth := &identity.Auth{User: &identity.User{ID: 1}, Session: &identity.Session{ID: 2}}
	v := &MCPServer{ID: 3, ConfigVersion: 1, SecretRevision: 1, Enabled: true}
	entry, err := s.acquireDebug(auth, v, "", true)
	if err != nil {
		t.Fatal(err)
	}
	client := &debugStub{}
	entry.client = client
	if _, err := s.acquireDebug(auth, v, entry.id, false); err == nil {
		t.Fatal("concurrent use accepted")
	}
	s.releaseDebug(entry, true)
	other := &identity.Auth{User: auth.User, Session: &identity.Session{ID: 4}}
	if _, err := s.acquireDebug(other, v, entry.id, false); err == nil {
		t.Fatal("another login accessed session")
	}
	if client.closed != 0 {
		t.Fatal("another login evicted owner session")
	}
	reused, err := s.acquireDebug(auth, v, entry.id, false)
	if err != nil || reused != entry {
		t.Fatal("session not reused", err)
	}
	s.releaseDebug(reused, true)
	v.SecretRevision++
	if _, err := s.acquireDebug(auth, v, entry.id, false); err == nil || client.closed != 1 {
		t.Fatal("credential change did not retire session")
	}
	s.CloseMCPDebug()
	if client.closed != 1 {
		t.Fatal("session closed twice")
	}
}

func TestDebugRegistryExpiryAndCapacity(t *testing.T) {
	s := &Service{}
	a := &identity.Auth{User: &identity.User{ID: 1}, Session: &identity.Session{ID: 2}}
	v := &MCPServer{ID: 3}
	for range 4 {
		e, err := s.acquireDebug(a, v, "", true)
		if err != nil {
			t.Fatal(err)
		}
		s.releaseDebug(e, true)
		e.lastUsed = time.Now().Add(-11 * time.Minute)
	}
	if _, err := s.acquireDebug(a, v, "", true); err == nil {
		t.Fatal("per-user limit exceeded")
	}
	if err := s.CleanupMCPDebug(t.Context()); err != nil {
		t.Fatal(err)
	}
	e, err := s.acquireDebug(a, v, "", true)
	if err != nil {
		t.Fatal(err)
	}
	s.releaseDebug(e, false)
	if len(s.debugSessions) != 0 {
		t.Fatal("retired session retained")
	}
}
