package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// The connection is a singleton. It contains no machine specifications.
type SandboxConnectionRow struct {
	ID                   uint64          `db:"id"`
	Endpoint             *string         `db:"endpoint"`
	AccessMode           string          `db:"access_mode"`
	ConnectTimeout       int             `db:"connect_timeout_seconds"`
	OperationTimeout     int             `db:"operation_timeout_seconds"`
	SecretCiphertext     []byte          `db:"secret_ciphertext"`
	SecretFormatVersion  *uint64         `db:"secret_format_version"`
	SecretKeyVersion     *string         `db:"secret_key_version"`
	SecretRevision       uint64          `db:"secret_revision"`
	ConfigVersion        uint64          `db:"config_version"`
	RowVersion           uint64          `db:"row_version"`
	BackendGeneration    uint64          `db:"backend_generation"`
	TopologyVersion      uint64          `db:"topology_version"`
	MaintenanceState     string          `db:"maintenance_state"`
	VerifiedCapabilities json.RawMessage `db:"verified_capabilities"`
	LastDiagnostic       json.RawMessage `db:"last_diagnostic"`
	LastDiagnosticAt     *time.Time      `db:"last_diagnostic_at"`
	UpdatedByUserID      *uint64         `db:"updated_by_user_id"`
	CreatedAt            time.Time       `db:"created_at"`
	UpdatedAt            time.Time       `db:"updated_at"`
}

type CloudTemplateRow struct {
	ID              uint64          `db:"id"`
	AgentID         *uint64         `db:"agent_id"`
	Environment     json.RawMessage `db:"environment"`
	SchemaVersion   uint64          `db:"config_schema_version"`
	ConfigVersion   uint64          `db:"config_version"`
	RowVersion      uint64          `db:"row_version"`
	UpdatedByUserID *uint64         `db:"updated_by_user_id"`
	CreatedAt       time.Time       `db:"created_at"`
	UpdatedAt       time.Time       `db:"updated_at"`
}

// A computer keeps one current runtime and volume; replacement never creates a
// second logical computer or changes a session's binding.
type CloudComputerRow struct {
	ID                     uint64          `db:"id"`
	OwnerUserID            uint64          `db:"owner_user_id"`
	PoolAgentID            *uint64         `db:"pool_agent_id"`
	State                  string          `db:"state"`
	BackendGeneration      uint64          `db:"backend_generation"`
	RuntimeGeneration      uint64          `db:"runtime_generation"`
	StorageGeneration      uint64          `db:"storage_generation"`
	RuntimeID              *string         `db:"runtime_id"`
	RuntimeCreationToken   *string         `db:"runtime_creation_token"`
	RuntimeExpiresAt       *time.Time      `db:"runtime_expires_at"`
	VolumeID               *string         `db:"volume_id"`
	VolumeName             *string         `db:"volume_name"`
	VolumeState            string          `db:"volume_state"`
	VolumeCleanupState     string          `db:"volume_cleanup_state"`
	AppliedTemplateVersion *uint64         `db:"applied_template_version"`
	EffectiveEnvironment   json.RawMessage `db:"effective_environment"`
	Capabilities           json.RawMessage `db:"verified_capabilities"`
	IdleSince              time.Time       `db:"idle_since"`
	LastActivityAt         time.Time       `db:"last_activity_at"`
	LastObservedAt         *time.Time      `db:"last_observed_at"`
	ErrorCode              *string         `db:"error_code"`
	FenceVersion           uint64          `db:"fence_version"`
	RowVersion             uint64          `db:"row_version"`
	DeletedAt              *time.Time      `db:"deleted_at"`
	CreatedAt              time.Time       `db:"created_at"`
	UpdatedAt              time.Time       `db:"updated_at"`
}

