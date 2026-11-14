// Package commandstate contains shared durable command representations.
package commandstate

import (
	"encoding/json"
	"time"
)

type Receipt struct {
	ID             uint64          `db:"id"`
	ActorKind      string          `db:"actor_kind"`
	ActorID        string          `db:"actor_id"`
	ScopeKind      string          `db:"scope_kind"`
	ScopeID        string          `db:"scope_id"`
	Command        string          `db:"command_kind"`
	Key            string          `db:"idempotency_key"`
	Hash           []byte          `db:"request_hash"`
	Status         string          `db:"status"`
	ResponseStatus int             `db:"response_status"`
	Result         json.RawMessage `db:"result"`
	OperationID    *uint64         `db:"operation_id"`
	TargetKind     *string         `db:"target_kind"`
	TargetID       *uint64         `db:"target_id"`
	CreatedAt      time.Time       `db:"created_at"`
	CompletedAt    *time.Time      `db:"completed_at"`
}
type CommandReceipt struct {
	Command        string        `json:"command"`
	Scope          string        `json:"scope"`
	Key            string        `json:"key"`
	ResponseStatus int           `json:"response_status"`
	ResponseData   any           `json:"response_data"`
	Resources      []ResourceRef `json:"resource_refs"`
	CreatedAt      time.Time     `json:"created_at"`
}
type ResourceRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}
type Outcome struct {
	Certainty string  `json:"certainty"`
	Reason    *string `json:"reason"`
}
