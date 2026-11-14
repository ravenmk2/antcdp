package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

// guardTransport fixes the exact credential target and allows one tools/call
// POST per logical adapter Call. SDK upgrades cannot silently add side-effect
// retries; POST bodies have no GetBody replay hook and SSE reconnection is off.
type guardTransport struct {
	base     http.RoundTripper
	config   Config
	mu       sync.Mutex
	toolSent bool
}

func (t *guardTransport) sent() bool { t.mu.Lock(); defer t.mu.Unlock(); return t.toolSent }
func (t *guardTransport) reset()     { t.mu.Lock(); defer t.mu.Unlock(); t.toolSent = false }
func (t *guardTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.String() != t.config.URL {
		return nil, &Error{Code: "MCP_TARGET_CHANGED"}
	}
	copy := request.Clone(request.Context())
	if request.Method == http.MethodDelete {
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		defer cancel()
		copy = copy.WithContext(ctx)
	}
	copy.Header = request.Header.Clone()
	copy.GetBody = nil
	if request.Body != nil {
		raw, err := io.ReadAll(io.LimitReader(request.Body, 64<<10+1))
		_ = request.Body.Close()
		if err != nil || len(raw) > 64<<10 {
			return nil, &Error{Code: "MCP_REQUEST_LIMIT"}
		}
		var rpc struct {
			Method string `json:"method"`
		}
		if len(raw) > 0 && json.Unmarshal(raw, &rpc) != nil {
			return nil, &Error{Code: "MCP_REQUEST_INVALID"}
		}
		if rpc.Method == "tools/call" {
			t.mu.Lock()
			if t.toolSent {
				t.mu.Unlock()
				return nil, &Error{Code: "MCP_REPLAY_BLOCKED", Dispatched: true}
			}
			t.toolSent = true
			t.mu.Unlock()
		}
		copy.Body = io.NopCloser(bytes.NewReader(raw))
		copy.ContentLength = int64(len(raw))
	}
	switch t.config.AuthMethod {
	case "bearer":
		copy.Header.Set("Authorization", "Bearer "+t.config.Secret)
	case "custom_header":
		copy.Header.Set(t.config.HeaderName, t.config.Secret)
	}
	response, err := t.base.RoundTrip(copy)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		_ = response.Body.Close()
		return nil, &Error{Code: "MCP_REDIRECT_REJECTED", HTTPStatus: response.StatusCode, Dispatched: t.sent()}
	}
	if response.StatusCode >= 400 {
		_ = response.Body.Close()
		return nil, &Error{Code: "MCP_HTTP_ERROR", HTTPStatus: response.StatusCode, Dispatched: t.sent()}
	}
	response.Body = &boundedBody{reader: response.Body, left: 1 << 20}
	return response, nil
}

type boundedBody struct {
	reader io.ReadCloser
	left   int64
}

func (b *boundedBody) Read(p []byte) (int, error) {
	if b.left <= 0 {
		var extra [1]byte
		n, err := b.reader.Read(extra[:])
		if n > 0 {
			return 0, &Error{Code: "MCP_RESPONSE_LIMIT"}
		}
		return 0, err
	}
	if int64(len(p)) > b.left {
		p = p[:b.left]
	}
	n, err := b.reader.Read(p)
	b.left -= int64(n)
	return n, err
}
func (b *boundedBody) Close() error { return b.reader.Close() }
