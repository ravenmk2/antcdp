// Package sandboxes owns durable sandbox resources independently of their consumers.
package sandboxes

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type Instance struct {
	ID                uint64          `db:"id"`
	ConnectionID      uint64          `db:"connection_id"`
	BackendGeneration uint64          `db:"backend_generation"`
	RemoteID          *string         `db:"remote_id"`
	CreationToken     string          `db:"creation_token"`
	State             string          `db:"state"`
	EffectiveConfig   json.RawMessage `db:"effective_config"`
	Capabilities      json.RawMessage `db:"verified_capabilities"`
	ExpiresAt         *time.Time      `db:"expires_at"`
	LastObservedAt    *time.Time      `db:"last_observed_at"`
	ErrorCode         *string         `db:"error_code"`
	ExecutorEpoch     string          `db:"executor_epoch"`
	FenceVersion      uint64          `db:"fence_version"`
	RowVersion        uint64          `db:"row_version"`
	CreatedAt         time.Time       `db:"created_at"`
	UpdatedAt         time.Time       `db:"updated_at"`
	FinishedAt        *time.Time      `db:"finished_at"`
}

type Lease struct {
	ID            uint64     `db:"id"`
	InstanceID    uint64     `db:"sandbox_instance_id"`
	ConsumerKind  string     `db:"consumer_kind"`
	ConsumerID    string     `db:"consumer_id"`
	Mode          string     `db:"mode"`
	State         string     `db:"state"`
	ExecutorEpoch string     `db:"executor_epoch"`
	FenceVersion  uint64     `db:"fence_version"`
	AcquiredAt    time.Time  `db:"acquired_at"`
	ExpiresAt     time.Time  `db:"lease_expires_at"`
	ReleasedAt    *time.Time `db:"released_at"`
	ReleaseReason *string    `db:"release_reason"`
	UpdatedAt     time.Time  `db:"updated_at"`
}

type Execution struct {
	ID                uint64          `db:"id"`
	InstanceID        uint64          `db:"sandbox_instance_id"`
	LeaseID           uint64          `db:"lease_id"`
	Token             string          `db:"execution_token"`
	RemoteID          *string         `db:"remote_execution_id"`
	Background        bool            `db:"is_background"`
	Status            string          `db:"status"`
	CWD               string          `db:"cwd"`
	SpecHash          []byte          `db:"execution_spec_hash"`
	ExecutorEpoch     string          `db:"executor_epoch"`
	FenceVersion      uint64          `db:"fence_version"`
	ExitCode          *int            `db:"exit_code"`
	OutputCursor      *string         `db:"output_cursor"`
	Observation       json.RawMessage `db:"last_observation"`
	ErrorCode         *string         `db:"error_code"`
	CreatedAt         time.Time       `db:"created_at"`
	StartedAt         *time.Time      `db:"started_at"`
	DeadlineAt        time.Time       `db:"deadline_at"`
	CancelRequestedAt *time.Time      `db:"cancel_requested_at"`
	LastObservedAt    *time.Time      `db:"last_observed_at"`
	FinishedAt        *time.Time      `db:"finished_at"`
}

type Operation struct {
	ID                uint64          `db:"id"`
	InstanceID        uint64          `db:"sandbox_instance_id"`
	LeaseID           *uint64         `db:"lease_id"`
	Token             string          `db:"operation_token"`
	Kind              string          `db:"kind"`
	Status            string          `db:"status"`
	RequestHash       []byte          `db:"request_hash"`
	Intent            json.RawMessage `db:"intent"`
	Observation       json.RawMessage `db:"observation"`
	ExecutorEpoch     string          `db:"executor_epoch"`
	FenceVersion      uint64          `db:"fence_version"`
	ErrorCode         *string         `db:"error_code"`
	CreatedAt         time.Time       `db:"created_at"`
	StartedAt         *time.Time      `db:"started_at"`
	DeadlineAt        time.Time       `db:"deadline_at"`
	CancelRequestedAt *time.Time      `db:"cancel_requested_at"`
	FinishedAt        *time.Time      `db:"finished_at"`
	UpdatedAt         time.Time       `db:"updated_at"`
}

// Repository methods run inside one transaction. Mutations lock the instance
// before leases, executions and operations; provider IO never runs in a transaction.
type Repository interface {
	Instance(uint64, bool) (*Instance, error)
	InstanceByToken(string) (*Instance, error)
	InsertInstance(*Instance) error
	SaveInstance(*Instance) error
	Lease(uint64, bool) (*Lease, error)
	Leases(uint64) ([]Lease, error)
	InsertLease(*Lease) error
	SaveLease(*Lease) error
	Execution(uint64, bool) (*Execution, error)
	ExecutionByToken(string) (*Execution, error)
	InsertExecution(*Execution) error
	SaveExecution(*Execution) error
	Operation(uint64, bool) (*Operation, error)
	OperationByToken(string) (*Operation, error)
	InsertOperation(*Operation) error
	SaveOperation(*Operation) error
	Busy(uint64, *uint64) (bool, error)
	// Bounded pages start after the cursor and wrap to the oldest pending row.
	PendingExecutions(uint64, int) ([]Execution, error)
	PendingOperations(uint64, int) ([]Operation, error)
	ExpiredLeases(time.Time, uint64, int) ([]Lease, error)
}

type Transaction func(context.Context, func(Repository) error) error

// Open resolves the exact connection generation. An old instance must never be
// operated through a replacement backend, even if a remote ID happens to match.
type Open func(context.Context, uint64, uint64) (sandboxcore.Provider, error)

type Service struct {
	Transact       Transaction
	Open           Open
	InstallationID func() (string, error)
	Epoch          string
	Recovery       *RecoveryCursor
	localRecovery  RecoveryCursor
}

// RecoveryCursor is scheduling state, not a claim on remote work. Losing it on
// restart only changes scan order. Share it when constructing short-lived service
// adapters so unresolved early rows cannot starve later resources.
type RecoveryCursor struct {
	mu                                    sync.Mutex
	executions, operations, files, leases uint64
}

func (s *Service) recoveryCursor() *RecoveryCursor {
	if s.Recovery != nil {
		return s.Recovery
	}
	return &s.localRecovery
}

func (s *Service) Resource(v *Instance) (sandboxcore.ResourceRef, error) {
	if v == nil || v.RemoteID == nil || *v.RemoteID == "" {
		return sandboxcore.ResourceRef{}, fail("SANDBOX_NOT_READY")
	}
	installation, err := s.InstallationID()
	if err != nil {
		return sandboxcore.ResourceRef{}, err
	}
	return sandboxcore.ResourceRef{BackendGeneration: v.BackendGeneration, RemoteID: *v.RemoteID, Ownership: sandboxcore.Ownership{InstallationID: installation, InstanceID: v.ID, CreationToken: v.CreationToken}}, nil
}

func fail(code string) error { return &sandboxcore.Error{Code: code} }
func nowUTC() time.Time      { return time.Now().UTC().Truncate(time.Millisecond) }
