// Package cloudcomputers implements the persistent cloud computer product on sandbox resources.
package cloudcomputers

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/sandboxes"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type Computer struct {
	ID                   uint64          `db:"id"`
	OwnerUserID          uint64          `db:"owner_user_id"`
	PoolAgentID          *uint64         `db:"pool_agent_id"`
	State                string          `db:"state"`
	BackendGeneration    uint64          `db:"backend_generation"`
	InstanceID           uint64          `db:"sandbox_instance_id"`
	StorageGeneration    uint64          `db:"storage_generation"`
	RuntimeID            *string         `db:"runtime_id"`
	RuntimeCreationToken *string         `db:"runtime_creation_token"`
	RuntimeExpiresAt     *time.Time      `db:"runtime_expires_at"`
	VolumeID             *string         `db:"volume_id"`
	VolumeName           *string         `db:"volume_name"`
	VolumeState          string          `db:"volume_state"`
	VolumeCleanupState   string          `db:"volume_cleanup_state"`
	AppliedSpecID        *uint64         `db:"applied_spec_id"`
	AppliedSpecVersion   *uint64         `db:"applied_spec_version"`
	EffectiveEnvironment json.RawMessage `db:"effective_environment"`
	Capabilities         json.RawMessage `db:"verified_capabilities"`
	IdleSince            time.Time       `db:"idle_since"`
	LastActivityAt       time.Time       `db:"last_activity_at"`
	LastObservedAt       *time.Time      `db:"last_observed_at"`
	ErrorCode            *string         `db:"error_code"`
	FenceVersion         uint64          `db:"fence_version"`
	RowVersion           uint64          `db:"row_version"`
	DeletedAt            *time.Time      `db:"deleted_at"`
	CreatedAt            time.Time       `db:"created_at"`
	UpdatedAt            time.Time       `db:"updated_at"`
}

type Operation struct {
	SandboxOperationID *uint64         `db:"sandbox_operation_id"`
	ID                 uint64          `db:"id"`
	ComputerID         uint64          `db:"cloud_computer_id"`
	RootRunID          *uint64         `db:"root_run_id"`
	Kind               string          `db:"kind"`
	Status             string          `db:"status"`
	OperationToken     string          `db:"operation_token"`
	CommandReceiptID   *uint64         `db:"command_receipt_id"`
	BackendGeneration  uint64          `db:"backend_generation"`
	InstanceID         uint64          `db:"sandbox_instance_id"`
	StorageGeneration  uint64          `db:"storage_generation"`
	TargetEnvironment  json.RawMessage `db:"target_environment"`
	TargetSpecID       *uint64         `db:"target_spec_id"`
	TargetSpecVersion  *uint64         `db:"target_spec_version"`
	Intent             json.RawMessage `db:"intent"`
	Observation        json.RawMessage `db:"observation"`
	ActorKind          string          `db:"actor_kind"`
	ActorID            string          `db:"actor_id"`
	ExecutorEpoch      string          `db:"executor_epoch"`
	FenceVersion       uint64          `db:"fence_version"`
	ErrorCode          *string         `db:"error_code"`
	CreatedAt          time.Time       `db:"created_at"`
	StartedAt          *time.Time      `db:"started_at"`
	DeadlineAt         time.Time       `db:"deadline_at"`
	CancelRequestedAt  *time.Time      `db:"cancel_requested_at"`
	FinishedAt         *time.Time      `db:"finished_at"`
	UpdatedAt          time.Time       `db:"updated_at"`
}

type Activity struct {
	Terminals  int `db:"terminals"`
	Leases     int `db:"leases"`
	Transfers  int `db:"transfers"`
	Unknown    int `db:"unknown"`
	References int `db:"refs"`
	Operations int `db:"operations"`
}

type Capabilities struct {
	Lifecycle           string `json:"lifecycle"`
	Execution           string `json:"execution"`
	ExecutionInspection string `json:"execution_inspection"`
	Cancellation        string `json:"cancellation"`
	FileTransfer        string `json:"file_transfer"`
	PersistentWorkspace string `json:"persistent_workspace"`
	NetworkEnforcement  string `json:"network_enforcement"`
	VolumeDeletion      string `json:"volume_deletion"`
}

type DiagnosticCheck struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Reason *string `json:"reason"`
}

type Connection struct {
	BackendGeneration                uint64
	Endpoint, AccessMode, APIKey     string
	ConnectTimeout, OperationTimeout time.Duration
}

type OperationIntent struct {
	OriginalRuntime *sandboxcore.ResourceRef `json:"original_runtime,omitempty"`
	Create          *sandboxcore.CreateSpec  `json:"create,omitempty"`
	CreateSent      bool                     `json:"create_sent"`
	TerminateSent   bool                     `json:"terminate_sent"`
	TransitionSent  bool                     `json:"transition_sent"`
	VolumeNew       bool                     `json:"volume_new"`
	Phase           string                   `json:"phase"`
}
type Environment struct {
	Image   string                            `json:"image"`
	CPU     int                               `json:"cpu_millicores"`
	Memory  int                               `json:"memory_mib"`
	Network sandboxcore.NetworkPolicySnapshot `json:"network"`
}
type Access struct {
	Provider                                                     sandboxcore.Provider
	Resource                                                     sandboxcore.ResourceRef
	ComputerID, BackendGeneration, InstanceID, StorageGeneration uint64
	OperationID, OperationFence                                  uint64
	CWD                                                          string
}
type Repository interface {
	Computer(uint64, bool) (*Computer, error)
	SaveComputer(*Computer) error
	CloudOperation(uint64, bool) (*Operation, error)
	SaveCloudOperation(*Operation) error
	CloudActivity(uint64) (Activity, error)
}
type Service struct {
	Connection         func() (*sandboxes.Connection, error)
	Transact           func(context.Context, func(Repository) error) error
	Sandboxes          *sandboxes.Service
	Epoch              string
	InstallationID     func() (string, error)
	DecodeConnection   func(*sandboxes.Connection) (Connection, error)
	OpenProvider       func(context.Context, Connection) (sandboxcore.Provider, error)
	ProtectedTargets   func() ([]string, error)
	EndpointProtection func(string) ([]string, error)
	PrepareWorkspace   func(context.Context, *Access, uint64) error
	VerifyEnvironment  func(context.Context, *Access) (Capabilities, []DiagnosticCheck, error)
}
