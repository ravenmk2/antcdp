package agentcore

import (
	"context"
	"encoding/json"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type StreamBlock struct {
	DurationMS    *int64  `json:"duration_ms,omitempty"`
	Type          string  `json:"type"`
	Text          string  `json:"text,omitempty"`
	DraftCallID   string  `json:"draft_call_id,omitempty"`
	Name          *string `json:"name,omitempty"`
	ArgumentsText string  `json:"arguments_text,omitempty"`
}

func (b StreamBlock) MarshalJSON() ([]byte, error) {
	if b.Type == "tool_call" {
		return json.Marshal(struct {
			Type          string  `json:"type"`
			DraftCallID   string  `json:"draft_call_id"`
			Name          *string `json:"name"`
			ArgumentsText string  `json:"arguments_text"`
		}{b.Type, b.DraftCallID, b.Name, b.ArgumentsText})
	}
	return json.Marshal(struct {
		Type       string `json:"type"`
		Text       string `json:"text"`
		DurationMS *int64 `json:"duration_ms,omitempty"`
	}{b.Type, b.Text, b.DurationMS})
}

type StreamDelta struct {
	DurationMS        *int64  `json:"duration_ms,omitempty"`
	Type              string  `json:"type"`
	BlockIndex        int     `json:"block_index"`
	Text              string  `json:"text,omitempty"`
	DraftCallID       string  `json:"draft_call_id,omitempty"`
	Name              *string `json:"name,omitempty"`
	ArgumentsFragment string  `json:"arguments_fragment,omitempty"`
}

func (d StreamDelta) MarshalJSON() ([]byte, error) {
	switch d.Type {
	case "text_delta", "reasoning_delta":
		return json.Marshal(struct {
			Type       string `json:"type"`
			BlockIndex int    `json:"block_index"`
			Text       string `json:"text"`
			DurationMS *int64 `json:"duration_ms,omitempty"`
		}{d.Type, d.BlockIndex, d.Text, d.DurationMS})
	case "tool_call_delta":
		return json.Marshal(struct {
			Type              string  `json:"type"`
			BlockIndex        int     `json:"block_index"`
			DraftCallID       string  `json:"draft_call_id"`
			Name              *string `json:"name,omitempty"`
			ArgumentsFragment string  `json:"arguments_fragment"`
		}{d.Type, d.BlockIndex, d.DraftCallID, d.Name, d.ArgumentsFragment})
	default:
		return nil, reject("STREAM_INVALID")
	}
}

type StreamOutcome struct {
	Kind     string `json:"kind"`
	EventSeq *Seq   `json:"event_seq,omitempty"`
	Reason   string `json:"reason,omitempty"`
}
type StreamFrame struct {
	SessionID ID             `json:"session_id"`
	Epoch     string         `json:"runtime_epoch"`
	Revision  Seq            `json:"revision"`
	AttemptID ID             `json:"attempt_id"`
	Index     int            `json:"index"`
	Kind      string         `json:"kind"`
	RunID     ID             `json:"run_id,omitempty"`
	Step      uint32         `json:"step,omitempty"`
	Content   []StreamBlock  `json:"content,omitempty"`
	Delta     *StreamDelta   `json:"delta,omitempty"`
	Outcome   *StreamOutcome `json:"outcome,omitempty"`
}

func (f StreamFrame) MarshalJSON() ([]byte, error) {
	v := map[string]any{"session_id": f.SessionID, "runtime_epoch": f.Epoch, "revision": f.Revision, "attempt_id": f.AttemptID, "index": f.Index, "kind": f.Kind}
	switch f.Kind {
	case "start":
		v["run_id"] = f.RunID
		v["step"] = f.Step
		v["content"] = f.Content
	case "chunk":
		v["delta"] = f.Delta
	case "end":
		v["outcome"] = f.Outcome
	default:
		return nil, reject("STREAM_INVALID")
	}
	return json.Marshal(v)
}

type ActiveStream struct {
	AttemptID ID            `json:"attempt_id"`
	RunID     ID            `json:"run_id"`
	Step      uint32        `json:"step"`
	NextIndex int           `json:"next_index"`
	Content   []StreamBlock `json:"content"`
}
type StreamSnapshot struct {
	Epoch    string        `json:"runtime_epoch"`
	Revision Seq           `json:"revision"`
	Active   *ActiveStream `json:"active_attempt"`
}
type Notice struct {
	Stream       *StreamFrame
	Commit       *CommitReceipt
	ResyncReason string
}
type queuedNotice struct {
	value Notice
	size  int
}
type streamSession struct {
	reasoning    reasoningClock
	snapshot     StreamSnapshot
	sourceBlocks map[int]int
	subscribers  map[*Subscription]struct{}
}

// Hub is only an in-process observation buffer. Authorization and durable
// snapshots are supplied by the host; subscribing never starts an execution.
type Hub struct {
	mu                   sync.Mutex
	epoch                string
	sessions             map[ID]*streamSession
	maxBytes, maxNotices int
}

func NewHub(epoch string) *Hub {
	return &Hub{epoch: epoch, sessions: map[ID]*streamSession{}, maxBytes: 4 << 20, maxNotices: 1000}
}
func (h *Hub) session(id ID) *streamSession {
	s := h.sessions[id]
	if s == nil {
		s = &streamSession{snapshot: StreamSnapshot{Epoch: h.epoch}, sourceBlocks: map[int]int{}, subscribers: map[*Subscription]struct{}{}}
		h.sessions[id] = s
	}
	return s
}

type Subscription struct {
	hub            *Hub
	sessionID      ID
	queue          []queuedNotice
	bytes          int
	paused, closed bool
	wake           chan struct{}
}

// Subscribe installs the listener before returning its transient baseline.
// The host then captures durable H and drains notices beyond H/baseline.
func (h *Hub) Subscribe(id ID) (*Subscription, StreamSnapshot) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.session(id)
	sub := &Subscription{hub: h, sessionID: id, wake: make(chan struct{}, 1)}
	s.subscribers[sub] = struct{}{}
	return sub, copySnapshot(s.snapshot)
}
func (s *Subscription) Next(ctx context.Context) (Notice, error) {
	for {
		s.hub.mu.Lock()
		if s.closed {
			s.hub.mu.Unlock()
			return Notice{}, reject("SUBSCRIPTION_CLOSED")
		}
		if len(s.queue) > 0 {
			n := s.queue[0]
			s.queue = s.queue[1:]
			s.bytes -= n.size
			s.hub.mu.Unlock()
			return n.value, nil
		}
		s.hub.mu.Unlock()
		select {
		case <-ctx.Done():
			return Notice{}, ctx.Err()
		case <-s.wake:
		}
	}
}
func (s *Subscription) Close() {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	s.queue = nil
	s.bytes = 0
	delete(s.hub.session(s.sessionID).subscribers, s)
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *Subscription) Resync() StreamSnapshot {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	s.queue = nil
	s.bytes = 0
	s.paused = false
	return copySnapshot(s.hub.session(s.sessionID).snapshot)
}
func (h *Hub) publish(s *streamSession, n Notice) {
	b, _ := json.Marshal(n)
	for sub := range s.subscribers {
		if sub.paused || sub.closed {
			continue
		}
		value := n
		size := len(b)
		if sub.bytes+size > h.maxBytes || len(sub.queue) >= h.maxNotices {
			sub.queue = nil
			sub.bytes = 0
			sub.paused = true
			value = Notice{ResyncReason: "buffer_overflow"}
			size = 64
		}
		sub.queue = append(sub.queue, queuedNotice{value: value, size: size})
		sub.bytes += size
		select {
		case sub.wake <- struct{}{}:
		default:
		}
	}
}
func (h *Hub) Committed(_ context.Context, r CommitReceipt) {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := map[ID]bool{}
	for _, v := range r.Ranges {
		if !seen[v.SessionID] {
			seen[v.SessionID] = true
			copy := r
			copy.Ranges = append([]EventRange(nil), r.Ranges...)
			copy.ArtifactIDs = append([]ID(nil), r.ArtifactIDs...)
			h.publish(h.session(v.SessionID), Notice{Commit: &copy})
		}
	}
}
func (h *Hub) Start(permit AttemptPermit) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if permit.Ref.Epoch != h.epoch || permit.CallID == 0 {
		return reject("EXECUTION_FENCED")
	}
	s := h.session(permit.Ref.SessionID)
	if s.snapshot.Active != nil {
		return reject("STREAM_ALREADY_ACTIVE")
	}
	s.snapshot.Revision++
	s.sourceBlocks = map[int]int{}
	s.reasoning = reasoningClock{}
	s.snapshot.Active = &ActiveStream{AttemptID: permit.CallID, RunID: permit.Ref.RunID, Step: permit.Step, NextIndex: 1, Content: []StreamBlock{}}
	f := StreamFrame{SessionID: permit.Ref.SessionID, Epoch: h.epoch, Revision: s.snapshot.Revision, AttemptID: permit.CallID, Index: 0, Kind: "start", RunID: permit.Ref.RunID, Step: permit.Step, Content: []StreamBlock{}}
	h.publish(s, Notice{Stream: &f})
	return nil
}

