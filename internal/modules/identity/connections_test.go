package identity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

type connectionStore struct {
	Store
	users    map[uint64]User
	sessions map[uint64]Session
	fail     bool
	after    func()
}
type connectionTx struct {
	Tx
	users    map[uint64]*User
	sessions map[uint64]*Session
}

func (s *connectionStore) Transact(_ context.Context, fn func(Tx) error) error {
	tx := connectionTx{users: map[uint64]*User{}, sessions: map[uint64]*Session{}}
	for id, u := range s.users {
		tx.users[id] = &u
	}
	for id, v := range s.sessions {
		tx.sessions[id] = &v
	}
	if err := fn(tx); err != nil {
		return err
	}
	if s.fail {
		return errors.New("commit failed")
	}
	for id, u := range tx.users {
		s.users[id] = *u
	}
	for id, v := range tx.sessions {
		s.sessions[id] = *v
	}
	if s.after != nil {
		f := s.after
		s.after = nil
		f()
	}
	return nil
}
func (t connectionTx) Session(hash []byte, _ bool) (*Session, error) {
	// Tests use distinct tokens whose digest is stored with each login.
	for _, ss := range t.sessions {
		if string(ss.Hash) == string(hash) {
			return ss, nil
		}
	}
	return nil, nil
}
func (t connectionTx) LockUsers(ids []uint64) (map[uint64]*User, error) {
	users := map[uint64]*User{}
	for _, id := range ids {
		if u := t.users[id]; u != nil {
			users[id] = u
		}
	}
	return users, nil
}
func (connectionTx) Password(uint64) (*Password, error) { return &Password{}, nil }
func (connectionTx) FounderID() (uint64, error)         { return 1, nil }
func (connectionTx) Audit(Event) error                  { return nil }
func (connectionTx) SaveUser(*User) error               { return nil }
func (connectionTx) DeletePassword(uint64) error        { return nil }
func (t connectionTx) RenewSession(id uint64, seen, expires time.Time) error {
	t.sessions[id].LastSeenAt = seen
	t.sessions[id].ExpiresAt = expires
	return nil
}
func (t connectionTx) RevokeSession(id uint64, now time.Time) error {
	t.sessions[id].RevokedAt = &now
	return nil
}
func (t connectionTx) RevokeSessions(id uint64, now time.Time) error {
	for _, ss := range t.sessions {
		if ss.UserID == id {
			ss.RevokedAt = &now
		}
	}
	return nil
}

func connectionFixture() (*Service, *connectionStore, string, string) {
	now := time.Now().UTC()
	admin, user := strings.Repeat("a", 43), strings.Repeat("u", 43)
	store := &connectionStore{users: map[uint64]User{
		1: {ID: 1, Role: "admin", Status: "active", AuthVersion: 1, Version: 1},
		2: {ID: 2, Username: "reader", Role: "admin", Status: "active", AuthVersion: 1, Version: 1},
	}, sessions: map[uint64]Session{
		1: {ID: 1, UserID: 1, Hash: cryptox.Digest(admin), AuthVersion: 1, Days: 1, ExpiresAt: now.Add(time.Hour)},
		2: {ID: 2, UserID: 2, Hash: cryptox.Digest(user), AuthVersion: 1, Days: 1, ExpiresAt: now.Add(time.Hour)},
	}}
	s := &Service{provider: func() (Store, error) { return store, nil }, now: func() time.Time { return now }}
	return s, store, admin, user
}

func TestConnectionsRevokeOnlyAfterCommittedSecurityChanges(t *testing.T) {
	for _, change := range []string{"disable", "role", "delete", "logout"} {
		t.Run(change, func(t *testing.T) {
			s, store, admin, user := connectionFixture()
			watch, err := s.ObserveConnection(t.Context(), user)
			if err != nil {
				t.Fatal(err)
			}
			defer watch.Close()
			other, err := s.ObserveConnection(t.Context(), admin)
			if err != nil {
				t.Fatal(err)
			}
			defer other.Close()
			mutate := func() error {
				switch change {
				case "disable":
					_, _, e := s.SetStatus(t.Context(), admin, 2, `"u-2-v1"`, "disabled", Metadata{})
					return e
				case "role":
					_, _, e := s.SetRole(t.Context(), admin, 2, `"u-2-v1"`, "user", Metadata{})
					return e
				case "delete":
					_, e := s.DeleteUser(t.Context(), admin, 2, `"u-2-v1"`, "reader", Metadata{})
					return e
				default:
					return s.Logout(t.Context(), user, Metadata{})
				}
			}
			store.fail = true
			if mutate() == nil {
				t.Fatal("expected rollback")
			}
			select {
			case <-watch.Done():
				t.Fatal("rolled back change revoked connection")
			default:
			}
			store.fail = false
			if err := mutate(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-watch.Done():
			default:
				t.Fatal("committed change did not revoke")
			}
			select {
			case <-other.Done():
				t.Fatal("unrelated login revoked")
			default:
			}
			if _, err := s.ObserveConnection(t.Context(), user); err == nil {
				t.Fatal("revoked login reconnected")
			}
		})
	}
}

func TestConnectionRegistrationCannotMissRevocation(t *testing.T) {
	s, store, _, user := connectionFixture()
	store.after = func() {
		if err := s.Logout(t.Context(), user, Metadata{}); err != nil {
			t.Fatal(err)
		}
	}
	if c, err := s.ObserveConnection(t.Context(), user); err == nil {
		c.Close()
		t.Fatal("stale authentication registered after logout")
	}
}

func TestConnectionExpiryHonorsHTTPRenewalWithoutRenewingItself(t *testing.T) {
	s, store, _, user := connectionFixture()
	c, err := s.ObserveConnection(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	initial := c.Auth().Session.ExpiresAt
	if _, err := s.Current(t.Context(), user); err != nil {
		t.Fatal(err)
	}
	now := initial.Add(time.Second)
	s.now = func() time.Time { return now }
	expires, err := s.ConnectionExpiry(t.Context(), user, c)
	if err != nil || !expires.After(initial) {
		t.Fatal("HTTP renewal lost", expires, err)
	}
	if !store.sessions[2].ExpiresAt.Equal(expires) {
		t.Fatal("observation renewed session")
	}
	now = expires.Add(time.Second)
	if _, err := s.ConnectionExpiry(t.Context(), user, c); err == nil {
		t.Fatal("expired session accepted")
	}
}
