// Package sandboxcore defines execution-environment contracts independently of
// platform identities, persistence and any provider SDK.
package sandboxcore

import (
	"context"
	"io"
	"time"

	"github.com/ravenmk2/antcdp/internal/diagnostic"
)

type Error struct {
	Code   string
	Detail *diagnostic.Detail
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
func (e *Error) Diagnostic() *diagnostic.Detail {
	d := diagnostic.Copy(e.Detail)
	if d == nil {
		d = &diagnostic.Detail{}
	}
	d.Code = e.Code
	d.Source = "sandbox"
	return diagnostic.Copy(d)
}

type Ownership struct {
	InstallationID string `json:"installation_id"`
	InstanceID     uint64 `json:"sandbox_instance_id,string"`
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
	MountPath       string `json:"mount_path"` // consumer-selected absolute mount path
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
	Stdout, Stderr string
	Cursor         int64 // retained UTF-8 byte offset across both channels
	Truncated      bool  // another page is available, or the preview was shortened
	Incomplete     bool  // source bytes were lost
	Pending        bool  // stream reader is still draining output
}

// PreviewCursor requests the bounded head and tail of each output stream.
const PreviewCursor int64 = -1

type ExecCallbacks struct {
	// Started must durably record the handle. Returning an error stops local
	// consumption; the remote command may still be active and must be reconciled.
	Started func(context.Context, ExecutionHandle) error
	// Output receives synchronous foreground frames. Background readers use ReadExecutionOutput.
	Output func(context.Context, Output) error
	// Finished is called once after a managed background stream drains or fails,
	// independently of the context that received the launch acknowledgement.
	Finished func(context.Context, ExecResult, error)
}

type FileRequest struct {
	Path string
	// Offset/Length select a byte range for reading. Zero Length reads to EOF.
	Offset   int64
	Length   int64
	Mode     int
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

// FileTransport streams provider-native file contents. The caller authorizes
// resource ownership and paths; this contract makes no symlink confinement claim.
type FileTransport interface {
	OpenFile(context.Context, ResourceRef, FileRequest) (io.ReadCloser, error)
	PutFile(context.Context, ResourceRef, FileRequest, io.Reader) error
}

// FileStream preserves the download metadata needed to forward a single range
// without reading the complete file. ContentLength is -1 when unknown.
type FileStream struct {
	Reader        io.ReadCloser
	ContentLength int64
	ContentRange  string
	StatusCode    int
}

type FileStreamer interface {
	StreamFile(context.Context, ResourceRef, FileRequest, string) (*FileStream, error)
}

// Optional backend capabilities. Unsupported volume deletion must be reported;
// terminating an instance is never evidence that its retained volume is gone.
type LifecycleControl interface {
	Pause(context.Context, ResourceRef) error
	Resume(context.Context, ResourceRef) error
}
type VolumeRef struct {
	InstallationID string
	InstanceID     uint64
	ID, Name       string
}
type VolumeControl interface {
	VolumeExists(context.Context, VolumeRef) (bool, error)
	DeleteVolume(context.Context, VolumeRef) error
}
