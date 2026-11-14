package agentcore

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type ToolSpec struct {
	Key            string
	Definition     modelcore.Tool
	MCP            *MCPToolRef
	ExecutionClass string
	ParallelSafe   bool
	Policy         string
	ResultLimit    int
}
type PreparedStep struct {
	Ref              ExecutionRef
	Step             uint32
	Request          modelcore.Request
	Manifest         SurfaceManifest
	Tools            []ToolSpec
	MaxParallelTools int
}
type AttemptPermit struct {
	Ref      ExecutionRef
	CallID   ID
	Step     uint32
	Attempt  uint32
	Deadline time.Time
	Client   modelcore.Client
}
type AttemptOutcome struct {
	Response  modelcore.Response
	Err       error
	Cancelled bool
}
type PreparedToolCall struct {
	Ref         ExecutionRef
	ID          ID
	ModelCallID ID
	Step        uint32
	Ordinal     uint32
	Call        modelcore.ToolCall
	Spec        ToolSpec
}
type AttemptCommit struct {
	Receipt      CommitReceipt
	AssistantSeq Seq // assistant/message or assistant/attempt, never tool/call
	Response     modelcore.Response
	Calls        []PreparedToolCall
	Retry        bool
	RetryAfter   time.Duration
	// Failure is a durable failed attempt (for example output-limit rejection),
	// not a persistence failure. It forbids tool dispatch and another model step.
	Failure error
}
type ToolCompletion struct {
	Status    string
	Executed  *bool
	Content   string
	Truncated bool
	Reason    string
	Receipt   CommitReceipt
}

// EngineHooks is the persistence boundary for the single inference loop. A
// successful CompleteAttempt must commit the assistant and ALL tool intentions
// atomically. InvokeTool returns only a uniquely committed logical result.
type EngineHooks interface {
	PrepareStep(context.Context, ExecutionRef, uint32) (PreparedStep, error)
	BeginAttempt(context.Context, PreparedStep, uint32) (AttemptPermit, error)
	CompleteAttempt(context.Context, AttemptPermit, AttemptOutcome) (AttemptCommit, error)
	InvokeTool(context.Context, PreparedToolCall) (ToolCompletion, error)
	Emit(context.Context, AttemptPermit, modelcore.Delta) error
}
type AgentEngine interface {
	Execute(context.Context, ExecutionRef, EngineHooks) error
}

type ExecutionContext struct {
	Ref              ExecutionRef
	AgentID          ID
	Principal        PrincipalRef
	Authorization    Authorization
	ContentSessionID ID
	Policy           Policy
	Model            LockedModel
	Binding          *BindingRef
	Deadline         time.Time
}
type DispatchPermit struct {
	Call          PreparedToolCall
	Token         string
	Deadline      time.Time
	Authorization json.RawMessage
	ProjectID     ID
}
type DispatchObservation struct {
	Status             string
	Executed           *bool
	Content            string
	Reason             string
	ExecutionReference json.RawMessage
	// Metadata contains optional host-owned result facts. The persistence adapter
	// validates and explicitly projects supported fields; it must never forward
	// arbitrary dispatcher metadata into a public event.
	Metadata json.RawMessage
	// Present/child operations already commit their result atomically with
	// their domain facts. An ordinary dispatcher leaves Committed nil.
	Committed *CommitReceipt
}
type ToolDispatcher interface {
	Dispatch(context.Context, ExecutionContext, DispatchPermit) (DispatchObservation, error)
	Cancel(context.Context, ExecutionContext, PreparedToolCall) error
}

type ScanCursor struct{ After ID }
type Candidate struct {
	SessionID ID
	InputID   ID
}
type CandidatePage struct {
	Items []Candidate
	Next  *ScanCursor
}
type ClaimRequest struct {
	Candidate Candidate
	Epoch     string
}
type ClaimResult struct {
	Claimed   bool
	Execution ExecutionContext
	Receipt   CommitReceipt
}
type RunEnd struct {
	Status RunStatus
	Reason string
}
type ChildRequest struct {
	Parent    PreparedToolCall
	SessionID ID
	RunID     ID
	Content   []TextBlock
	Files     []FileRef
}
type ChildClaim struct {
	Created   bool
	Execution ExecutionContext
	Receipt   CommitReceipt
}
type ChildEnd struct {
	End         RunEnd
	Summary     string
	ArtifactIDs []ID
}
type ChildCommit struct {
	Receipt CommitReceipt
	Result  ToolCompletion
}

type RunStore interface {
	Candidates(context.Context, ScanCursor, int) (CandidatePage, error)
	ClaimRoot(context.Context, ClaimRequest) (ClaimResult, error)
	ActivateBinding(context.Context, ExecutionRef, BindingRef) (CommitReceipt, error)
	EndRoot(context.Context, ExecutionRef, RunEnd) (CommitReceipt, error)
	CreateChild(context.Context, ChildRequest) (ChildClaim, error)
	EndChild(context.Context, ExecutionRef, ChildEnd) (ChildCommit, error)
}

