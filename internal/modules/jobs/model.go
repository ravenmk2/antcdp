// Package jobs owns project automation definitions and their durable execution.
package jobs

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/jobcore"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

type AgentChatOptions struct {
	Message    string `json:"message"`
	Title      string `json:"title"`
	RequestKey string `json:"requestKey"`
}
type Job struct {
	Code           string     `db:"code" json:"code"`
	ID             uint64     `db:"id" json:"id,string"`
	ScopeKind      string     `db:"scope_kind" json:"scope_kind"`
	ProjectID      uint64     `db:"scope_id" json:"project_id,string"`
	Name           string     `db:"name" json:"name"`
	Description    string     `db:"description" json:"description"`
	Enabled        bool       `db:"enabled" json:"enabled"`
	RevisionID     *uint64    `db:"current_revision_id" json:"revision_id,string"`
	MaxConcurrency uint32     `db:"max_concurrency" json:"max_concurrency"`
	BusyPolicy     string     `db:"busy_policy" json:"busy_policy"`
	TimeoutMS      uint64     `db:"timeout_ms" json:"timeout_ms"`
	Version        uint64     `db:"row_version" json:"version,string"`
	Creator        uint64     `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at" json:"updated_at"`
	CanRun         bool       `db:"-" json:"can_run"`
	CanManage      bool       `db:"-" json:"can_manage"`
	QueuedCount    uint64     `db:"queued_count" json:"queued_count"`
	ActiveCount    uint64     `db:"active_count" json:"active_count"`
	LatestStatus   string     `db:"latest_status" json:"latest_status"`
	NextFire       *time.Time `db:"next_fire_at" json:"next_fire_at"`
}
type Filter struct {
	Before uint64
	Query  string
	Status string
}
type Parameter struct {
	Name     string          `json:"name"`
	Label    string          `json:"label"`
	Type     string          `json:"type"`
	Required bool            `json:"required"`
	Default  json.RawMessage `json:"default,omitempty"`
	Options  []string        `json:"options,omitempty"`
}
type Config struct {
	RunAsUserID uint64      `json:"run_as_user_id,string"`
	Script      string      `json:"script"`
	Parameters  []Parameter `json:"parameters"`
}

func (c *Config) accountID() uint64 {
	if c == nil {
		return 0
	}
	return c.RunAsUserID
}