type CloudLeaseRow struct {
	RootRunID         uint64     `db:"root_run_id"`
	ComputerID        uint64     `db:"cloud_computer_id"`
	Mode              string     `db:"mode"`
	State             string     `db:"state"`
	BackendGeneration uint64     `db:"backend_generation"`
	RuntimeGeneration *uint64    `db:"runtime_generation"`
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
	ID                uint64          `db:"id"`
	ComputerID        uint64          `db:"cloud_computer_id"`
	BackendGeneration uint64          `db:"backend_generation"`
	RuntimeGeneration uint64          `db:"runtime_generation"`
	RootRunID         uint64          `db:"root_run_id"`
	RunID             uint64          `db:"run_id"`
	ToolCallID        uint64          `db:"tool_call_id"`
	ExecutionOrdinal  uint64          `db:"execution_ordinal"`
	ExecutionToken    string          `db:"execution_token"`
	RemoteExecutionID *string         `db:"remote_execution_id"`
	IsBackground      bool            `db:"is_background"`
	Status            string          `db:"status"`
	CommandEventSeq   uint64          `db:"command_event_seq"`
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

type CloudOperationRow struct {
	ID                    uint64          `db:"id"`
	ComputerID            uint64          `db:"cloud_computer_id"`
	RootRunID             *uint64         `db:"root_run_id"`
	Kind                  string          `db:"kind"`
	Status                string          `db:"status"`
	OperationToken        string          `db:"operation_token"`
	CommandReceiptID      *uint64         `db:"command_receipt_id"`
	PublicOperationID     *uint64         `db:"public_operation_id"`
	BackendGeneration     uint64          `db:"backend_generation"`
	RuntimeGeneration     uint64          `db:"runtime_generation"`
	StorageGeneration     uint64          `db:"storage_generation"`
	TargetEnvironment     json.RawMessage `db:"target_environment"`
	TargetTemplateVersion *uint64         `db:"target_template_version"`
	Intent                json.RawMessage `db:"intent"`
	Observation           json.RawMessage `db:"observation"`
	ActorKind             string          `db:"actor_kind"`
	ActorID               string          `db:"actor_id"`
	ExecutorEpoch         string          `db:"executor_epoch"`
	FenceVersion          uint64          `db:"fence_version"`
	ErrorCode             *string         `db:"error_code"`
	CreatedAt             time.Time       `db:"created_at"`
	StartedAt             *time.Time      `db:"started_at"`
	DeadlineAt            time.Time       `db:"deadline_at"`
	CancelRequestedAt     *time.Time      `db:"cancel_requested_at"`
	FinishedAt            *time.Time      `db:"finished_at"`
	UpdatedAt             time.Time       `db:"updated_at"`
}

type CloudRepository interface {
	Connection(bool) (*SandboxConnectionRow, error)
	SaveConnection(*SandboxConnectionRow) error
	CloudTemplate(*uint64, bool) (*CloudTemplateRow, error)
	InsertCloudTemplate(*CloudTemplateRow) error
	SaveCloudTemplate(*CloudTemplateRow) error
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
	ResetCloudResources(uint64, time.Time) error
	CloudTopology() (int, int, error)
	CloudResetSessions() ([]SessionRow, error)
	ComputerSessions(uint64) ([]SessionRow, error)
	CloudRootWorkPending(uint64) (bool, error)
	SkillState(uint64, uint64, bool) (*CloudSkillStateRow, error)
	SaveSkillState(*CloudSkillStateRow) error
	CloudExecution(uint64, bool) (*CloudExecutionRow, error)
	InsertCloudExecution(*CloudExecutionRow) error
	SaveCloudExecution(*CloudExecutionRow) error
	LeaseExecutions(uint64) ([]CloudExecutionRow, error)
	CloudOperation(uint64, bool) (*CloudOperationRow, error)
	InsertCloudOperation(*CloudOperationRow) error
	SaveCloudOperation(*CloudOperationRow) error
	ActiveCloudOperation(uint64) (*CloudOperationRow, error)
	LatestCloudOperation(uint64) (*CloudOperationRow, error)
	CloudOperationByToken(string, bool) (*CloudOperationRow, error)
	CloudOperationByPublic(uint64) (*CloudOperationRow, error)
	PendingCloudOperations(string, time.Time, int) ([]CloudOperationRow, error)
	PendingWorkspaceOperations(string, time.Time, int) ([]CloudOperationRow, error)
	HolderReferences(string, string, bool) ([]ResourceReferenceRow, error)
	ActiveResourceReferences(string, uint64) ([]ResourceReferenceRow, error)
}

type CloudActivity struct {
	Leases     int `db:"leases"`
	Transfers  int `db:"transfers"`
	Unknown    int `db:"unknown"`
	References int `db:"refs"`
	Operations int `db:"operations"`
}

func CloudStateFor(tx identity.Tx) (CloudRepository, error) {
	p, ok := tx.(interface{ CloudState() CloudRepository })
	if !ok {
		return nil, unavailable()
	}
	return p.CloudState(), nil
}
