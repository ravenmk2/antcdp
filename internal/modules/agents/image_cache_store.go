package agents

import (
	"encoding/json"
	"time"
)

// Image cache records are rebuildable acceleration state, not authorization or
// conversation history. Payloads contain versioned variants or remote mappings.
type ImageCacheRow struct {
	ID         uint64          `db:"id"`
	Key        []byte          `db:"cache_key"`
	State      string          `db:"state"`
	Payload    json.RawMessage `db:"payload"`
	LeaseToken string          `db:"lease_token"`
	LeaseUntil *time.Time      `db:"lease_until"`
	LastUsedAt time.Time       `db:"last_used_at"`
	CreatedAt  time.Time       `db:"created_at"`
	UpdatedAt  time.Time       `db:"updated_at"`
}
