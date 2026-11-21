package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/cloudcomputers"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/sandboxes"
)

type SandboxConnection = sandboxes.Connection

// A computer keeps one current runtime and volume; replacement never creates a
// second logical computer or changes a session's binding.
type CloudComputerRow = cloudcomputers.Computer

type CloudLeaseRow struct {
	SandboxLeaseID    *uint64    `db:"sandbox_lease_id"`
	RootRunID         uint64     `db:"root_run_id"`
	ComputerID        uint64     `db:"cloud_computer_id"`
	Mode              string     `db:"mode"`
	State             string     `db:"state"`
	BackendGeneration uint64     `db:"backend_generation"`
	InstanceID        *uint64    `db:"sandbox_instance_id"`
	StorageGeneration uint64     `db:"storage_generation"`
	SkillSetHash      string     `db:"skill_set_hash"`
	ExecutorEpoch     string     `db:"executor_epoch"`
	FenceVersion      uint64     `db:"fence_version"`
	AcquiredAt        time.Time  `db:"acquired_at"`
	LeaseExpiresAt    time.Time  `db:"lease_expires_at"`
	ReleasedAt        *time.Time `db:"released_at"`
	ReleaseReason     *string    `db:"release_reason"`
	UpdatedAt         time.Time  `db:"updated_at"`
}

type CloudSkillStateRow struct {
	ComputerID        uint64          `db:"cloud_computer_id"`
	AgentID           uint64          `db:"agent_id"`
	BackendGeneration uint64          `db:"backend_generation"`
	StorageGeneration uint64          `db:"storage_generation"`
	InstalledSetHash  string          `db:"installed_set_hash"`
	InstalledManifest json.RawMessage `db:"installed_manifest"`
	State             string          `db:"state"`
	SyncToken         string          `db:"sync_token"`
	FenceVersion      uint64          `db:"fence_version"`
	RowVersion        uint64          `db:"row_version"`
	UpdatedAt         time.Time       `db:"updated_at"`
}

type CloudExecutionRow struct {
	SandboxLeaseID    uint64          `db:"lease_id"`
	ID                uint64          `db:"id"`
	ComputerID        uint64          `db:"cloud_computer_id"`
	BackendGeneration uint64          `db:"backend_generation"`
	InstanceID        uint64          `db:"sandbox_instance_id"`
	RootRunID         uint64          `db:"root_run_id"`
	RunID             uint64          `db:"run_id"`
	ToolCallID        uint64          `db:"tool_call_id"`
	ExecutionOrdinal  uint64          `db:"execution_ordinal"`
	ExecutionToken    string          `db:"execution_token"`
	RemoteExecutionID *string         `db:"remote_execution_id"`
	IsBackground      bool            `db:"is_background"`
	Status            string          `db:"status"`
	CWD               string          `db:"cwd"`
	ExecutionSpecHash []byte          `db:"execution_spec_hash"`
	ExecutorEpoch     string          `db:"executor_epoch"`
	FenceVersion      uint64          `db:"fence_version"`
	ExitCode          *int            `db:"exit_code"`
	OutputCursor      *string         `db:"output_cursor"`
	LastObservation   json.RawMessage `db:"last_observation"`
	ErrorCode         *string         `db:"error_code"`
	CreatedAt         time.Time       `db:"created_at"`
	StartedAt         *time.Time      `db:"started_at"`
	DeadlineAt        time.Time       `db:"deadline_at"`
	CancelRequestedAt *time.Time      `db:"cancel_requested_at"`
	LastObservedAt    *time.Time      `db:"last_observed_at"`
	FinishedAt        *time.Time      `db:"finished_at"`
}

type CloudOperationRow = cloudcomputers.Operation

type CloudRepository interface {
	CloudReceipt(string, string, string, string, string) (*Receipt, error)
	InsertCloudReceipt(*Receipt) error
	SaveCloudReceipt(*Receipt) error
	Sandbox() sandboxes.Repository

	SandboxSpecs() ([]SandboxSpec, error)
	SandboxSpec(uint64, bool) (*SandboxSpec, error)
	InsertSandboxSpec(*SandboxSpec, uint64) error
	UpdateSandboxSpec(*SandboxSpec, uint64) error
	DeleteSandboxSpec(uint64) error
	SpecReferences(uint64) ([]SpecReference, error)
	BoundSandboxSpec(*uint64) (*SandboxSpec, error)
	SpecBinding(*uint64, bool) (*SpecBinding, error)
	InsertSpecBinding(*uint64, *uint64, uint64) error
	UpdateSpecBinding(*SpecBinding, uint64) error
	DeleteSpecBinding(uint64) error
	Computer(uint64, bool) (*CloudComputerRow, error)
	PersonalComputer(uint64, bool) (*CloudComputerRow, error)
	PoolComputers(uint64, bool) ([]CloudComputerRow, error)
	Computers(CloudQuery) ([]CloudComputerRow, int, error)
	InsertComputer(*CloudComputerRow) error
	SaveComputer(*CloudComputerRow) error
	Lease(uint64, bool) (*CloudLeaseRow, error)
	ComputerLeases(uint64) ([]CloudLeaseRow, error)
	PendingLeases(int) ([]CloudLeaseRow, error)
	InsertLease(*CloudLeaseRow) error
	SaveLease(*CloudLeaseRow) error
	CloudActivity(uint64) (CloudActivity, error)
	SessionUploadBlocked(computerID, sessionID uint64) (bool, error)

	ComputerSessions(uint64) ([]SessionRow, error)
	CloudRootWorkPending(uint64) (bool, error)
	SkillState(uint64, uint64, bool) (*CloudSkillStateRow, error)
	SaveSkillState(*CloudSkillStateRow) error
	CloudExecution(uint64, bool) (*CloudExecutionRow, error)
	InsertCloudExecution(*CloudExecutionRow) error
	SaveCloudExecution(*CloudExecutionRow) error
	LeaseExecutions(uint64) ([]CloudExecutionRow, error)
	ListedCommandRows(uint64) ([]CloudExecutionRow, error)
	CommandDeclared(uint64) (bool, error)
	CloudOperation(uint64, bool) (*CloudOperationRow, error)
	InsertCloudOperation(*CloudOperationRow) error
	SaveCloudOperation(*CloudOperationRow) error
	ActiveCloudOperation(uint64) (*CloudOperationRow, error)
	LatestCloudOperation(uint64) (*CloudOperationRow, error)
	CloudOperationByToken(string, bool) (*CloudOperationRow, error)
	PendingCloudOperations(string, time.Time, int) ([]CloudOperationRow, error)
	PendingWorkspaceOperations(string, time.Time, int) ([]CloudOperationRow, error)
	HolderReferences(string, string, bool) ([]ResourceReferenceRow, error)
	ActiveResourceReferences(string, uint64) ([]ResourceReferenceRow, error)
}

type CloudActivity = cloudcomputers.Activity

func CloudStateFor(tx identity.Tx) (CloudRepository, error) {
	p, ok := tx.(interface{ CloudState() CloudRepository })
	if !ok {
		return nil, unavailable()
	}
	return p.CloudState(), nil
}
