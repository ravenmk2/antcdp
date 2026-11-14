// Package sandboxcore defines execution-environment contracts independently of
// platform identities, persistence and any provider SDK.
package sandboxcore

import (
	"context"
	"io"
	"time"
)

type Error struct {
	Code string
	// Unknown means a side effect may have occurred. It never authorizes replay.
	Unknown bool
}

// Connection is private runtime configuration. Never serialize credentials or
// expose this value through a diagnostic/public DTO.
type Connection struct {
	Endpoint   string
	AccessMode string
	APIKey     string `json:"-"`
	// ControlKey is installation-derived secret material used only for sandbox
	// daemon authentication. It is never persisted in provider or Run snapshots.
	ControlKey       []byte `json:"-"`
	ConnectTimeout   time.Duration
	OperationTimeout time.Duration
}

type Factory interface {
	Open(context.Context, Connection) (Provider, error)
}

func (e *Error) Error() string { return e.Code }

type Ownership struct {
	InstallationID string `json:"installation_id"`
	ComputerID     uint64 `json:"cloud_computer_id,string"`
	CreationToken  string `json:"creation_token"`
}

type ResourceRef struct {
	BackendGeneration uint64    `json:"backend_generation,string"`
	RemoteID          string    `json:"remote_id"`
	Ownership         Ownership `json:"ownership"`
}

type Environment struct {
	Image         string `json:"image"`
	CPUMillicores int    `json:"cpu_millicores"`
	MemoryMiB     int    `json:"memory_mib"`
}

type EffectiveConfig struct {
	RuntimeBackend string                `json:"runtime_backend"`
	Environment    Environment           `json:"environment"`
	Network        NetworkPolicySnapshot `json:"network"`
}

// MountPlan is a host-derived immutable fact, never a model/client-selected path.
type MountPlan struct {
	Kind            string `json:"kind"`       // ephemeral or named_volume
	MountPath       string `json:"mount_path"` // always /data
	VolumeID        string `json:"volume_id,omitempty"`
	VolumeName      string `json:"volume_name,omitempty"`
	CreateIfMissing bool   `json:"create_if_missing"` // first provision only
}

type CreateSpec struct {
	BackendGeneration uint64
	Ownership         Ownership
	Config            EffectiveConfig
	Network           NetworkCompilation
	Mount             MountPlan
	Lifetime          time.Duration // zero requests explicit manual cleanup
}

type Observation struct {
	Ref       ResourceRef
	State     string // starting, ready, unhealthy, terminated, absent, unknown
	ExpiresAt *time.Time
}

type ResourcePage struct {
	Items   []Observation
	HasMore bool
}

type ExecutionHandle struct {
	Resource ResourceRef `json:"resource"`
	ID       string      `json:"id"`
}

type ExecSpec struct {
	Command        string
	Argv           []string
	CWD            string
	UID            *uint32
	GID            *uint32
	Background     bool
	Timeout        time.Duration
	MaxOutputBytes int
}

type Output struct {
	Stream string // stdout or stderr
	Text   string
}

type ExecResult struct {
	Handle          *ExecutionHandle
	Running         bool
	ExitCode        *int32
	OutputTruncated bool
}

type ExecutionOutput struct {
	Text      string
	Cursor    int64 // byte offset into the remote combined background log
	Truncated bool
}

type ExecCallbacks struct {
	// Started must durably record the handle. Returning an error stops local
	// consumption; the remote command may still be active and must be reconciled.
	Started func(context.Context, ExecutionHandle) error
	Output  func(context.Context, Output) error
}

type FileRequest struct {
	Path     string
	UID      *uint32
	GID      *uint32
	MaxBytes int64
}

// Provider returns remote facts only. The host owns admission, claims, fences,
// ownership registration and cleanup decisions. Create never waits for readiness
// or silently deletes a resource on a later failure.
type Provider interface {
	Create(context.Context, CreateSpec) (Observation, error)
	Inspect(context.Context, ResourceRef) (Observation, error)
	Find(context.Context, Ownership, int, int) (ResourcePage, error)
	Terminate(context.Context, ResourceRef) error
	// Health with nil checks the control plane only; a resource additionally
	// checks the selected data-plane path without starting a command.
	Health(context.Context, *ResourceRef) error
	Exec(context.Context, ResourceRef, ExecSpec, ExecCallbacks) (ExecResult, error)
	InspectExecution(context.Context, ExecutionHandle) (ExecResult, error)
	ReadExecutionOutput(context.Context, ExecutionHandle, int64, int) (ExecutionOutput, error)
	CancelExecution(context.Context, ExecutionHandle) error
	FileTransport
}

// FileTransport is infrastructure for trusted helper/staging calls. It does not
// establish path authorization or symlink safety; model paths must go through
// the separately verified helper before these raw transport methods are used.
type FileTransport interface {
	OpenFile(context.Context, ResourceRef, FileRequest) (io.ReadCloser, error)
	PutFile(context.Context, ResourceRef, FileRequest, io.Reader) error
}

// Optional backend capabilities. Unsupported volume deletion must be reported;
// terminating an instance is never evidence that its retained volume is gone.
type LifecycleControl interface {
	Pause(context.Context, ResourceRef) error
	Resume(context.Context, ResourceRef) error
}
type VolumeRef struct {
	InstallationID string
	ComputerID     uint64
	ID, Name       string
}
type VolumeControl interface {
	VolumeExists(context.Context, VolumeRef) (bool, error)
	DeleteVolume(context.Context, VolumeRef) error
}
