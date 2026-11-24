// Package events owns scoped business events and independent script subscriptions.
package events

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/scriptcore"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

type EventType struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
type Group struct {
	Code  string      `json:"code"`
	Name  string      `json:"name"`
	Types []EventType `json:"types"`
}

type TypeVersion struct {
	EventGroup string          `db:"event_group"`
	DataSchema json.RawMessage `db:"data_schema"`
}

type Record struct {
	ID            uint64          `db:"id" json:"id,string"`
	SourceKind    string          `db:"source_kind" json:"source_kind"`
	SourceID      uint64          `db:"source_id" json:"source_id,string"`
	MessageID     *string         `db:"source_message_id" json:"source_message_id"`
	SourceType    string          `db:"source_event_type" json:"source_event_type"`
	Group         string          `db:"group_code" json:"group"`
	Type          string          `db:"event_type" json:"type"`
	SchemaVersion uint32          `db:"schema_version" json:"schema_version"`
	RepositoryID  string          `db:"source_repository_id" json:"source_repository_id"`
	SubjectKind   string          `db:"subject_kind" json:"subject_kind"`
	SubjectID     string          `db:"subject_id" json:"subject_id"`
	OccurredAt    *time.Time      `db:"occurred_at" json:"occurred_at"`
	ReceivedAt    time.Time       `db:"received_at" json:"received_at"`
	Data          json.RawMessage `db:"data" json:"data"`
	Raw           json.RawMessage `db:"raw_payload" json:"raw"`
	PayloadHash   string          `db:"payload_hash" json:"-"`
	Metadata      json.RawMessage `db:"source_metadata" json:"source_metadata"`
	RoutingResult string          `db:"routing_result" json:"routing_result"`
}

type Reference struct {
	ID        uint64          `db:"id" json:"id,string"`
	EventID   uint64          `db:"event_id" json:"event_id,string"`
	ScopeKind string          `db:"scope_kind" json:"scope_kind"`
	ScopeID   uint64          `db:"scope_id" json:"scope_id,string"`
	Basis     json.RawMessage `db:"routing_basis" json:"routing_basis"`
	CreatedAt time.Time       `db:"created_at" json:"created_at"`
	Event     *Record         `db:"-" json:"event,omitempty"`
}

type Subscription struct {
	ID          uint64     `db:"id" json:"id,string"`
	ScopeKind   string     `db:"scope_kind" json:"scope_kind"`
	ScopeID     uint64     `db:"scope_id" json:"scope_id,string"`
	Name        string     `db:"name" json:"name"`
	Description string     `db:"description" json:"description"`
	Enabled     bool       `db:"enabled" json:"enabled"`
	RevisionID  uint64     `db:"current_revision_id" json:"revision_id,string"`
	NextEnqueue uint64     `db:"next_enqueue_seq" json:"-"`
	NextConsume uint64     `db:"next_consume_seq" json:"-"`
	Version     uint64     `db:"row_version" json:"version,string"`
	Creator     uint64     `db:"created_by_user_id" json:"created_by_user_id,string"`
	Updater     uint64     `db:"updated_by_user_id" json:"updated_by_user_id,string"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
	DeletedAt   *time.Time `db:"deleted_at" json:"deleted_at"`
	Config      *Revision  `db:"-" json:"config,omitempty"`
	CanManage   bool       `db:"-" json:"can_manage"`
}

// Script is deliberately excluded from every public revision projection.
type Revision struct {
	ID              uint64          `db:"id" json:"id,string"`
	SubscriptionID  uint64          `db:"subscription_id" json:"subscription_id,string"`
	Number          uint64          `db:"revision_no" json:"revision_no"`
	EventTypes      json.RawMessage `db:"event_types" json:"event_types"`
	RunAsUserID     uint64          `db:"run_as_user_id" json:"run_as_user_id,string"`
	APIVersion      uint32          `db:"script_api_version" json:"script_api_version"`
	Script          string          `db:"script" json:"-"`
	TimeoutMS       uint64          `db:"timeout_ms" json:"timeout_ms"`
	MaxRetries      uint32          `db:"max_retries" json:"max_retries"`
	RetryIntervalMS uint64          `db:"retry_interval_ms" json:"retry_interval_ms"`
	Creator         uint64          `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt       time.Time       `db:"created_at" json:"created_at"`
}

type Write struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Enabled     bool     `json:"enabled"`
	Version     string   `json:"version"`
	EventTypes  []string `json:"event_types"`
	RunAsUserID uint64   `json:"run_as_user_id,string"`
	Script      string   `json:"script"`
	TimeoutMS   uint64   `json:"timeout_ms"`
	MaxRetries  *uint32  `json:"max_retries"`
}

