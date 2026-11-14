package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type agentStreamLimits struct {
	mu    sync.Mutex
	users map[uint64]int
}

func (l *agentStreamLimits) acquire(id uint64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.users[id] >= 3 {
		return false
	}
	l.users[id]++
	return true
}
func (l *agentStreamLimits) release(id uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.users[id]--
	if l.users[id] == 0 {
		delete(l.users, id)
	}
}

type agentClientFrame struct {
	Type         string  `json:"type"`
	Subscription string  `json:"subscription_id,omitempty"`
	Session      string  `json:"session_id,omitempty"`
	Limit        *int    `json:"history_limit,omitempty"`
	Nonce        *string `json:"nonce,omitempty"`
}

var agentSubscriptionPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func parseAgentFrame(raw []byte) (agentClientFrame, error) {
	var f agentClientFrame
	if len(raw) > 16<<10 {
		return f, errors.New("frame too large")
	}
	keys := map[string]bool{}
	check := json.NewDecoder(bytes.NewReader(raw))
	first, e := check.Token()
	if e != nil || first != json.Delim('{') {
		return f, errors.New("object required")
	}
	for check.More() {
		key, e := check.Token()
		if e != nil {
			return f, e
		}
		name, ok := key.(string)
		if !ok || keys[name] {
			return f, errors.New("duplicate key")
		}
		keys[name] = true
		var value json.RawMessage
		if check.Decode(&value) != nil || string(value) == "null" {
			return f, errors.New("invalid field")
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if !utf8.Valid(raw) || decoder.Decode(&f) != nil || decoder.Decode(new(any)) != io.EOF {
		return f, errors.New("invalid frame")
	}
	allowed := map[string]bool{"type": true}
	switch f.Type {
	case "subscribe":
		allowed["subscription_id"] = true
		allowed["session_id"] = true
		allowed["history_limit"] = true
	case "unsubscribe", "resync":
		allowed["subscription_id"] = true
	case "ping":
		allowed["nonce"] = true
	}
	for key := range keys {
		if !allowed[key] {
			return f, errors.New("unexpected field")
		}
	}
	switch f.Type {
	case "subscribe":
		n, e := strconv.ParseUint(f.Session, 10, 64)
		if e != nil || n == 0 || strconv.FormatUint(n, 10) != f.Session || f.Nonce != nil || f.Limit != nil && (*f.Limit < 1 || *f.Limit > 200) {
			return f, errors.New("invalid subscribe")
		}
	case "unsubscribe", "resync":
		if f.Session != "" || f.Limit != nil || f.Nonce != nil {
			return f, errors.New("invalid control")
		}
	case "ping":
		if f.Subscription != "" || f.Session != "" || f.Limit != nil || f.Nonce == nil || len(*f.Nonce) < 1 || len(*f.Nonce) > 64 {
			return f, errors.New("invalid ping")
		}
		for _, v := range *f.Nonce {
			if v > 127 {
				return f, errors.New("invalid nonce")
			}
		}
		return f, nil
	default:
		return f, errors.New("invalid type")
	}
	if !agentSubscriptionPattern.MatchString(f.Subscription) {
		return f, errors.New("invalid subscription")
	}
	return f, nil
}

type agentWSSubscription struct {
	id      string
	session uint64
	limit   int
	hub     *agentcore.Subscription
	seq     uint64
	stream  agentcore.StreamSnapshot
	paused  bool
}
type agentWSNotice struct {
	sub    *agentWSSubscription
	notice agentcore.Notice
}
type agentWS struct {
	ctx            context.Context
	conn           *websocket.Conn
	options        Options
	raw, requestID string
	subscriptions  map[string]*agentWSSubscription
	used           map[string]bool
	notices        chan agentWSNotice
}

func registerAgentStream(group *gin.RouterGroup, o Options) {
	limits := &agentStreamLimits{users: map[uint64]int{}}
	group.GET("/stream", func(c *gin.Context) {
		if !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		if o.AgentHub == nil || o.Agents == nil || o.Identity == nil {
			httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "智能体观察服务尚未就绪"))
			return
		}
		if c.GetHeader("Origin") == "" || !sameOrigin(c.Request, o.Runtime.Origin()) {
			httpx.Write(c, httpx.E(403, "CSRF_INVALID", "请求来源校验失败"))
			return
		}
		if !slices.Contains(websocket.Subprotocols(c.Request), "antcdp.agent.v1") {
			httpx.Write(c, httpx.E(400, "SCHEMA_UNSUPPORTED", "缺少受支持的观察协议"))
			return
		}
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()
		auth, e := o.Identity.ObserveAccess(ctx, rawSession(c), nil)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		if !limits.acquire(auth.User.ID) {
			httpx.Write(c, httpx.E(429, "RATE_LIMITED", "观察连接数量超过上限"))
			return
		}
		defer limits.release(auth.User.ID)
		upgrader := websocket.Upgrader{HandshakeTimeout: 10 * time.Second, Subprotocols: []string{"antcdp.agent.v1"}, CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") != "" && sameOrigin(r, o.Runtime.Origin()) }, EnableCompression: false}
		conn, e := upgrader.Upgrade(c.Writer, c.Request, nil)
		if e != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		ws := &agentWS{ctx: agents.ObservingContext(ctx), conn: conn, options: o, raw: rawSession(c), requestID: c.GetString("request_id"), subscriptions: map[string]*agentWSSubscription{}, used: map[string]bool{}, notices: make(chan agentWSNotice)}
		defer func() {
			for _, sub := range ws.subscriptions {
				sub.hub.Close()
			}
		}()
		ws.serve()
	})
}
func (w *agentWS) write(value any) error {
	encoded, e := json.Marshal(value)
	if e != nil {
		return e
	}
	if len(encoded) > 2<<20 {
		return errors.New("frame limit")
	}
	if e = w.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); e != nil {
		return e
	}
	return w.conn.WriteMessage(websocket.TextMessage, encoded)
}
func (w *agentWS) close(code int) {
	_ = w.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, ""), time.Now().Add(time.Second))
}
func (w *agentWS) problem(id, code string) error {
	frame := map[string]any{"type": "error", "code": code, "message": "智能体观察请求未完成", "request_id": w.requestID}
	if id != "" {
		frame["subscription_id"] = id
	}
	return w.write(frame)
}
func (w *agentWS) serve() {
	w.conn.SetReadLimit(16 << 10)
	_ = w.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	incoming := make(chan agentClientFrame, 8)
	readErrors := make(chan error, 1)
	go func() {
		for {
			kind, data, e := w.conn.ReadMessage()
			if e != nil {
				readErrors <- e
				return
			}
			if kind != websocket.TextMessage {
				readErrors <- errors.New("binary frame")
				return
			}
			f, e := parseAgentFrame(data)
			if e != nil {
				readErrors <- e
				return
			}
			if f.Type == "ping" {
				_ = w.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
			}
			select {
			case incoming <- f:
			case <-w.ctx.Done():
				return
			}
		}
	}()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-w.ctx.Done():
			return
		case e := <-readErrors:
			var closeErr *websocket.CloseError
			if !errors.As(e, &closeErr) {
				_ = w.problem("", "INVALID_FRAME")
				w.close(websocket.ClosePolicyViolation)
			}
			return
		case f := <-incoming:
			if e := w.handle(f); e != nil {
				return
			}
		case item := <-w.notices:
			if w.subscriptions[item.sub.id] != item.sub || item.sub.paused {
				continue
			}
			if e := w.notice(item); e != nil {
				return
			}
		case <-ticker.C:
			if _, e := w.options.Identity.ObserveAccess(w.ctx, w.raw, nil); e != nil {
				_ = w.problem("", "UNAUTHENTICATED")
				w.close(websocket.ClosePolicyViolation)
				return
			}
			for _, sub := range w.subscriptions {
				if e := w.options.Agents.CheckObservation(w.ctx, w.raw, sub.session); e != nil {
					if e = w.observationError(sub, e); e != nil {
						return
					}
					continue
				}
				if !sub.paused {
					if e := w.catchup(sub); e != nil {
						if e = w.observationError(sub, e); e != nil {
							return
						}
					}
				}
			}
		}
	}
}
func (w *agentWS) handle(f agentClientFrame) error {
	switch f.Type {
	case "ping":
		if _, e := w.options.Identity.ObserveAccess(w.ctx, w.raw, nil); e != nil {
			_ = w.problem("", "UNAUTHENTICATED")
			w.close(websocket.ClosePolicyViolation)
			return e
		}
		return w.write(map[string]any{"type": "pong", "nonce": *f.Nonce, "server_time": time.Now().UTC()})
	case "subscribe":
		if w.used[f.Subscription] {
			return w.problem(f.Subscription, "SUBSCRIPTION_EXISTS")
		}
		if len(w.subscriptions) >= 8 {
			return w.problem(f.Subscription, "SUBSCRIPTION_LIMIT")
		}
		id, _ := strconv.ParseUint(f.Session, 10, 64)
		limit := 80
		if f.Limit != nil {
			limit = *f.Limit
		}
		w.used[f.Subscription] = true
		return w.open(f.Subscription, id, limit)
	case "unsubscribe":
		sub := w.subscriptions[f.Subscription]
		if sub == nil {
			return w.problem(f.Subscription, "SUBSCRIPTION_NOT_FOUND")
		}
		sub.hub.Close()
		delete(w.subscriptions, f.Subscription)
		return w.write(map[string]any{"type": "unsubscribed", "subscription_id": f.Subscription})
	case "resync":
		sub := w.subscriptions[f.Subscription]
		if sub == nil {
			return w.problem(f.Subscription, "SUBSCRIPTION_NOT_FOUND")
		}
		sub.hub.Close()
		delete(w.subscriptions, f.Subscription)
		return w.open(sub.id, sub.session, sub.limit)
	}
	return nil
}
func (w *agentWS) open(id string, session uint64, limit int) error {
	hub, baseline := w.options.AgentHub.Subscribe(agentcore.ID(session))
	sub := &agentWSSubscription{id: id, session: session, limit: limit, hub: hub, stream: baseline}
	w.subscriptions[id] = sub
	ctx, cancel := context.WithTimeout(w.ctx, 10*time.Second)
	result, e := w.options.Agents.Snapshot(ctx, w.raw, session, limit)
	cancel()
	if e != nil {
		return w.observationError(sub, e)
	}
	snapshot, ok := result.Data.(agents.ObservationSnapshot)
	if !ok {
		return errors.New("invalid snapshot projection")
	}
	frame, e := agents.TrimSnapshot(snapshot, baseline, id)
	if e != nil {
		return w.observationError(sub, e)
	}
	sub.seq = snapshot.Through
	if e = w.write(frame); e != nil {
		return e
	}
	go func() {
		for {
			notice, e := hub.Next(w.ctx)
			if e != nil {
				return
			}
			select {
			case w.notices <- agentWSNotice{sub: sub, notice: notice}:
			case <-w.ctx.Done():
				return
			}
		}
	}()
	return nil
}
func (w *agentWS) resync(sub *agentWSSubscription, reason string) error {
	sub.paused = true
	return w.write(map[string]any{"type": "resync_required", "subscription_id": sub.id, "reason": reason, "last_delivered_seq": agentcore.Seq(sub.seq)})
}
func (w *agentWS) observationError(sub *agentWSSubscription, err error) error {
	var problem *httpx.Error
	if errors.As(err, &problem) {
		if problem.Status == 401 || problem.Code == "PASSWORD_CHANGE_REQUIRED" {
			_ = w.problem("", "UNAUTHENTICATED")
			w.close(websocket.ClosePolicyViolation)
			return err
		}
		if problem.Status == 403 || problem.Status == 404 {
			sub.hub.Close()
			delete(w.subscriptions, sub.id)
			return w.write(map[string]any{"type": "access_revoked", "subscription_id": sub.id, "code": "NOT_FOUND"})
		}
		if problem.Code == "SNAPSHOT_CHANGED" {
			return w.resync(sub, "sequence_gap")
		}
	}
	sub.paused = true
	return w.problem(sub.id, "OBSERVATION_UNAVAILABLE")
}
func (w *agentWS) catchup(sub *agentWSSubscription) error {
	for pages := 0; pages < 10; pages++ {
		ctx, cancel := context.WithTimeout(w.ctx, 10*time.Second)
		result, e := w.options.Agents.EventsAfter(ctx, w.raw, sub.session, sub.seq, 100)
		cancel()
		if e != nil {
			return e
		}
		page, ok := result.Data.(agents.HistoryPage)
		if !ok {
			return errors.New("invalid event projection")
		}
		for _, record := range page.Records {
			if uint64(record.Seq) != sub.seq+1 {
				return w.resync(sub, "sequence_gap")
			}
			frame := map[string]any{"type": "event", "subscription_id": sub.id, "session_id": agentcore.ID(sub.session), "seq": record.Seq, "event_type": record.Type, "schema_version": record.SchemaVersion, "occurred_at": record.OccurredAt, "run_id": nil, "data": record.Data}
			if record.RunID != nil {
				frame["run_id"] = agentcore.ID(*record.RunID)
			}
			if e = w.write(frame); e != nil {
				return e
			}
			sub.seq = uint64(record.Seq)
		}
		if !page.HasMore {
			return nil
		}
	}
	return w.resync(sub, "buffer_overflow")
}
func (w *agentWS) notice(item agentWSNotice) error {
	sub, n := item.sub, item.notice
	if n.ResyncReason != "" {
		return w.resync(sub, n.ResyncReason)
	}
	if n.Commit != nil {
		if e := w.catchup(sub); e != nil {
			return w.observationError(sub, e)
		}
		return nil
	}
	if n.Stream == nil {
		return nil
	}
	f := n.Stream
	if f.Epoch != sub.stream.Epoch {
		return w.resync(sub, "epoch_changed")
	}
	if f.Revision <= sub.stream.Revision {
		return nil
	}
	if f.Revision != sub.stream.Revision+1 {
		return w.resync(sub, "stream_gap")
	}
	if e := w.options.Agents.CheckObservation(w.ctx, w.raw, sub.session); e != nil {
		return w.observationError(sub, e)
	}
	if f.Outcome != nil && f.Outcome.EventSeq != nil && uint64(*f.Outcome.EventSeq) > sub.seq {
		if e := w.catchup(sub); e != nil {
			return w.observationError(sub, e)
		}
		if sub.paused {
			return nil
		}
	}
	raw, e := json.Marshal(f)
	if e != nil {
		return e
	}
	var frame map[string]any
	if e = json.Unmarshal(raw, &frame); e != nil {
		return e
	}
	frame["type"] = "assistant_stream"
	frame["subscription_id"] = sub.id
	if e = w.write(frame); e != nil {
		return e
	}
	sub.stream.Revision = f.Revision
	return nil
}