type Revision struct {
	ID    uint64 `json:"id,string"`
	JobID uint64 `json:"job_id,string"`
	Config
	Hash      string    `json:"-"`
	Creator   uint64    `json:"created_by_user_id,string"`
	CreatedAt time.Time `json:"created_at"`
}
type Grant struct {
	Kind string `db:"subject_kind" json:"kind"`
	ID   uint64 `db:"subject_id" json:"id,string"`
}
type Write struct {
	Code           string  `json:"code"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	Enabled        bool    `json:"enabled"`
	MaxConcurrency uint32  `json:"max_concurrency"`
	BusyPolicy     string  `json:"busy_policy"`
	TimeoutMS      uint64  `json:"timeout_ms"`
	Version        string  `json:"version"`
	Config         *Config `json:"config"`
	Grants         []Grant `json:"grants"`
}
type Detail struct {
	*Job
	Config     *Config     `json:"config,omitempty"`
	Parameters []Parameter `json:"parameters"`
	Grants     []Grant     `json:"grants,omitempty"`
}
type Run struct {
	RunAsUserID    uint64          `db:"run_as_user_id" json:"run_as_user_id,string"`
	ID             uint64          `db:"id" json:"id,string"`
	JobID          uint64          `db:"job_id" json:"job_id,string"`
	RevisionID     uint64          `db:"revision_id" json:"revision_id,string"`
	Trigger        string          `db:"trigger_kind" json:"trigger_kind"`
	Actor          *uint64         `db:"actor_user_id" json:"actor_user_id,string"`
	TriggerContext json.RawMessage `db:"trigger_context" json:"trigger_context"`
	Inputs         json.RawMessage `db:"inputs" json:"inputs"`
	TimeoutMS      uint64          `db:"timeout_ms" json:"timeout_ms"`
	StateMode      string          `db:"state_mode" json:"state_mode"`
	StateStoreID   *uint64         `db:"state_store_id" json:"state_store_id,string"`
	RerunOf        *uint64         `db:"rerun_of_run_id" json:"rerun_of_run_id,string"`
	Status         string          `db:"status" json:"status"`
	StopReason     string          `db:"stop_reason" json:"stop_reason"`
	ErrorCode      string          `db:"error_code" json:"error_code"`
	ErrorSummary   string          `db:"error_summary" json:"error_summary"`
	Result         json.RawMessage `db:"result" json:"result"`
	HasResult      bool            `db:"has_result" json:"has_result"`
	QueuedAt       time.Time       `db:"queued_at" json:"queued_at"`
	StartedAt      *time.Time      `db:"started_at" json:"started_at"`
	FinishedAt     *time.Time      `db:"finished_at" json:"finished_at"`
	StopActor      *uint64         `db:"stop_requested_by_user_id" json:"stop_requested_by_user_id,string"`
	StopAt         *time.Time      `db:"stop_requested_at" json:"stop_requested_at"`
	LastSeq        uint64          `db:"last_log_seq" json:"last_log_seq"`
	LogCount       uint64          `db:"script_log_count" json:"-"`
	LogBytes       uint64          `db:"script_log_bytes" json:"-"`
	Truncated      bool            `db:"script_logs_truncated" json:"script_logs_truncated"`
}

func (r *Run) Terminal() bool {
	return r.Status == "succeeded" || r.Status == "failed" || r.Status == "cancelled" || r.Status == "timed_out"
}

type Log struct {
	RunID   uint64          `db:"job_run_id" json:"run_id,string"`
	Seq     uint64          `db:"seq" json:"seq"`
	At      time.Time       `db:"occurred_at" json:"occurred_at"`
	Kind    string          `db:"kind" json:"kind"`
	Level   string          `db:"level" json:"level"`
	Message string          `db:"message" json:"message"`
	Fields  json.RawMessage `db:"fields" json:"fields"`
	CallID  *uint64         `db:"resource_call_id" json:"resource_call_id,string"`
}
type Receipt struct {
	CallerKind string    `db:"caller_kind" json:"caller_kind"`
	CallerID   uint64    `db:"caller_id" json:"caller_id,string"`
	ID         uint64    `db:"id" json:"id,string"`
	JobID      uint64    `db:"job_id" json:"job_id,string"`
	Actor      uint64    `db:"actor_user_id" json:"actor_user_id,string"`
	Key        string    `db:"request_key" json:"request_key"`
	Hash       string    `db:"payload_hash" json:"-"`
	Trigger    string    `db:"trigger_kind" json:"trigger_kind"`
	Outcome    string    `db:"outcome" json:"outcome"`
	Reason     string    `db:"reason_code" json:"reason_code"`
	RunID      *uint64   `db:"job_run_id" json:"run_id,string"`
	At         time.Time `db:"created_at" json:"created_at"`
}
type Start struct {
	RequestKey string                     `json:"request_key"`
	Inputs     map[string]json.RawMessage `json:"inputs"`
	Config     *Config                    `json:"config,omitempty"`
	StateMode  string                     `json:"state_mode,omitempty"`
	TimeoutMS  uint64                     `json:"timeout_ms,omitempty"`
	RerunOf    *uint64                    `json:"rerun_of_run_id,string,omitempty"`
}
type Schedule struct {
	ID        uint64          `db:"id" json:"id,string"`
	JobID     uint64          `db:"job_id" json:"job_id,string"`
	Name      string          `db:"name" json:"name"`
	Cron      string          `db:"cron" json:"cron"`
	Timezone  string          `db:"timezone" json:"timezone"`
	Inputs    json.RawMessage `db:"inputs" json:"inputs"`
	Enabled   bool            `db:"enabled" json:"enabled"`
	Next      *time.Time      `db:"next_fire_at" json:"next_fire_at"`
	Version   uint64          `db:"row_version" json:"version,string"`
	Creator   uint64          `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt time.Time       `db:"updated_at" json:"updated_at"`
}
type Fire struct {
	ID          uint64    `db:"id" json:"id,string"`
	ScheduleID  uint64    `db:"schedule_id" json:"schedule_id,string"`
	ScheduledAt time.Time `db:"scheduled_at" json:"scheduled_at"`
	ProcessedAt time.Time `db:"processed_at" json:"processed_at"`
	Outcome     string    `db:"outcome" json:"outcome"`
	Reason      string    `db:"reason_code" json:"reason_code"`
	RunID       *uint64   `db:"job_run_id" json:"run_id,string"`
}
type Call struct {
	ID                   uint64          `db:"id" json:"id,string"`
	RunID                uint64          `db:"job_run_id" json:"run_id,string"`
	Kind                 string          `db:"resource_kind" json:"resource_kind"`
	ResourceID           *uint64         `db:"resource_id" json:"resource_id,string"`
	Authorization        string          `db:"authorization_kind" json:"authorization_kind"`
	ConnectionID         *uint64         `db:"connection_id" json:"connection_id,string,omitempty"`
	ConfiguredCredential *uint64         `db:"configured_credential_id" json:"configured_credential_id,string,omitempty"`
	Credential           *uint64         `db:"credential_id" json:"credential_id,string,omitempty"`
	CredentialVersion    *uint64         `db:"credential_material_version" json:"credential_material_version,string,omitempty"`
	RobotVersion         *uint64         `db:"robot_material_version" json:"robot_material_version,string,omitempty"`
	Snapshot             json.RawMessage `db:"resource_snapshot" json:"resource"`
	Target               string          `db:"target" json:"target"`
	Operation            string          `db:"operation" json:"operation"`
	Outcome              string          `db:"outcome" json:"outcome"`
	ErrorCode            string          `db:"error_code" json:"error_code"`
	ExternalRef          *string         `db:"external_ref" json:"external_ref"`
	CreatedAt            time.Time       `db:"created_at" json:"created_at"`
	FinishedAt           *time.Time      `db:"finished_at" json:"finished_at"`
}

