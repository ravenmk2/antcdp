package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/models"
)

type CloudQuery struct {
	Page, PageSize           int
	OwnerUserID, PoolRobotID uint64
	State                    string
}

type ConnectionView struct {
	Configured        bool                  `json:"configured"`
	Type              string                `json:"type"`
	Endpoint          *string               `json:"endpoint"`
	AccessMode        string                `json:"access_mode"`
	ConnectTimeout    int                   `json:"connect_timeout_seconds"`
	OperationTimeout  int                   `json:"operation_timeout_seconds"`
	Authentication    models.Authentication `json:"authentication"`
	BackendGeneration uint64                `json:"backend_generation,string"`
	MaintenanceState  string                `json:"maintenance_state"`
	Capabilities      SandboxCapabilities   `json:"capabilities"`
	LastDiagnostic    json.RawMessage       `json:"last_diagnostic"`
	LastDiagnosticAt  *time.Time            `json:"last_diagnostic_at"`
}

type CloudEnvironment struct {
	Image   string        `json:"image"`
	CPU     int           `json:"cpu_millicores"`
	Memory  int           `json:"memory_mib"`
	Network NetworkPolicy `json:"network"`
}

type CloudView struct {
	TerminalSessions       int                 `json:"terminal_sessions"`
	ID                     uint64              `json:"id,string"`
	OwnerUserID            uint64              `json:"owner_user_id,string"`
	AllocationKind         string              `json:"allocation_kind"`
	State                  string              `json:"state"`
	BackendGeneration      uint64              `json:"backend_generation,string"`
	InstanceID             uint64              `json:"sandbox_instance_id,string"`
	StorageGeneration      uint64              `json:"storage_generation,string"`
	Environment            json.RawMessage     `json:"effective_environment"`
	AppliedSpecID          *uint64             `json:"applied_spec_id,string"`
	AppliedSpecVersion     *uint64             `json:"applied_spec_version,string"`
	AppliedTemplateVersion *uint64             `json:"applied_template_version,string"`
	VolumeState            string              `json:"volume_state"`
	RuntimeID              *string             `json:"runtime_id"`
	VolumeID               *string             `json:"volume_id"`
	VolumeName             *string             `json:"volume_name"`
	VolumeCleanupState     string              `json:"volume_cleanup_state"`
	Capabilities           SandboxCapabilities `json:"capabilities"`
	ActiveLeases           int                 `json:"active_leases"`
	PendingTransfers       int                 `json:"pending_transfers"`
	UnknownExecutions      int                 `json:"unknown_executions"`
	LatestOperationID      *uint64             `json:"latest_operation_id,string"`
	IdleSince              time.Time           `json:"idle_since"`
	LastActivityAt         time.Time           `json:"last_activity_at"`
	ErrorCode              *string             `json:"error_code"`
	Version                string              `json:"version"`
}
