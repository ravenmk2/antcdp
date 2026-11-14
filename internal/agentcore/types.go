// Package agentcore owns agent lifecycle rules and contracts independently of
// transport, SQL, platform identity and the inference framework.
package agentcore

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type ID uint64
type Seq uint64
type Version uint64

func marshalNumber(v uint64) ([]byte, error) { return json.Marshal(strconv.FormatUint(v, 10)) }
func parseNumber(b []byte) (uint64, error) {
	var s string
	if json.Unmarshal(b, &s) != nil {
		return 0, invalid("id")
	}
	v, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(v, 10) != s {
		return 0, invalid("id")
	}
	return v, nil
}
func (v ID) MarshalJSON() ([]byte, error)      { return marshalNumber(uint64(v)) }
func (v Seq) MarshalJSON() ([]byte, error)     { return marshalNumber(uint64(v)) }
func (v Version) MarshalJSON() ([]byte, error) { return marshalNumber(uint64(v)) }
func (v *ID) UnmarshalJSON(b []byte) error {
	n, e := parseNumber(b)
	if e == nil {
		*v = ID(n)
	}
	return e
}
func (v *Seq) UnmarshalJSON(b []byte) error {
	n, e := parseNumber(b)
	if e == nil {
		*v = Seq(n)
	}
	return e
}
func (v *Version) UnmarshalJSON(b []byte) error {
	n, e := parseNumber(b)
	if e == nil {
		*v = Version(n)
	}
	return e
}

type Error struct{ Code, Field string }

func (e *Error) Error() string   { return e.Code }
func reject(code string) error   { return &Error{Code: code} }
func invalid(field string) error { return &Error{Code: "VALIDATION_FAILED", Field: field} }

type ActorRef struct {
	Kind string `json:"kind"`
	ID   *ID    `json:"id"`
}
type PrincipalRef struct {
	Kind string `json:"kind"`
	ID   ID     `json:"id"`
}
type SourceRef struct {
	Kind        string `json:"kind"`
	ID          ID     `json:"id"`
	BoundarySeq *Seq   `json:"boundary_seq,omitempty"`
}
type FileRef struct {
	Kind string `json:"kind"`
	ID   ID     `json:"id"`
}
type TextBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// ContentBlock is a UI projection only; it never reconstructs native history.
type ContentBlock struct {
	DurationMS *int64 `json:"duration_ms,omitempty"`
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	Kind       string `json:"kind,omitempty"`
	ID         *ID    `json:"id,omitempty"`
	ToolCallID *ID    `json:"tool_call_id,omitempty"`
}

type Policy struct {
	MaxSteps               uint32 `json:"max_steps"`
	MaxModelCalls          uint64 `json:"max_model_calls"`
	MaxToolCalls           uint64 `json:"max_tool_calls"`
	MaxChildren            uint64 `json:"max_children"`
	MaxParallelTools       int    `json:"max_parallel_tools"`
	RunTimeoutSeconds      int    `json:"run_timeout_seconds"`
	QueueTimeoutSeconds    int    `json:"queue_timeout_seconds"`
	QuestionTimeoutSeconds int    `json:"question_timeout_seconds"`
	ApprovalTimeoutSeconds int    `json:"approval_timeout_seconds"`
	MaxInputTokens         uint64 `json:"max_input_tokens"`
	MaxOutputTokens        uint64 `json:"max_output_tokens"`
	ApprovalPolicy         string `json:"approval_policy"`
}

type LockedModel struct {
	SchemaVersion   int                        `json:"schema_version"`
	ProviderID      ID                         `json:"provider_id"`
	DefinitionID    ID                         `json:"model_definition_id"`
	BindingID       ID                         `json:"binding_id"`
	ProviderType    modelcore.ProviderType     `json:"provider_type"`
	Protocol        modelcore.Protocol         `json:"protocol"`
	RemoteModelID   string                     `json:"remote_model_id"`
	ThinkingKey     string                     `json:"thinking_option_key"`
	Parameters      map[string]json.RawMessage `json:"parameters"`
	Connection      json.RawMessage            `json:"connection"` // typed, non-secret host snapshot
	Capabilities    modelcore.Capabilities     `json:"capabilities"`
	ContextWindow   uint64                     `json:"context_window"`
	MaxOutputTokens uint64                     `json:"max_output_tokens"`
	SelectionHash   string                     `json:"selection_hash"`
}

type Session struct {
	ID                 ID           `json:"id"`
	AgentID            ID           `json:"agent_id"`
	RootSessionID      *ID          `json:"root_session_id"`
	Principal          PrincipalRef `json:"principal"`
	ExecutionMode      string       `json:"agent_type"`
	Title              string       `json:"title"`
	ProjectID          *ID          `json:"project_id"`
	Model              *LockedModel `json:"model"`
	ModelLockedAt      *time.Time   `json:"model_locked_at"`
	ArchivedAt         *time.Time   `json:"archived_at"`
	QueuePaused        bool         `json:"queue_paused"`
	ActiveRunID        *ID          `json:"active_run_id"`
	ActiveCompactionID *ID          `json:"active_compaction_id"`
	NextInputOrder     uint64       `json:"next_input_order"`
	LastSeq            Seq          `json:"last_seq"`
	SurfaceRevision    Version      `json:"surface_revision"`
	Version            Version      `json:"version"`
}

