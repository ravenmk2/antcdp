package agentcore

import (
	"context"
	"sync"
)

// ToolBatch coordinates only logical in-flight slots. Waiting calls occupy a
// slot but no shared worker: child Runs have their own batch and cannot deadlock
// on a parent's waiting delegation. Calls are claimed once, before any dispatch.
type ToolBatch struct {
	mu            sync.Mutex
	calls         []PreparedToolCall
	started, done []bool
	active, limit int
	wake          chan struct{}
	aborted       error
}

func NewToolBatch(calls []PreparedToolCall, limit int) (*ToolBatch, error) {
	if limit < 1 || limit > 16 {
		return nil, invalid("max_parallel_tools")
	}
	seen := map[string]bool{}
	for n, c := range calls {
		if c.ID == 0 || c.Call.ID == "" || seen[c.Call.ID] || c.Ordinal != uint32(n) {
			return nil, reject("TOOL_INTENT_INVALID")
		}
		seen[c.Call.ID] = true
	}
	return &ToolBatch{calls: append([]PreparedToolCall(nil), calls...), started: make([]bool, len(calls)), done: make([]bool, len(calls)), limit: limit, wake: make(chan struct{})}, nil
}

func (b *ToolBatch) Acquire(ctx context.Context, providerID, name, arguments string) (PreparedToolCall, func(), error) {
	idx := -1
	for n, c := range b.calls {
		if c.Call.ID == providerID {
			idx = n
			break
		}
	}
	if idx < 0 || b.calls[idx].Call.Name != name || b.calls[idx].Call.Arguments != arguments {
		return PreparedToolCall{}, nil, reject("TOOL_INTENT_INVALID")
	}
	for {
		if err := ctx.Err(); err != nil {
			return PreparedToolCall{}, nil, err
		}
		b.mu.Lock()
		if b.aborted != nil {
			err := b.aborted
			b.mu.Unlock()
			return PreparedToolCall{}, nil, err
		}
		if b.started[idx] {
			b.mu.Unlock()
			return PreparedToolCall{}, nil, reject("TOOL_ALREADY_DISPATCHED")
		}
		if b.ready(idx) {
			b.started[idx] = true
			b.active++
			b.mu.Unlock()
			var once sync.Once
			return b.calls[idx], func() {
				once.Do(func() {
					b.mu.Lock()
					defer b.mu.Unlock()
					b.done[idx] = true
					b.active--
					close(b.wake)
					b.wake = make(chan struct{})
				})
			}, nil
		}
		wake := b.wake
		b.mu.Unlock()
		select {
		case <-ctx.Done():
			return PreparedToolCall{}, nil, ctx.Err()
		case <-wake:
		}
	}
}

// Abort prevents not-yet-dispatched calls crossing a barrier after a missing
// durable result. Existing external operations still require truthful cleanup.
func (b *ToolBatch) Abort(err error) {
	if err == nil {
		err = reject("TOOL_BATCH_ABORTED")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.aborted == nil {
		b.aborted = err
		close(b.wake)
		b.wake = make(chan struct{})
	}
}

func (b *ToolBatch) ready(idx int) bool {
	if b.active >= b.limit {
		return false
	}
	// Every prior serial call is a barrier; a serial call itself requires all
	// prior calls to have a logical result, including interaction waits.
	serial := !b.calls[idx].Spec.ParallelSafe
	for n := 0; n < idx; n++ {
		if !b.done[n] && (serial || !b.calls[n].Spec.ParallelSafe) {
			return false
		}
	}
	return !serial || b.active == 0
}
