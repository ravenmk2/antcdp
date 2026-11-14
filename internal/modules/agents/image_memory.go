package agents

import (
	"context"
	"sync"
)

// Verified immutable bytes only. Authorization is checked before every use.
// Encode once; keep the cache bounded independently of history length.
type imageMemoryEntry struct {
	value string
	used  uint64
}
type imageMemory struct {
	mu      sync.Mutex
	entries map[string]imageMemoryEntry
	flights map[string]chan struct{}
	size    int
	tick    uint64
}

const imageMemoryLimit = 64 << 20

func (m *imageMemory) get(ctx context.Context, key string, load func() (string, error)) (string, error) {
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		m.mu.Lock()
		m.tick++
		if entry, ok := m.entries[key]; ok {
			entry.used = m.tick
			m.entries[key] = entry
			m.mu.Unlock()
			return entry.value, nil
		}
		if done := m.flights[key]; done != nil {
			m.mu.Unlock()
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-done:
			}
			continue
		}
		if m.flights == nil {
			m.flights = map[string]chan struct{}{}
		}
		done := make(chan struct{})
		m.flights[key] = done
		m.mu.Unlock()
		value, err := load()
		m.mu.Lock()
		if err == nil && len(value) <= imageMemoryLimit {
			if m.entries == nil {
				m.entries = map[string]imageMemoryEntry{}
			}
			for m.size+len(value) > imageMemoryLimit {
				var oldest string
				age := ^uint64(0)
				for k, v := range m.entries {
					if v.used < age {
						oldest, age = k, v.used
					}
				}
				m.size -= len(m.entries[oldest].value)
				delete(m.entries, oldest)
			}
			m.tick++
			m.entries[key] = imageMemoryEntry{value, m.tick}
			m.size += len(value)
		}
		delete(m.flights, key)
		close(done)
		m.mu.Unlock()
		return value, err
	}
}
