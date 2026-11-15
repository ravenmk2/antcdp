package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type favoriteHTTPStore struct {
	streamTestStore
	repo favoriteHTTPRepo
}

func (s *favoriteHTTPStore) Transact(_ context.Context, fn func(identity.Tx) error) error {
	return fn(favoriteHTTPTx{streamTestTx: streamTestTx{s: &s.streamTestStore}, repo: &s.repo})
}

type favoriteHTTPTx struct {
	streamTestTx
	repo *favoriteHTTPRepo
}

func (t favoriteHTTPTx) Agents() a.Repository { return t.repo }

type favoriteHTTPRepo struct {
	a.Repository
	agent            *a.Definition
	access, history  bool
	favorite         bool
	lastUser, lastID uint64
	lastQuery        a.Query
}

func (r *favoriteHTTPRepo) Definition(id uint64, _ bool) (*a.Definition, error) {
	if r.agent != nil && r.agent.ID == id {
		return r.agent, nil
	}
	return nil, nil
}
func (r *favoriteHTTPRepo) CanUseAgent(uint64, uint64, bool) (bool, error) {
	return r.access, nil
}
func (r *favoriteHTTPRepo) CanReadAgentHistory(uint64, uint64, bool) (bool, error) {
	return r.history, nil
}
func (r *favoriteHTTPRepo) FavoriteAgents(uint64, []uint64) (map[uint64]bool, error) {
	return map[uint64]bool{7: r.favorite}, nil
}
func (r *favoriteHTTPRepo) SaveFavorite(user, id uint64, value bool, _ time.Time) error {
	r.lastUser, r.lastID, r.favorite = user, id, value
	return nil
}
func (r *favoriteHTTPRepo) FavoriteDefinitions(user uint64, _ bool, q a.Query) ([]a.Definition, int, error) {
	r.lastUser, r.lastQuery = user, q
	return []a.Definition{}, 0, nil
}

func TestAgentFavoriteAndSummaryHTTP(t *testing.T) {
	now := time.Now().UTC()
	store := &favoriteHTTPStore{
		streamTestStore: streamTestStore{
			user:    identity.User{ID: 3, Role: "user", Status: "active", AuthVersion: 1},
			session: identity.Session{ID: 1, UserID: 3, AuthVersion: 1, ExpiresAt: now.Add(time.Hour)},
		},
		repo: favoriteHTTPRepo{agent: &a.Definition{ID: 7, Name: "Navigation agent", Mode: "interactive", SystemPrompt: "PRIVATE_PROMPT"}, access: true},
	}
	ident := identity.New(func() (identity.Store, error) { return store, nil })
	engine := gin.New()
	registerAgents(engine.Group("/api/v1"), Options{Identity: ident, Agents: &a.Service{Identity: ident, ETag: func(v string) string { return v }}})
	call := func(method, path, body string, expected int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1/agents"+path, strings.NewReader(body))
		req.Header.Set("Cookie", "antcdp_session="+strings.Repeat("x", 43))
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		if recorder.Code != expected {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, recorder.Code, expected, recorder.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	data := call("GET", "/7/summary", "", 200)["data"].(map[string]any)
	if len(data) != 3 || data["id"] != "7" || data["name"] != "Navigation agent" || data["favorited"] != false {
		t.Fatal("summary must expose only navigation identity", data)
	}
	call("PUT", "/favorites/7", "", 200)
	if !store.repo.favorite || store.repo.lastUser != 3 || store.repo.lastID != 7 {
		t.Fatal("favorite did not use authenticated user")
	}
	call("PUT", "/favorites/7", "", 200)
	data = call("GET", "/7/summary", "", 200)["data"].(map[string]any)
	if data["favorited"] != true {
		t.Fatal("summary missing current preference")
	}
	call("GET", "/favorites?page=2&page_size=5&q=agent", "", 200)
	if store.repo.lastQuery.Page != 2 || store.repo.lastQuery.PageSize != 5 || store.repo.lastQuery.Q != "agent" {
		t.Fatal("favorite pagination/search not forwarded")
	}
	store.repo.access = false
	call("GET", "/7/summary", "", 404)
	call("PUT", "/favorites/7", "", 404)
	store.repo.history = true
	call("GET", "/7/summary", "", 200)
	call("PUT", "/favorites/7", "", 404)
	store.repo.agent.DeletedAt = &now
	call("GET", "/7/summary", "", 200)
	call("DELETE", "/favorites/7", "", 200)
	call("DELETE", "/favorites/7", "", 200)
	if store.repo.favorite {
		t.Fatal("revoked/deleted favorite could not be cleared")
	}
	for _, path := range []string{"/0/summary", "/01/summary", "/7/summary?extra=1", "/favorites?page=0", "/favorites?page_size=101", "/favorites?user_id=4", "/favorites?page=1&page=2"} {
		call("GET", path, "", 422)
	}
	call("PUT", "/favorites/7", `{"user_id":"4"}`, 422)
	call("DELETE", "/favorites/7?user_id=4", "", 422)
	call("GET", "/8/summary", "", 404)
	store.user.Status = "disabled"
	call("GET", "/7/summary", "", 401)
	call("PUT", "/favorites/7", "", 401)
	call("DELETE", "/favorites/7", "", 401)
}
