package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

const terminalProtocol = "antcdp.terminal.v1"
const terminalIdleTimeout = 30 * time.Minute

func registerCloudTerminal(group *gin.RouterGroup, o Options) {
	group.GET("/cloud-computers/:id/terminal", func(c *gin.Context) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		originOK := func(r *http.Request) bool { return r.Header.Get("Origin") != "" && sameOrigin(r, o.Runtime.Origin()) }
		if !originOK(c.Request) {
			httpx.Write(c, httpx.E(403, "CSRF_INVALID", "请求来源校验失败"))
			return
		}
		if !slices.Contains(websocket.Subprotocols(c.Request), terminalProtocol) {
			httpx.Write(c, httpx.E(400, "SCHEMA_UNSUPPORTED", "缺少终端协议"))
			return
		}
		raw := rawSession(c)
		auth, err := o.Identity.ObserveConnection(c.Request.Context(), raw)
		if err != nil {
			httpx.Write(c, err)
			return
		}
		defer auth.Close()
		if auth.Auth().User.Role != "admin" {
			httpx.Write(c, httpx.E(403, "FORBIDDEN", "需要管理员权限"))
			return
		}
		up := websocket.Upgrader{CheckOrigin: originOK, Subprotocols: []string{terminalProtocol}, HandshakeTimeout: 10 * time.Second}
		ws, err := up.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer func() { _ = ws.Close() }()
		ctx, cancel := context.WithDeadline(c.Request.Context(), auth.Auth().Session.ExpiresAt)
		defer cancel()
		go func() {
			select {
			case <-auth.Done():
				cancel()
			case <-ctx.Done():
			}
		}()
		stop := context.AfterFunc(ctx, func() { _ = ws.Close() })
		defer stop()
		slot, remote, err := o.Sandboxes.OpenTerminal(ctx, raw, id)
		if err != nil {
			var failure *httpx.Error
			msg := "无法连接云电脑终端"
			if errors.As(err, &failure) {
				switch failure.Code {
				case "SANDBOX_TERMINAL_ATTACHED":
					msg = "该终端已在另一个窗口连接"
				case "SANDBOX_TERMINAL_UNSUPPORTED":
					msg = "当前沙箱不支持交互终端"
				default:
					msg = failure.Message
				}
			}
			_ = terminalNotice(ws, "error", msg)
			return
		}
		defer func() { _ = remote.Close() }()
		if relayTerminal(ctx, ws, remote, terminalIdleTimeout) {
			cleanup, done := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer done()
			if err := slot.End(cleanup); err != nil {
				_ = terminalNotice(ws, "error", "无法确认终端已结束，请重新连接核实")
				return
			}
			_ = terminalNotice(ws, "exit", "终端已结束")
		}
	})
}
func terminalNotice(ws *websocket.Conn, kind, message string) error {
	if err := ws.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	return ws.WriteJSON(map[string]string{"type": kind, "message": message})
}

type terminalInput struct {
	kind int
	data []byte
	err  error
}
type terminalOutput struct {
	event sandboxcore.TerminalEvent
	err   error
}

// The pumps only read; one relay owns all writes. Closing either connection
// releases its reader when the handler returns, including during revocation.
func relayTerminal(parent context.Context, ws *websocket.Conn, remote sandboxcore.TerminalConnection, idle time.Duration) bool {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	ws.SetReadLimit(128 << 10)
	input := make(chan terminalInput)
	output := make(chan terminalOutput)
	go func() {
		for {
			kind, b, err := ws.ReadMessage()
			select {
			case input <- terminalInput{kind, b, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		for {
			ev, err := remote.Read()
			select {
			case output <- terminalOutput{ev, err}:
			case <-ctx.Done():
				return
			}
			if err != nil || ev.Exited {
				return
			}
		}
	}()
	timer := time.NewTimer(idle)
	defer timer.Stop()
	ready := false
	for {
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
			_ = terminalNotice(ws, "idle", "已因空闲断开，可重新连接")
			return false
		case m := <-input:
			if m.err != nil || ctx.Err() != nil {
				return false
			}
			if !ready {
				continue
			}
			timer.Reset(idle)
			if m.kind == websocket.BinaryMessage {
				if remote.Input(m.data) != nil {
					return false
				}
				continue
			}
			var ctl struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if json.Unmarshal(m.data, &ctl) != nil {
				return false
			}
			if ctl.Type == "end" {
				return true
			}
			if ctl.Type != "resize" || ctl.Cols < 1 || ctl.Rows < 1 || ctl.Cols > 4096 || ctl.Rows > 4096 || remote.Resize(ctl.Cols, ctl.Rows) != nil {
				return false
			}
		case m := <-output:
			if m.err != nil || ctx.Err() != nil {
				return false
			}
			timer.Reset(idle)
			switch {
			case m.event.Exited:
				return true
			case m.event.Ready:
				ready = true
				if terminalNotice(ws, "ready", "") != nil {
					return false
				}
			case len(m.event.Output) > 0:
				if ws.SetWriteDeadline(time.Now().Add(10*time.Second)) != nil || ws.WriteMessage(websocket.BinaryMessage, m.event.Output) != nil {
					return false
				}
			}
		}
	}
}
