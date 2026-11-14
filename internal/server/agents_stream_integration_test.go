package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	m "github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/config"
)

type streamTestStore struct {
	identity.Store
	mu      sync.Mutex
	user    identity.User
	session identity.Session
	chat    a.SessionRow
	events  []a.EventRow
	renewed int
}

func (s *streamTestStore) Transact(_ context.Context, fn func(identity.Tx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return fn(streamTestTx{s: s})
}

type streamTestTx struct {
	identity.Tx
	s *streamTestStore
}

func (t streamTestTx) Session([]byte, bool) (*identity.Session, error) {
	v := t.s.session
	return &v, nil
}
func (t streamTestTx) LockUsers([]uint64) (map[uint64]*identity.User, error) {
	v := t.s.user
	return map[uint64]*identity.User{v.ID: &v}, nil
}
func (streamTestTx) Password(uint64) (*identity.Password, error)       { return &identity.Password{}, nil }
func (streamTestTx) FounderID() (uint64, error)                        { return 1, nil }
func (t streamTestTx) RenewSession(uint64, time.Time, time.Time) error { t.s.renewed++; return nil }
func (t streamTestTx) Agents() a.Repository                            { return streamAgentRepo{} }
func (t streamTestTx) AgentState() a.StateRepository                   { return streamStateRepo{s: t.s} }
func (t streamTestTx) AgentObservations() a.ObservationRepository      { return streamObservationRepo{} }
func (t streamTestTx) Models() m.Repository                            { return streamModelRepo{} }

type streamAgentRepo struct{ a.Repository }

func (streamAgentRepo) CanUseAgent(_, userID uint64, _ bool) (bool, error) { return userID == 1, nil }

func (streamAgentRepo) Definition(uint64, bool) (*a.Definition, error) {
	return &a.Definition{ID: 1, Enabled: true, Mode: "interactive", ScopeKind: "platform"}, nil
}
func (streamAgentRepo) ModelBindings(uint64, bool) ([]a.ModelBinding, error) {
	return []a.ModelBinding{{ID: 1, AgentID: 1, ModelID: 1, ThinkingJSON: json.RawMessage(`["fixed"]`), DefaultThinking: "fixed", GenerationOverrides: json.RawMessage(`{}`)}}, nil
}

type streamModelRepo struct{ m.Repository }

func (streamModelRepo) Provider(uint64) (*m.Provider, error) {
	return &m.Provider{ID: 1, Type: "ollama", Enabled: true, AuthMethod: "none", SecretValid: true, SchemaVersion: 1, StoredConfig: json.RawMessage(`{"base_url":"http://model.test"}`), BaseURL: "http://model.test", IdentityConfig: json.RawMessage(`{}`)}, nil
}
func (streamModelRepo) Definition(uint64, bool) (*m.Definition, error) {
	return &m.Definition{ID: 1, ProviderID: 1, Enabled: true, Protocol: "chat_completions", SchemaVersion: 1, CapabilitiesJSON: json.RawMessage(`{"text_input":"supported"}`), ThinkingJSON: json.RawMessage(`[{"key":"fixed","label":"固定","parameters":{}}]`), Parameters: json.RawMessage(`{}`)}, nil
}

type streamStateRepo struct {
	a.StateRepository
	s *streamTestStore
}

func (t streamStateRepo) Session(id uint64, _ bool) (*a.SessionRow, error) {
	if id != 1 {
		return nil, nil
	}
	v := t.s.chat
	return &v, nil
}
func (streamStateRepo) SessionCounts(uint64) (a.SessionCounts, error)             { return a.SessionCounts{}, nil }
func (streamStateRepo) Preference(uint64, uint64, bool) (*a.PreferenceRow, error) { return nil, nil }
func (streamStateRepo) LatestResult(uint64) (*a.RunResultRef, error)              { return nil, nil }
func (streamStateRepo) UnviewedResults(uint64, uint64) (int, error)               { return 0, nil }
func (streamStateRepo) Inputs(uint64, a.InputQuery) ([]a.InputRow, int, error) {
	return []a.InputRow{}, 0, nil
}
func (t streamStateRepo) Events(_ uint64, after, through uint64, limit int, desc bool) ([]a.EventRow, error) {
	out := []a.EventRow{}
	if desc {
		for i := len(t.s.events) - 1; i >= 0; i-- {
			v := t.s.events[i]
			if v.Seq > after && v.Seq <= through {
				out = append(out, v)
				if len(out) == limit {
					break
				}
			}
		}
	} else {
		for _, v := range t.s.events {
			if v.Seq > after && v.Seq <= through {
				out = append(out, v)
				if len(out) == limit {
					break
				}
			}
		}
	}
	return out, nil
}

type streamObservationRepo struct{ a.ObservationRepository }

func (streamObservationRepo) HistoryGroups(uint64, uint64, uint64) ([]a.SequenceRange, error) {
	return nil, nil
}
func (streamObservationRepo) InteractionPage(uint64, a.ObservationQuery) ([]a.InteractionRow, int, error) {
	return []a.InteractionRow{}, 0, nil
}

func streamEvent(t *testing.T, seq uint64) a.EventRow {
	t.Helper()
	raw, e := agentcore.CanonicalJSON(a.StoredEvent{Public: json.RawMessage(`{"attempt_id":"4","model_call_id":"4","content":[{"type":"text","text":"saved"}],"finish_reason":"stop"}`), Message: &modelcore.Message{Role: "assistant", Native: json.RawMessage(`{"opaque":"INTERNAL_NATIVE_SECRET"}`)}})
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(raw)
	return a.EventRow{SessionID: 1, Seq: seq, SchemaVersion: 1, EventType: "assistant/message", Payload: raw, PayloadSizeBytes: uint64(len(raw)), PayloadSHA256: hash[:]}
}
func TestAgentWebSocketSnapshotCatchupResyncAndRevocation(t *testing.T) {
	now := time.Now().UTC()
	store := &streamTestStore{user: identity.User{ID: 1, Role: "admin", Status: "active", AuthVersion: 1}, session: identity.Session{ID: 1, UserID: 1, AuthVersion: 1, ExpiresAt: now.Add(time.Hour)}, chat: a.SessionRow{ID: 1, AgentID: 1, ExecutionMode: "interactive", SessionKind: "root", ExecutorUserID: 1, SelectedModelBindingID: 1, SelectedThinkingOptionKey: "fixed", ModelLockedAt: &now, LockedModelConfig: json.RawMessage(`{"schema_version":1,"selection_hash":"locked","thinking_option_key":"fixed","display":{}}`), LastSeq: 1}, events: []a.EventRow{streamEvent(t, 1)}}
	ident := identity.New(func() (identity.Store, error) { return store, nil })
	models := &m.Service{ETag: func(v string) string { return v }}
	svc := &a.Service{Identity: ident, ETag: func(v string) string { return v }, Models: models}
	hub := agentcore.NewHub("epoch")
	engine := gin.New()
	options := Options{Identity: ident, Agents: svc, AgentHub: hub, Runtime: config.Runtime{Server: config.Server{PublicURL: "http://antcdp.test"}}}
	registerAgentStream(engine.Group("/api/v1/agents"), options)
	server := httptest.NewServer(engine)
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"antcdp.agent.v1"}}
	headers := http.Header{"Origin": []string{"http://antcdp.test"}, "Cookie": []string{"antcdp_session=" + strings.Repeat("x", 43)}}
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/agents/stream"
	bad := headers.Clone()
	bad.Set("Origin", "http://foreign.test")
	if conn, response, e := dialer.Dial(endpoint, bad); e == nil {
		_ = conn.Close()
		t.Fatal("cross origin connected")
	} else if response == nil || response.StatusCode != 403 {
		t.Fatal("wrong origin result", response, e)
	}
	conn, _, e := dialer.Dial(endpoint, headers)
	if e != nil {
		t.Fatal(e)
	}
	defer func() { _ = conn.Close() }()
	read := func() map[string]any {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		var value map[string]any
		if e := conn.ReadJSON(&value); e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(value)
		if strings.Contains(string(raw), "INTERNAL_NATIVE_SECRET") {
			t.Fatal("native leaked")
		}
		return value
	}
	send := func(value any) {
		t.Helper()
		if e := conn.WriteJSON(value); e != nil {
			t.Fatal(e)
		}
	}
	send(map[string]any{"type": "subscribe", "subscription_id": "main", "session_id": "1"})
	snapshot := read()
	if snapshot["type"] != "snapshot" || snapshot["through_seq"] != "1" || snapshot["data"] != nil {
		t.Fatalf("not native WS snapshot %+v", snapshot)
	}
	permit := agentcore.AttemptPermit{Ref: agentcore.ExecutionRef{SessionID: 1, RunID: 3, Epoch: "epoch"}, CallID: 4, Step: 1}
	if e = hub.Start(permit); e != nil {
		t.Fatal(e)
	}
	start := read()
	if start["type"] != "assistant_stream" || start["kind"] != "start" {
		t.Fatal(start)
	}
	store.mu.Lock()
	store.events = append(store.events, streamEvent(t, 2))
	store.chat.LastSeq = 2
	store.mu.Unlock()
	hub.Committed(t.Context(), agentcore.CommitReceipt{Ranges: []agentcore.EventRange{{SessionID: 1, From: 2, Through: 2}}})
	seq := agentcore.Seq(2)
	if e = hub.End(permit, agentcore.StreamOutcome{Kind: "committed", EventSeq: &seq}); e != nil {
		t.Fatal(e)
	}
	event, end := read(), read()
	if event["type"] != "event" || event["seq"] != "2" || end["kind"] != "end" {
		t.Fatal(event, end)
	}
	send(map[string]any{"type": "resync", "subscription_id": "main"})
	snapshot = read()
	if snapshot["type"] != "snapshot" || snapshot["through_seq"] != "2" {
		t.Fatal(snapshot)
	}
	send(map[string]any{"type": "unsubscribe", "subscription_id": "main"})
	if read()["type"] != "unsubscribed" {
		t.Fatal("missing unsubscribe acknowledgement")
	}
	send(map[string]any{"type": "subscribe", "subscription_id": "main", "session_id": "1"})
	if read()["code"] != "SUBSCRIPTION_EXISTS" {
		t.Fatal("reused subscription accepted")
	}
	send(map[string]any{"type": "subscribe", "subscription_id": "hidden", "session_id": "2"})
	if read()["type"] != "access_revoked" {
		t.Fatal("unseen session existence leaked")
	}
	send(map[string]any{"type": "ping", "nonce": "alive"})
	if pong := read(); pong["type"] != "pong" || pong["nonce"] != "alive" {
		t.Fatal(pong)
	}
	store.mu.Lock()
	store.user.Status = "disabled"
	renewed := store.renewed
	store.mu.Unlock()
	if renewed != 0 {
		t.Fatal("passive observation renewed login")
	}
	send(map[string]any{"type": "ping", "nonce": "revoked"})
	if read()["code"] != "UNAUTHENTICATED" {
		t.Fatal("revoked cookie remained connected")
	}
}