type Repository interface {
	Jobs(uint64, Filter) ([]Job, error)
	Job(uint64) (*Job, error)
	JobByCode(uint64, string) (*Job, error)
	SaveJob(*Job) error
	Revision(uint64) (*Revision, error)
	SaveRevision(*Revision) error
	Grants(uint64) ([]Grant, error)
	SetGrants(uint64, uint64, []Grant) error
	RunAllowed(uint64, uint64) (bool, error)
	Run(uint64) (*Run, error)
	Runs(uint64, uint64) ([]Run, error)
	Active(uint64) ([]Run, error)
	QueuedActors(uint64) ([]uint64, error)
	SaveRun(*Run) error
	AppendLog(*Run, *Log) error
	Logs(uint64, uint64) ([]Log, error)
	Receipt(uint64, uint64, string) (*Receipt, error)
	AutomationReceipt(uint64, uint64, string) (*Receipt, error)
	SaveReceipt(*Receipt) error
	Receipts(uint64, uint64) ([]Receipt, error)
	Schedule(uint64) (*Schedule, error)
	Schedules(uint64) ([]Schedule, error)
	SaveSchedule(*Schedule) error
	SaveFire(*Fire) error
	Fires(uint64, uint64) ([]Fire, error)
	SaveCall(*Call) error
	Call(uint64) (*Call, error)
	Calls(uint64) ([]Call, error)
	CallsForLogs(uint64, uint64, uint64) ([]Call, error)
	WorkJobs() ([]uint64, error)
	RecoveryJobs() ([]uint64, error)
}
type Service struct {
	AgentChat func(context.Context, uint64, uint64, uint64, string, AgentChatOptions) (any, error)
	Identity  *identity.Service
	Store     func() (identity.Store, error)
	State     func() (statestore.Backend, error)
	Executor  jobcore.Executor
	Cipher    func(string, string, bool) (string, error)
	Send      func(context.Context, dingtalk.Authentication, dingtalk.TestInput) dingtalk.Diagnostic
}