// WorkerStore records the actual local engine lifetime independently of the
// public run outcome. Cancellation can end a turn before a library returns.
type WorkerStore interface {
	WorkerStarted(context.Context, ExecutionRef) error
	WorkerStopped(context.Context, ExecutionRef) error
}
type StepBoundary struct {
	Ref      ExecutionRef
	Step     uint32
	InputIDs []ID
	Session  Session
	Manifest SurfaceManifest
}
type ContextUpdate struct {
	SurfaceRevision Version
	Events          []ContextFact
}
type ContextCommit struct {
	Receipt         CommitReceipt
	SurfaceRevision Version
}
type AttemptDraft struct {
	Step         PreparedStep
	Attempt      uint32
	Purpose      string
	CompactionID *ID
	RequestHash  string
	Deadline     time.Time
	Reservation  Budget
}
type AttemptRecord struct {
	Permit  AttemptPermit
	Receipt CommitReceipt
}
type AttemptResult struct {
	ReasoningDurationMS *int64
	Permit              AttemptPermit
	Outcome             AttemptOutcome
}
type StepStore interface {
	BeginStep(context.Context, ExecutionRef, uint32) (StepBoundary, error)
	CommitContext(context.Context, ExecutionRef, ContextUpdate) (ContextCommit, error)
	FreezeAttempt(context.Context, ExecutionRef, AttemptDraft) (AttemptRecord, error)
	CompleteAttempt(context.Context, ExecutionRef, AttemptResult) (AttemptCommit, error)
}
type DispatchAdmission struct {
	Kind          string // execute, await_interaction, await_result, already_completed, blocked
	Permit        DispatchPermit
	InteractionID *ID
	Completion    *ToolCompletion
}
type ToolResult struct {
	Call        PreparedToolCall
	Observation DispatchObservation
}
type ToolCommit struct {
	Receipt CommitReceipt
	Result  ToolCompletion
}
type ReconciliationEvidence struct {
	Ref            ExecutionRef
	CallID         ID
	ObservedStatus string
	Executed       *bool
	Reason         string
	ObservedAt     time.Time
}
type ToolStore interface {
	PrepareDispatch(context.Context, ExecutionRef, ID) (DispatchAdmission, error)
	CompleteTool(context.Context, ExecutionRef, ToolResult) (ToolCommit, error)
	LookupCompletion(context.Context, ID) (ToolCommit, error)
	RecordReconciliation(context.Context, ReconciliationEvidence) (CommitReceipt, error)
}

type RuntimeEventSink interface {
	Committed(context.Context, CommitReceipt)
}
type SkillEntry struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Integrity   string `json:"integrity"`
	Path        string `json:"path,omitempty"`
	VersionID   ID     `json:"skill_version_id,omitempty"`
}
type SkillDirectory struct {
	Entries  []SkillEntry
	Complete bool
}
type SkillLoad struct {
	SkillID       ID
	VersionID     ID
	ContentSHA256 string
	Text          string
	StablePath    string
	Materialized  bool
}
type SkillSource interface {
	Directory(context.Context, ExecutionContext) (SkillDirectory, error)
	Load(context.Context, ExecutionContext, string, string) (SkillLoad, error)
}
type Environment interface {
	Acquire(context.Context, ExecutionContext) (*BindingRef, error)
	CancelFamily(context.Context, ExecutionContext) error
	Reconcile(context.Context, ExecutionContext) error
}

// Recover closes logical executions and preserves unresolved physical holds.
// ConvergeDue also handles failed result commits in the CURRENT epoch.
type RecoveryStore interface {
	Recover(context.Context, string, int) (bool, error)
	ConvergeDue(context.Context, time.Time, int) ([]CommitReceipt, error)
}
type HistoryPage struct {
	SessionID ID
	Through   Seq
	Records   []Event
	Before    *Seq
	HasMore   bool
}
type HistoryReader interface {
	ReadWindow(context.Context, ID, Seq, *Seq, int, int) (HistoryPage, error)
	ReadAfter(context.Context, ID, Seq, int) ([]Event, error)
	LastSeq(context.Context, ID) (Seq, error)
}

// MCPToolRef is an immutable, credential-free runtime definition reference.
type MCPToolRef struct {
	ServerID     uint64          `json:"server_id,string"`
	BindingID    uint64          `json:"binding_id,string"`
	RemoteName   string          `json:"remote_name"`
	Fingerprint  string          `json:"definition_fingerprint"`
	Identity     json.RawMessage `json:"identity"`
	OutputSchema json.RawMessage `json:"output_schema"`
	Annotations  json.RawMessage `json:"annotations"`
}
