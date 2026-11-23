package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type idleTerminal struct {
	sandboxcore.TerminalConnection
	closed chan struct{}
}

func (t *idleTerminal) Read() (sandboxcore.TerminalEvent, error) {
	<-t.closed
	return sandboxcore.TerminalEvent{}, context.Canceled
}

func TestCloudTerminalIdleDetaches(t *testing.T) {
	ended := make(chan bool, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		up := websocket.Upgrader{}
		ws, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = ws.Close() }()
		remote := &idleTerminal{closed: make(chan struct{})}
		defer close(remote.closed)
		ended <- relayTerminal(r.Context(), ws, remote, 20*time.Millisecond)
	}))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.DialContext(t.Context(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ws.Close() }()
	var notice struct{ Type string }
	if err := ws.ReadJSON(&notice); err != nil || notice.Type != "idle" {
		t.Fatal("missing idle disconnect", err)
	}
	if <-ended {
		t.Fatal("idle disconnect requested remote termination")
	}
}