type Input struct {
	ID            ID              `json:"id"`
	SessionID     ID              `json:"session_id"`
	Kind          string          `json:"kind"`
	Origin        string          `json:"origin_kind"`
	Actor         ActorRef        `json:"actor_ref"`
	Source        *SourceRef      `json:"source_ref"`
	ModifiedBy    *ActorRef       `json:"last_modified_by"`
	Content       []TextBlock     `json:"content"`
	Files         []FileRef       `json:"file_refs"`
	Answer        *QuestionAnswer `json:"question_answer"`
	Delivery      string          `json:"delivery"`
	State         string          `json:"state"`
	Position      uint64          `json:"position"`
	ClaimedRunID  *ID             `json:"claimed_run_id"`
	AcceptedSeq   Seq             `json:"accepted_seq"`
	MessageSeq    *Seq            `json:"message_seq"`
	Revision      Version         `json:"revision"`
	Version       Version         `json:"version"`
	QueueDeadline time.Time       `json:"queue_deadline_at"`
}

type RunStatus string

const (
	Preparing    RunStatus = "preparing"
	Running      RunStatus = "running"
	WaitingInput RunStatus = "waiting_input"
	Stopping     RunStatus = "stopping"
	Succeeded    RunStatus = "succeeded"
	Failed       RunStatus = "failed"
	Cancelled    RunStatus = "cancelled"
	Interrupted  RunStatus = "interrupted"
)

func (s RunStatus) Terminal() bool {
	return s == Succeeded || s == WaitingInput || s == Failed || s == Cancelled || s == Interrupted
}
func (s RunStatus) Active() bool {
	return s == Preparing || s == Running || s == Stopping
}

type ExecutionRef struct {
	SessionID ID
	RunID     ID
	RootRunID ID
	Epoch     string
	Fence     uint64
}
type BindingRef struct {
	ID                ID     `json:"id"`
	ComputerID        ID     `json:"cloud_computer_id"`
	BackendGeneration uint64 `json:"backend_generation"`
	RuntimeGeneration uint64 `json:"runtime_generation"`
	StorageGeneration uint64 `json:"storage_generation"`
	Fence             uint64 `json:"fence"`
	CWD               string `json:"cwd"`
}
type Run struct {
	Ref            ExecutionRef
	ParentRunID    *ID
	TriggerInputID ID
	Principal      PrincipalRef
	Status         RunStatus
	Policy         Policy
	Step           uint32
	Deadline       time.Time
	StopDeadline   *time.Time
	Binding        *BindingRef
	EndedSeq       *Seq
	Reason         string
	Budget         BudgetLedger
}

type Event struct {
	SessionID     ID              `json:"-"`
	Seq           Seq             `json:"seq"`
	Type          string          `json:"event_type"`
	SchemaVersion int             `json:"schema_version"`
	OccurredAt    time.Time       `json:"occurred_at"`
	RunID         *ID             `json:"run_id"`
	SemanticKey   string          `json:"-"`
	Data          json.RawMessage `json:"data"`
}

const MaxEventBytes = 256 << 10
const MaxHistoryBytes = 1 << 20

func NewEvent(session ID, seq Seq, run *ID, kind, key string, value any, now time.Time) (Event, error) {
	b, err := json.Marshal(value)
	if err != nil {
		return Event{}, fmt.Errorf("encode event: %w", err)
	}
	if len(b) > MaxEventBytes {
		return Event{}, reject("OUTPUT_LIMIT_EXCEEDED")
	}
	return Event{SessionID: session, Seq: seq, Type: kind, SchemaVersion: 1, OccurredAt: now.UTC().Truncate(time.Millisecond), RunID: run, SemanticKey: key, Data: b}, nil
}

type EventRange struct {
	SessionID     ID
	From, Through Seq
}
type CommitReceipt struct {
	Ranges              []EventRange
	ToolCallID          ID
	ContentSessionID    ID
	ArtifactIDs         []ID
	ToolResultSessionID ID
	ToolResultSeq       Seq
}

func (r CommitReceipt) ValidateTool(call ID, session ID) error {
	if r.ToolCallID != call || r.ToolResultSessionID != session || r.ToolResultSeq == 0 {
		return reject("COMMIT_RECEIPT_INVALID")
	}
	for _, v := range r.Ranges {
		if v.SessionID == session && v.From > 0 && v.From <= r.ToolResultSeq && r.ToolResultSeq <= v.Through {
			return nil
		}
	}
	return reject("COMMIT_RECEIPT_INVALID")
}