// Emit maps provider-local block indexes to contiguous UI indexes. Providers
// may reserve indexes for absent reasoning blocks; the public reducer may not.
func (h *Hub) Emit(_ context.Context, permit AttemptPermit, d modelcore.Delta) error {
	if !utf8.ValidString(d.Text) || !utf8.ValidString(d.Name) || len(d.Name) > 256 || len(d.DraftCallID) > 256 {
		return reject("STREAM_INVALID")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.session(permit.Ref.SessionID)
	a := s.snapshot.Active
	if permit.Ref.Epoch != h.epoch || a == nil || a.AttemptID != permit.CallID {
		return reject("EXECUTION_FENCED")
	}
	if d.BlockIndex < 0 || d.Kind != "text" && d.Kind != "reasoning" && d.Kind != "tool_call" {
		return reject("STREAM_INVALID")
	}
	idx, ok := s.sourceBlocks[d.BlockIndex]
	if !ok {
		idx = len(a.Content)
		if d.Kind == "tool_call" {
			for _, block := range a.Content {
				if block.Type == "tool_call" && block.DraftCallID == d.DraftCallID {
					return reject("STREAM_INVALID")
				}
			}
		}
	}
	blocks := append([]StreamBlock{}, a.Content...)
	if !ok {
		blocks = append(blocks, StreamBlock{Type: d.Kind, DraftCallID: d.DraftCallID})
	}
	block := &blocks[idx]
	if block.Type != d.Kind || d.Kind == "tool_call" && (d.DraftCallID == "" || block.DraftCallID != d.DraftCallID) {
		return reject("STREAM_INVALID")
	}
	if d.Kind == "tool_call" {
		block.ArgumentsText += d.Text
		if d.Name != "" {
			if block.Name != nil && *block.Name != d.Name {
				return reject("STREAM_INVALID")
			}
			name := d.Name
			block.Name = &name
		}
	} else {
		block.Text += d.Text
	}
	encoded, err := json.Marshal(blocks)
	if err != nil {
		return err
	}
	if len(encoded) > MaxHistoryBytes {
		return reject("OUTPUT_LIMIT_EXCEEDED")
	}
	now := time.Now()
	if s.reasoning.active && (d.Kind != "reasoning" || s.reasoning.index != idx) && (d.Text != "" || d.Kind == "tool_call") {
		h.finishReasoning(permit.Ref.SessionID, s, a, now)
		// The completed block's timing must survive this new content snapshot.
		blocks[s.reasoning.index].DurationMS = a.Content[s.reasoning.index].DurationMS
	}
	if d.Kind == "reasoning" && d.Text != "" {
		s.reasoning.start(idx, now)
		blocks[idx].DurationMS = nil
	}
	a.Content = blocks
	s.sourceBlocks[d.BlockIndex] = idx
	parts := splitDelta(d.Text, 8<<10)
	for n, text := range parts {
		delta := StreamDelta{Type: d.Kind + "_delta", BlockIndex: idx, Text: text}
		if d.Kind == "tool_call" {
			delta.Text = ""
			delta.DraftCallID = d.DraftCallID
			delta.ArgumentsFragment = text
			if n == 0 && d.Name != "" {
				name := d.Name
				delta.Name = &name
			}
		}
		s.snapshot.Revision++
		f := StreamFrame{SessionID: permit.Ref.SessionID, Epoch: h.epoch, Revision: s.snapshot.Revision, AttemptID: permit.CallID, Index: a.NextIndex, Kind: "chunk", Delta: &delta}
		a.NextIndex++
		h.publish(s, Notice{Stream: &f})
	}
	return nil
}
func splitDelta(text string, limit int) []string {
	if text == "" {
		return []string{""}
	}
	out := []string{}
	for len(text) > 0 {
		n := min(len(text), limit)
		for n < len(text) && !utf8.RuneStart(text[n]) {
			n--
		}
		out = append(out, text[:n])
		text = text[n:]
	}
	return out
}
func (h *Hub) End(permit AttemptPermit, outcome StreamOutcome) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.session(permit.Ref.SessionID)
	a := s.snapshot.Active
	if permit.Ref.Epoch != h.epoch || a == nil || a.AttemptID != permit.CallID {
		return reject("EXECUTION_FENCED")
	}
	if outcome.Kind != "committed" && outcome.Kind != "abandoned" || outcome.Kind == "committed" && (outcome.EventSeq == nil || *outcome.EventSeq == 0) {
		return reject("STREAM_INVALID")
	}
	s.snapshot.Revision++
	f := StreamFrame{SessionID: permit.Ref.SessionID, Epoch: h.epoch, Revision: s.snapshot.Revision, AttemptID: permit.CallID, Index: a.NextIndex, Kind: "end", Outcome: &outcome}
	s.snapshot.Active = nil
	s.sourceBlocks = map[int]int{}
	h.publish(s, Notice{Stream: &f})
	return nil
}
func copySnapshot(v StreamSnapshot) StreamSnapshot {
	if v.Active != nil {
		a := *v.Active
		a.Content = append([]StreamBlock{}, v.Active.Content...)
		for n, b := range a.Content {
			if b.Name != nil {
				name := *b.Name
				a.Content[n].Name = &name
			}
		}
		v.Active = &a
	}
	return v
}
