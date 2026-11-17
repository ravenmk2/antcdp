package identity

import (
	"context"
	"sync"
	"time"
)

// Connection holds an authenticated observation identity until a committed
// security change revokes it. It never renews a login itself.
type Connection struct {
	service *Service
	auth    *Auth
	done    chan struct{}
}

type connections struct {
	mu         sync.Mutex
	generation uint64
	users      map[uint64]map[*Connection]struct{}
	sessions   map[uint64]map[*Connection]struct{}
}

func (c *Connection) Auth() *Auth           { return c.auth }
func (c *Connection) Done() <-chan struct{} { return c.done }

func (c *Connection) Close() {
	r := &c.service.connections
	r.mu.Lock()
	defer r.mu.Unlock()
	r.remove(c)
}

func (r *connections) remove(c *Connection) {
	delete(r.users[c.auth.User.ID], c)
	if len(r.users[c.auth.User.ID]) == 0 {
		delete(r.users, c.auth.User.ID)
	}
	delete(r.sessions[c.auth.Session.ID], c)
	if len(r.sessions[c.auth.Session.ID]) == 0 {
		delete(r.sessions, c.auth.Session.ID)
	}
}

func (s *Service) revokeConnections(userID, sessionID uint64) {
	r := &s.connections
	r.mu.Lock()
	defer r.mu.Unlock()
	r.generation++
	items := r.users[userID]
	if sessionID != 0 {
		items = r.sessions[sessionID]
	}
	for c := range items {
		close(c.done)
		r.remove(c)
	}
}

// ObserveConnection retries if revocation races authentication and registration.
// The generation and registry share a lock, so no newly registered connection
// can miss an invalidation that followed its authentication read.
func (s *Service) ObserveConnection(ctx context.Context, raw string) (*Connection, error) {
	r := &s.connections
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		r.mu.Lock()
		generation := r.generation
		r.mu.Unlock()
		auth, err := s.ObserveAccess(ctx, raw, nil)
		if err != nil {
			return nil, err
		}
		r.mu.Lock()
		if generation != r.generation {
			r.mu.Unlock()
			continue
		}
		c := &Connection{service: s, auth: auth, done: make(chan struct{})}
		if r.users == nil {
			r.users = make(map[uint64]map[*Connection]struct{})
			r.sessions = make(map[uint64]map[*Connection]struct{})
		}
		if r.users[auth.User.ID] == nil {
			r.users[auth.User.ID] = make(map[*Connection]struct{})
		}
		if r.sessions[auth.Session.ID] == nil {
			r.sessions[auth.Session.ID] = make(map[*Connection]struct{})
		}
		r.users[auth.User.ID][c] = struct{}{}
		r.sessions[auth.Session.ID][c] = struct{}{}
		r.mu.Unlock()
		return c, nil
	}
}

// ConnectionAccess reuses the connection identity for observation reads. The
// caller owns expiry handling; revocation also cancels its request context.
func (s *Service) ConnectionAccess(ctx context.Context, c *Connection, fn func(Tx, *Auth) error) (*Auth, error) {
	if c == nil || c.service != s {
		return nil, unauthorized()
	}
	select {
	case <-c.done:
		return nil, unauthorized()
	default:
	}
	store, err := s.store()
	if err != nil {
		return nil, err
	}
	err = store.Transact(ctx, func(tx Tx) error { return fn(tx, c.auth) })
	if err != nil {
		return nil, storageError(err)
	}
	select {
	case <-c.done:
		return nil, unauthorized()
	default:
	}
	return c.auth, nil
}

// ConnectionExpiry checks only at the previously known deadline, allowing HTTP
// sliding renewal without polling or extending the login through heartbeats.
func (s *Service) ConnectionExpiry(ctx context.Context, raw string, c *Connection) (time.Time, error) {
	if c == nil || c.service != s {
		return time.Time{}, unauthorized()
	}
	a, err := s.ObserveAccess(ctx, raw, nil)
	if err != nil {
		return time.Time{}, err
	}
	if a.Session.ID != c.auth.Session.ID || a.User.AuthVersion != c.auth.User.AuthVersion {
		return time.Time{}, unauthorized()
	}
	return a.Session.ExpiresAt, nil
}
