package opensandbox

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

var _ sandboxcore.TerminalProvider = (*Provider)(nil)

func (p *Provider) terminalRequest(ctx context.Context, ref sandboxcore.ResourceRef, method, suffix string, body []byte) (*http.Request, error) {
	endpoint, err := p.dataEndpoint(ctx, ref)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint.Endpoint+"/pty"+suffix, bytes.NewReader(body))
	if err != nil {
		return nil, failure("SANDBOX_ENDPOINT_INVALID", false)
	}
	for k, v := range endpoint.Headers {
		req.Header.Set(k, v)
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}
func (p *Provider) CreateTerminal(ctx context.Context, ref sandboxcore.ResourceRef, cwd string) (string, error) {
	body, _ := json.Marshal(map[string]string{"cwd": cwd})
	req, err := p.terminalRequest(ctx, ref, http.MethodPost, "", body)
	if err != nil {
		return "", err
	}
	res, err := p.http.Do(req)
	if err != nil {
		return "", remoteError(err, true)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode == 404 || res.StatusCode == 501 {
		return "", failure("SANDBOX_TERMINAL_UNSUPPORTED", false)
	}
	var out struct {
		ID string `json:"session_id"`
	}
	if res.StatusCode != 201 || json.NewDecoder(res.Body).Decode(&out) != nil || !validRemoteID(out.ID) {
		return "", failure("SANDBOX_TERMINAL_CREATE_FAILED", true)
	}
	return out.ID, nil
}
func (p *Provider) EndTerminal(ctx context.Context, ref sandboxcore.ResourceRef, id string) error {
	if !validRemoteID(id) {
		return failure("SANDBOX_TERMINAL_INVALID", false)
	}
	req, err := p.terminalRequest(ctx, ref, http.MethodDelete, "/"+id, nil)
	if err != nil {
		return err
	}
	res, err := p.http.Do(req)
	if err != nil {
		return remoteError(err, true)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != 404 && res.StatusCode/100 != 2 {
		return failure("SANDBOX_TERMINAL_END_FAILED", true)
	}
	return nil
}
func (p *Provider) AttachTerminal(ctx context.Context, ref sandboxcore.ResourceRef, id string) (sandboxcore.TerminalConnection, error) {
	if !validRemoteID(id) {
		return nil, failure("SANDBOX_TERMINAL_INVALID", false)
	}
	req, err := p.terminalRequest(ctx, ref, http.MethodGet, "/"+id+"/ws?since=0", nil)
	if err != nil {
		return nil, err
	}
	u := *req.URL
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	d := websocket.Dialer{HandshakeTimeout: p.connection.ConnectTimeout, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	conn, res, err := d.DialContext(ctx, u.String(), req.Header)
	if err != nil {
		if res != nil {
			_ = res.Body.Close()
			switch res.StatusCode {
			case 404:
				return nil, failure("SANDBOX_TERMINAL_GONE", false)
			case 409:
				return nil, failure("SANDBOX_TERMINAL_ATTACHED", false)
			}
		}
		return nil, failure("SANDBOX_TERMINAL_CONNECT_FAILED", false)
	}
	conn.SetReadLimit(16 << 20)
	return &terminalConnection{conn}, nil
}

type terminalConnection struct{ *websocket.Conn }

func (t *terminalConnection) Read() (sandboxcore.TerminalEvent, error) {
	for {
		var out sandboxcore.TerminalEvent
		kind, b, err := t.ReadMessage()
		if err != nil {
			return out, err
		}
		if kind == websocket.BinaryMessage && len(b) > 0 {
			switch b[0] {
			case 1, 2:
				out.Output = b[1:]
				return out, nil
			case 3:
				if len(b) >= 9 {
					out.Output = b[9:]
					return out, nil
				}
			}
		}
		var ctl struct {
			Type string `json:"type"`
		}
		if kind == websocket.TextMessage && json.Unmarshal(b, &ctl) == nil {
			switch ctl.Type {
			case "connected":
				out.Ready = true
				return out, nil
			case "exit":
				out.Exited = true
				return out, nil
			case "pong":
				continue
			}
		}
		return out, failure("SANDBOX_TERMINAL_STREAM_INVALID", false)
	}
}
func (t *terminalConnection) Input(b []byte) error {
	if err := t.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	return t.WriteMessage(websocket.BinaryMessage, append([]byte{0}, b...))
}
func (t *terminalConnection) Resize(cols, rows int) error {
	if err := t.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	return t.WriteJSON(map[string]any{"type": "resize", "cols": cols, "rows": rows})
}
