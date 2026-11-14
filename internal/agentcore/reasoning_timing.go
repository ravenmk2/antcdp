package agentcore

import "time"

// Measure observed reasoning windows only, excluding request startup, text and tools.
type reasoningClock struct {
	active  bool
	index   int
	started time.Time
	elapsed map[int]time.Duration
}

func (c *reasoningClock) start(index int, now time.Time) {
	if c.active {
		return
	}
	if c.elapsed == nil {
		c.elapsed = map[int]time.Duration{}
	}
	c.active, c.index, c.started = true, index, now
}

func (c *reasoningClock) finish(now time.Time) *int64 {
	if !c.active {
		return nil
	}
	c.elapsed[c.index] += max(0, now.Sub(c.started))
	c.active = false
	ms := c.elapsed[c.index].Milliseconds()
	return &ms
}

func (h *Hub) finishReasoning(sessionID ID, s *streamSession, a *ActiveStream, now time.Time) {
	ms := s.reasoning.finish(now)
	if ms == nil {
		return
	}
	index := s.reasoning.index
	a.Content[index].DurationMS = ms
	s.snapshot.Revision++
	delta := StreamDelta{Type: "reasoning_delta", BlockIndex: index, DurationMS: ms}
	frame := StreamFrame{SessionID: sessionID, Epoch: h.epoch, Revision: s.snapshot.Revision, AttemptID: a.AttemptID,
		Index: a.NextIndex, Kind: "chunk", Delta: &delta}
	a.NextIndex++
	h.publish(s, Notice{Stream: &frame})
}

// FinishReasoning freezes timing before persistence or terminal stream publication.
// No observed reasoning means unknown, including non-streaming providers.
func (h *Hub) FinishReasoning(permit AttemptPermit) *int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.sessions[permit.Ref.SessionID]
	if s == nil || permit.Ref.Epoch != h.epoch || s.snapshot.Active == nil || s.snapshot.Active.AttemptID != permit.CallID {
		return nil
	}
	h.finishReasoning(permit.Ref.SessionID, s, s.snapshot.Active, time.Now())
	if s.reasoning.elapsed == nil {
		return nil
	}
	var total time.Duration
	for _, elapsed := range s.reasoning.elapsed {
		total += elapsed
	}
	ms := total.Milliseconds()
	return &ms
}