type Consumption struct {
	AutomaticReferenceID *uint64         `db:"automatic_scope_ref_id" json:"-"`
	ID                   uint64          `db:"id" json:"id,string"`
	SubscriptionID       uint64          `db:"subscription_id" json:"subscription_id,string"`
	RevisionID           uint64          `db:"revision_id" json:"revision_id,string"`
	ReferenceID          uint64          `db:"scope_ref_id" json:"scope_ref_id,string"`
	QueueSeq             uint64          `db:"queue_seq" json:"queue_seq"`
	Status               string          `db:"status" json:"status"`
	Attempt              uint32          `db:"attempt_count" json:"attempt_count"`
	StartedAt            *time.Time      `db:"started_at" json:"started_at"`
	DeadlineAt           *time.Time      `db:"deadline_at" json:"deadline_at"`
	NextRetryAt          *time.Time      `db:"next_retry_at" json:"next_retry_at"`
	FinishedAt           *time.Time      `db:"finished_at" json:"finished_at"`
	ErrorCode            string          `db:"error_code" json:"error_code"`
	ErrorSummary         string          `db:"error_summary" json:"error_summary"`
	Result               json.RawMessage `db:"result" json:"result"`
	HasResult            bool            `db:"has_result" json:"has_result"`
	RetryOf              *uint64         `db:"retry_of_id" json:"retry_of_id,string"`
	OperatorID           *uint64         `db:"operator_user_id" json:"operator_user_id,string"`
	LastLogSeq           uint64          `db:"last_log_seq" json:"last_log_seq"`
	LogCount             uint64          `db:"script_log_count" json:"-"`
	LogBytes             uint64          `db:"script_log_bytes" json:"-"`
	Truncated            bool            `db:"script_logs_truncated" json:"script_logs_truncated"`
	CreatedAt            time.Time       `db:"created_at" json:"created_at"`
}

func (c *Consumption) Terminal() bool {
	return c.Status == "succeeded" || c.Status == "failed" || c.Status == "cancelled"
}

type Log struct {
	ConsumptionID uint64          `db:"consumption_id" json:"consumption_id,string"`
	Seq           uint64          `db:"seq" json:"seq"`
	Attempt       uint32          `db:"attempt_no" json:"attempt_no"`
	At            time.Time       `db:"occurred_at" json:"occurred_at"`
	Kind          string          `db:"kind" json:"kind"`
	Level         string          `db:"level" json:"level"`
	Message       string          `db:"message" json:"message"`
	Fields        json.RawMessage `db:"fields" json:"fields"`
}

type Target struct {
	ProjectID    uint64 `db:"project_id" json:"project_id,string"`
	RepositoryID uint64 `db:"id" json:"project_repository_id,string"`
}

type Filter struct {
	Before         uint64
	SubscriptionID uint64
	Type           string
	Status         string
}

type Repository interface {
	Catalog() ([]Group, error)
	TypeVersion(string, uint32) (*TypeVersion, error)
	Targets(uint64, string) ([]Target, error)
	Record(uint64) (*Record, error)
	RecordByMessage(string, uint64, string) (*Record, error)
	InsertRecord(*Record) error
	References(uint64, Filter) ([]Reference, error)
	Reference(uint64) (*Reference, error)
	InsertReference(*Reference) error
	Subscriptions(uint64, bool) ([]Subscription, error)
	Subscription(uint64, bool) (*Subscription, error)
	SaveSubscription(*Subscription) error
	Revision(uint64) (*Revision, error)
	Revisions(uint64) ([]Revision, error)
	InsertRevision(*Revision) error
	Consumptions(uint64, Filter) ([]Consumption, error)
	Consumption(uint64, bool) (*Consumption, error)
	Head(uint64, uint64, bool) (*Consumption, error)
	RetryChild(uint64) (*Consumption, error)
	InsertConsumption(*Consumption) error
	SaveConsumption(*Consumption) error
	AppendLog(*Consumption, *Log) error
	Logs(uint64, uint64) ([]Log, error)
	CancelQueued(uint64, time.Time) error
	WorkSubscriptions(bool) ([]uint64, error)
	ActiveConsumptions() ([]Consumption, error)
}

// Action is constructed only by the consumer host, never decoded from script input.
type Action struct {
	Kind           string
	Path           string
	Args           json.RawMessage
	ProjectID      uint64
	ActorID        uint64
	SubscriptionID uint64
	ConsumptionID  uint64
	Attempt        uint32
}

type Service struct {
	schemas  sync.Map // compiled schemas keyed by immutable type and version
	Identity *identity.Service
	Store    func() (identity.Store, error)
	State    func() (statestore.Backend, error)
	Executor scriptcore.Executor
	Dispatch func(context.Context, Action) (any, error)
}
