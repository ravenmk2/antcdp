package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// Persistence rows stay inside platform adapters. They are never API DTOs or
// agentcore contracts. Every mutation is enclosed by a semantic host transaction.
type SessionRow struct {
	ID                        uint64          `db:"id"`
	AgentID                   uint64          `db:"agent_id"`
	ExecutionMode             string          `db:"agent_type"`
	SessionKind               string          `db:"session_kind"`
	RootSessionID             *uint64         `db:"root_session_id"`
	ParentRunID               *uint64         `db:"parent_run_id"`
	ExecutorUserID            uint64          `db:"executor_user_id"`
	Title                     string          `db:"title"`
	ProjectContextID          *uint64         `db:"project_context_id"`
	CloudComputerID           *uint64         `db:"cloud_computer_id"`
	SelectedModelBindingID    uint64          `db:"selected_model_binding_id"`
	SelectedThinkingOptionKey string          `db:"selected_thinking_option_key"`
	LockedModelConfig         json.RawMessage `db:"locked_model_config"`
	ModelSelectionHash        []byte          `db:"model_selection_hash"`
	ModelLockedAt             *time.Time      `db:"model_locked_at"`
	QueuePaused               bool            `db:"queue_paused"`
	NextInputOrder            uint64          `db:"next_input_order"`
	LastSeq                   uint64          `db:"last_seq"`
	ProjectionSeq             uint64          `db:"projection_seq"`
	ActiveRunID               *uint64         `db:"active_run_id"`
	ActiveCompactionID        *uint64         `db:"active_compaction_id"`
	SurfaceRevision           uint64          `db:"surface_revision"`
	RowVersion                uint64          `db:"row_version"`
	CreatedByActorKind        string          `db:"created_by_actor_kind"`
	CreatedByActorID          string          `db:"created_by_actor_id"`
	CreatedAt                 time.Time       `db:"created_at"`
	UpdatedAt                 time.Time       `db:"updated_at"`
	LastActivityAt            time.Time       `db:"last_activity_at"`
	ArchivedAt                *time.Time      `db:"archived_at"`
	ArchivedByUserID          *uint64         `db:"archived_by_user_id"`
}
type InputRow struct {
	ID                    uint64     `db:"id"`
	SessionID             uint64     `db:"session_id"`
	CommandReceiptID      *uint64    `db:"command_receipt_id"`
	InputKind             string     `db:"input_kind"`
	OriginKind            string     `db:"origin_kind"`
	ActorKind             string     `db:"actor_kind"`
	ActorID               string     `db:"actor_id"`
	SourceKind            *string    `db:"source_kind"`
	SourceID              *string    `db:"source_id"`
	LastModifiedByKind    string     `db:"last_modified_by_kind"`
	LastModifiedByID      string     `db:"last_modified_by_id"`
	Status                string     `db:"status"`
	QueueOrder            uint64     `db:"queue_order"`
	ClaimedRunID          *uint64    `db:"claimed_run_id"`
	ClaimedStepNo         *uint64    `db:"claimed_step_no"`
	QuestionInteractionID *uint64    `db:"question_interaction_id"`
	PendingQuestionSlot   *uint64    `db:"pending_question_slot"`
	RetryOfRunID          *uint64    `db:"retry_of_run_id"`
	ContinuationSeq       *uint64    `db:"continuation_seq"`
	AcceptedSeq           uint64     `db:"accepted_seq"`
	CurrentContentSeq     uint64     `db:"current_content_seq"`
	MessageSeq            *uint64    `db:"message_seq"`
	ContentRevision       uint64     `db:"content_revision"`
	RowVersion            uint64     `db:"row_version"`
	CreatedAt             time.Time  `db:"created_at"`
	UpdatedAt             time.Time  `db:"updated_at"`
	QueueDeadlineAt       time.Time  `db:"queue_deadline_at"`
	ClaimedAt             *time.Time `db:"claimed_at"`
	EndedAt               *time.Time `db:"ended_at"`
	EndReason             *string    `db:"end_reason"`
}
type RunRow struct {
	ID                      uint64          `db:"id"`
	SessionID               uint64          `db:"session_id"`
	RootRunID               *uint64         `db:"root_run_id"`
	ParentRunID             *uint64         `db:"parent_run_id"`
	TriggerInputID          *uint64         `db:"trigger_input_id"`
	RetryOfRunID            *uint64         `db:"retry_of_run_id"`
	ExecutorUserID          uint64          `db:"executor_user_id"`
	OriginKind              string          `db:"origin_kind"`
	ActorKind               string          `db:"actor_kind"`
	ActorID                 string          `db:"actor_id"`
	SourceKind              *string         `db:"source_kind"`
	SourceID                *string         `db:"source_id"`
	Status                  string          `db:"status"`
	ActiveSlot              *uint64         `db:"active_slot"`
	AgentConfigVersion      uint64          `db:"agent_config_version"`
	ResourceConfigVersion   uint64          `db:"resource_config_version"`
	ExecutionPolicySnapshot json.RawMessage `db:"execution_policy_snapshot"`
	ModelSelectionHash      []byte          `db:"model_selection_hash"`
	BudgetLimit             json.RawMessage `db:"budget_limit"`
	BudgetReserved          json.RawMessage `db:"budget_reserved"`
	BudgetUsed              json.RawMessage `db:"budget_used"`
	BudgetRevision          uint64          `db:"budget_revision"`
	CurrentStepNo           uint64          `db:"current_step_no"`
	ExecutorEpoch           string          `db:"executor_epoch"`
	FenceVersion            uint64          `db:"fence_version"`
	StartedSeq              *uint64         `db:"started_seq"`
	EndedSeq                *uint64         `db:"ended_seq"`
	ContinuationSeq         *uint64         `db:"continuation_seq"`
	EndReason               *string         `db:"end_reason"`
	UsageCompleteness       string          `db:"usage_completeness"`
	CreatedAt               time.Time       `db:"created_at"`
	StartedAt               *time.Time      `db:"started_at"`
	DeadlineAt              time.Time       `db:"deadline_at"`
	StopRequestedAt         *time.Time      `db:"stop_requested_at"`
	StopActorKind           *string         `db:"stop_actor_kind"`
	StopActorID             *string         `db:"stop_actor_id"`
	StopDeadlineAt          *time.Time      `db:"stop_deadline_at"`
	FinishedAt              *time.Time      `db:"finished_at"`
	SettledAt               *time.Time      `db:"settled_at"`
	UpdatedAt               time.Time       `db:"updated_at"`
	ProjectionSeq           uint64          `db:"projection_seq"`
}
type EventRow struct {
	ID               uint64          `db:"id"`
	SessionID        uint64          `db:"session_id"`
	Seq              uint64          `db:"seq"`
	RunID            *uint64         `db:"run_id"`
	EventType        string          `db:"event_type"`
	SchemaVersion    uint64          `db:"schema_version"`
	SemanticKey      *string         `db:"semantic_key"`
	Payload          json.RawMessage `db:"payload"`
	PayloadSHA256    []byte          `db:"payload_sha256"`
	PayloadSizeBytes uint64          `db:"payload_size_bytes"`
	OccurredAt       time.Time       `db:"occurred_at"`
}
type ModelCallRow struct {
	ID                    uint64          `db:"id"`
	SessionID             uint64          `db:"session_id"`
	RunID                 *uint64         `db:"run_id"`
	RootRunID             *uint64         `db:"root_run_id"`
	CompactionID          *uint64         `db:"compaction_id"`
	StepNo                uint64          `db:"step_no"`
	AttemptNo             uint64          `db:"attempt_no"`
	Purpose               string          `db:"purpose"`
	GenerationSlot        *uint64         `db:"generation_slot"`
	Status                string          `db:"status"`
	ProviderID            uint64          `db:"provider_id"`
	ModelDefinitionID     uint64          `db:"model_definition_id"`
	Protocol              string          `db:"protocol"`
	RequestedModelID      string          `db:"requested_model_id"`
	ResponseModelID       *string         `db:"response_model_id"`
	Thinking              json.RawMessage `db:"thinking"`
	RequestConfig         json.RawMessage `db:"request_config"`
	SurfaceManifest       json.RawMessage `db:"surface_manifest"`
	RequestHash           []byte          `db:"request_hash"`
	CapabilitySnapshot    json.RawMessage `db:"capability_snapshot"`
	BudgetReservation     json.RawMessage `db:"budget_reservation"`
	BudgetSettlement      json.RawMessage `db:"budget_settlement"`
	ProviderRequestID     *string         `db:"provider_request_id"`
	ExecutorEpoch         string          `db:"executor_epoch"`
	FenceVersion          uint64          `db:"fence_version"`
	ResponseEventSeq      *uint64         `db:"response_event_seq"`
	InputTokens           *uint64         `db:"input_tokens"`
	OutputTokens          *uint64         `db:"output_tokens"`
	CacheReadTokens       *uint64         `db:"cache_read_tokens"`
	CacheWriteTokens      *uint64         `db:"cache_write_tokens"`
	UsageRaw              json.RawMessage `db:"usage_raw"`
	UsageSemanticsVersion *string         `db:"usage_semantics_version"`
	UsageCompleteness     string          `db:"usage_completeness"`
	EstimatedCost         *string         `db:"estimated_cost"`
	CostCurrency          *string         `db:"cost_currency"`
	PricingSnapshot       json.RawMessage `db:"pricing_snapshot"`
	ErrorCode             *string         `db:"error_code"`
	CreatedAt             time.Time       `db:"created_at"`
	StartedAt             *time.Time      `db:"started_at"`
	DeadlineAt            time.Time       `db:"deadline_at"`
	FinishedAt            *time.Time      `db:"finished_at"`
}
type ToolCallRow struct {
	ID                     uint64          `db:"id"`
	SessionID              uint64          `db:"session_id"`
	RunID                  uint64          `db:"run_id"`
	RootRunID              uint64          `db:"root_run_id"`
	ModelCallID            uint64          `db:"model_call_id"`
	StepNo                 uint64          `db:"step_no"`
	CallOrdinal            uint64          `db:"call_ordinal"`
	ProviderCallID         string          `db:"provider_call_id"`
	ToolKey                string          `db:"tool_key"`
	ToolBindingID          *uint64         `db:"tool_binding_id"`
	MCPBindingID           *uint64         `db:"mcp_binding_id"`
	MCPServerID            *uint64         `db:"mcp_server_id"`
	MCPToolName            *string         `db:"mcp_tool_name"`
	SkillVersionID         *uint64         `db:"skill_version_id"`
	ExecutionClass         string          `db:"execution_class"`
	Status                 string          `db:"status"`
	ArgumentsEventSeq      uint64          `db:"arguments_event_seq"`
	ArgumentsHash          []byte          `db:"arguments_hash"`
	ToolDefinitionSnapshot json.RawMessage `db:"tool_definition_snapshot"`
	BudgetReservation      json.RawMessage `db:"budget_reservation"`
	BudgetSettlement       json.RawMessage `db:"budget_settlement"`
	AuthorizationSnapshot  json.RawMessage `db:"authorization_snapshot"`
	AgentConfigVersion     uint64          `db:"agent_config_version"`
	ResourceConfigVersion  uint64          `db:"resource_config_version"`
	InteractionID          *uint64         `db:"interaction_id"`
	DispatchToken          *string         `db:"dispatch_token"`
	ExecutionRef           json.RawMessage `db:"execution_ref"`
	RemoteIdentityRef      json.RawMessage `db:"remote_identity_ref"`
	ExecutorEpoch          string          `db:"executor_epoch"`
	FenceVersion           uint64          `db:"fence_version"`
	ResultEventSeq         *uint64         `db:"result_event_seq"`
	ErrorCode              *string         `db:"error_code"`
	Executed               *bool           `db:"executed"`
	ReconciledOutcome      *string         `db:"reconciled_outcome"`
	LastReconciledSeq      *uint64         `db:"last_reconciled_seq"`
	CreatedAt              time.Time       `db:"created_at"`
	DeadlineAt             time.Time       `db:"deadline_at"`
	DispatchStartedAt      *time.Time      `db:"dispatch_started_at"`
	StartedAt              *time.Time      `db:"started_at"`
	FinishedAt             *time.Time      `db:"finished_at"`
	UpdatedAt              time.Time       `db:"updated_at"`
}
type InteractionRow struct {
	ID                  uint64          `db:"id"`
	SessionID           uint64          `db:"session_id"`
	RunID               uint64          `db:"run_id"`
	OriginChildRunID    *uint64         `db:"origin_child_run_id"`
	ToolCallID          uint64          `db:"tool_call_id"`
	Kind                string          `db:"kind"`
	Status              string          `db:"status"`
	RequestEventSeq     uint64          `db:"request_event_seq"`
	RequestHash         []byte          `db:"request_hash"`
	Specification       json.RawMessage `db:"specification"`
	WaitDeadlineAt      time.Time       `db:"wait_deadline_at"`
	PendingReplyInputID *uint64         `db:"pending_reply_input_id"`
	AnswerEventSeq      *uint64         `db:"answer_event_seq"`
	DecidedByKind       *string         `db:"decided_by_kind"`
	DecidedByID         *string         `db:"decided_by_id"`
	DecidedAt           *time.Time      `db:"decided_at"`
	ApprovalConsumedAt  *time.Time      `db:"approval_consumed_at"`
	ContinueReason      *string         `db:"continue_reason"`
	RowVersion          uint64          `db:"row_version"`
	CreatedAt           time.Time       `db:"created_at"`
	UpdatedAt           time.Time       `db:"updated_at"`
	ProjectionSeq       uint64          `db:"projection_seq"`
}
type CompactionRow struct {
	ID                    uint64          `db:"id"`
	SessionID             uint64          `db:"session_id"`
	RunID                 *uint64         `db:"run_id"`
	CommandReceiptID      *uint64         `db:"command_receipt_id"`
	PublicOperationID     *uint64         `db:"public_operation_id"`
	Status                string          `db:"status"`
	FromSeq               uint64          `db:"from_seq"`
	ThroughSeq            uint64          `db:"through_seq"`
	SourceSurfaceRevision uint64          `db:"source_surface_revision"`
	SourceManifest        json.RawMessage `db:"source_manifest"`
	SourceHash            []byte          `db:"source_hash"`
	StartEventSeq         uint64          `db:"start_event_seq"`
	SummaryEventSeq       *uint64         `db:"summary_event_seq"`
	EndEventSeq           *uint64         `db:"end_event_seq"`
	ExecutorEpoch         string          `db:"executor_epoch"`
	FenceVersion          uint64          `db:"fence_version"`
	ErrorCode             *string         `db:"error_code"`
	CreatedAt             time.Time       `db:"created_at"`
	DeadlineAt            time.Time       `db:"deadline_at"`
	FinishedAt            *time.Time      `db:"finished_at"`
}
type FileRow struct {
	ID                  uint64          `db:"id"`
	Purpose             string          `db:"purpose"`
	ContentDomain       string          `db:"content_domain"`
	ContentSessionID    *uint64         `db:"content_session_id"`
	OwnerUserID         *uint64         `db:"owner_user_id"`
	AgentID             *uint64         `db:"agent_id"`
	StorageKey          string          `db:"storage_key"`
	WriterToken         string          `db:"writer_token"`
	State               string          `db:"state"`
	IntegrityState      string          `db:"integrity_state"`
	SizeBytes           *uint64         `db:"size_bytes"`
	SHA256              []byte          `db:"sha256"`
	MediaType           string          `db:"media_type"`
	MediaProperties     json.RawMessage `db:"media_properties"`
	UploadedByUserID    *uint64         `db:"uploaded_by_user_id"`
	CreatedByToolCallID *uint64         `db:"created_by_tool_call_id"`
	UploadOperationID   *uint64         `db:"upload_operation_id"`
	CreatedAt           time.Time       `db:"created_at"`
	UpdatedAt           time.Time       `db:"updated_at"`
	ExpiresAt           *time.Time      `db:"expires_at"`
	BoundAt             *time.Time      `db:"bound_at"`
	OrphanedAt          *time.Time      `db:"orphaned_at"`
	IntegrityCheckedAt  *time.Time      `db:"integrity_checked_at"`
	DeletedAt           *time.Time      `db:"deleted_at"`
	ErrorCode           *string         `db:"error_code"`
}
type AttachmentRow struct {
	ID               uint64     `db:"id"`
	ContentSessionID uint64     `db:"content_session_id"`
	FileID           uint64     `db:"file_id"`
	UploadedByUserID uint64     `db:"uploaded_by_user_id"`
	Filename         string     `db:"filename"`
	State            string     `db:"state"`
	BoundInputID     *uint64    `db:"bound_input_id"`
	CommandReceiptID uint64     `db:"command_receipt_id"`
	RowVersion       uint64     `db:"row_version"`
	CreatedAt        time.Time  `db:"created_at"`
	ExpiresAt        *time.Time `db:"expires_at"`
	BoundAt          *time.Time `db:"bound_at"`
	DeletedAt        *time.Time `db:"deleted_at"`
}
type ArtifactRow struct {
	ID               uint64          `db:"id"`
	ContentSessionID uint64          `db:"content_session_id"`
	RunID            uint64          `db:"run_id"`
	ToolCallID       uint64          `db:"tool_call_id"`
	OutputOrdinal    uint64          `db:"output_ordinal"`
	FileID           uint64          `db:"file_id"`
	Filename         string          `db:"filename"`
	Description      string          `db:"description"`
	SourcePath       string          `db:"source_path"`
	SourceSnapshot   json.RawMessage `db:"source_snapshot"`
	RetainedEventSeq uint64          `db:"retained_event_seq"`
	RowVersion       uint64          `db:"row_version"`
	CreatedAt        time.Time       `db:"created_at"`
	DeletedAt        *time.Time      `db:"deleted_at"`
	DeletedByUserID  *uint64         `db:"deleted_by_user_id"`
	DeletedEventSeq  *uint64         `db:"deleted_event_seq"`
}
type FileOperationRow struct {
	ID                  uint64          `db:"id"`
	ToolCallID          uint64          `db:"tool_call_id"`
	ContentSessionID    uint64          `db:"content_session_id"`
	RootRunID           uint64          `db:"root_run_id"`
	Kind                string          `db:"kind"`
	OperationToken      string          `db:"operation_token"`
	Status              string          `db:"status"`
	BindingID           uint64          `db:"binding_id"`
	ComputerID          uint64          `db:"cloud_computer_id"`
	BindingFenceVersion uint64          `db:"binding_fence_version"`
	BackendGeneration   uint64          `db:"backend_generation"`
	RuntimeGeneration   uint64          `db:"runtime_generation"`
	StorageGeneration   uint64          `db:"storage_generation"`
	VolumeID            string          `db:"volume_id"`
	ExecutorEpoch       string          `db:"executor_epoch"`
	FenceVersion        uint64          `db:"fence_version"`
	RequestHash         []byte          `db:"request_hash"`
	Result              json.RawMessage `db:"result"`
	CommitReceipt       json.RawMessage `db:"commit_receipt"`
	CommittedFromSeq    *uint64         `db:"committed_from_seq"`
	CommittedThroughSeq *uint64         `db:"committed_through_seq"`
	ErrorCode           *string         `db:"error_code"`
	CreatedAt           time.Time       `db:"created_at"`
	DeadlineAt          time.Time       `db:"deadline_at"`
	FinishedAt          *time.Time      `db:"finished_at"`
	UpdatedAt           time.Time       `db:"updated_at"`
}
type FileOperationItemRow struct {
	OperationID       uint64     `db:"operation_id"`
	Ordinal           uint64     `db:"ordinal"`
	SourceKind        string     `db:"source_kind"`
	SourceReferenceID *uint64    `db:"source_reference_id"`
	SourceFileID      *uint64    `db:"source_file_id"`
	SourcePath        *string    `db:"source_path"`
	DestinationPath   *string    `db:"destination_path"`
	PublicationToken  string     `db:"publication_token"`
	ExpectedSHA256    []byte     `db:"expected_sha256"`
	ObservedSHA256    []byte     `db:"observed_sha256"`
	ObservedSizeBytes *uint64    `db:"observed_size_bytes"`
	StagedFileID      *uint64    `db:"staged_file_id"`
	ArtifactID        *uint64    `db:"artifact_id"`
	State             string     `db:"state"`
	VerifiedAt        *time.Time `db:"verified_at"`
	PublishedAt       *time.Time `db:"published_at"`
	ErrorCode         *string    `db:"error_code"`
}
type ResourceReferenceRow struct {
	ID              uint64          `db:"id"`
	HolderKind      string          `db:"holder_kind"`
	HolderID        string          `db:"holder_id"`
	ResourceKind    string          `db:"resource_kind"`
	ResourceID      uint64          `db:"resource_id"`
	State           string          `db:"state"`
	ExecutorEpoch   string          `db:"executor_epoch"`
	FenceVersion    uint64          `db:"fence_version"`
	CreatedAt       time.Time       `db:"created_at"`
	UpdatedAt       time.Time       `db:"updated_at"`
	LastVerifiedAt  *time.Time      `db:"last_verified_at"`
	ReleasedAt      *time.Time      `db:"released_at"`
	ReleaseReason   *string         `db:"release_reason"`
	ReleaseEvidence json.RawMessage `db:"release_evidence"`
}
type StateRepository interface {
	PendingCompactions(string, time.Time, int) ([]CompactionRow, error)
	CompactionModelCall(uint64) (*ModelCallRow, error)
	FileCleanupCandidates(time.Time, int) ([]FileRow, error)
	FileHasBindings(uint64) (bool, error)
	OldDownloadReferences(string, int) ([]ResourceReferenceRow, error)
	Attachments(uint64, uint64, AttachmentQuery) ([]AttachmentRow, int, error)
	AttachmentsForFile(uint64) ([]AttachmentRow, error)
	ArtifactsForFile(uint64) ([]ArtifactRow, error)
	Artifacts(uint64, *uint64, ArtifactQuery) ([]ArtifactRow, int, error)
	FileActiveReferences(uint64) (int, error)
	RecoverableRoots(string, int) ([]RunRow, error)
	DueRoots(time.Time, int) ([]RunRow, error)
	DueInputs(time.Time, int) ([]InputRow, error)
	DueInteractions(time.Time, int) ([]InteractionRow, error)
	FileByHash(uint64, []byte) (*FileRow, error)
	SurfaceEvents(uint64, uint64, uint64, int) ([]EventRow, error)
	AttemptForStep(uint64, uint64, uint64) (*ModelCallRow, error)
	RunModelCalls(uint64) ([]ModelCallRow, error)
	PendingCandidates(uint64, int) ([]PendingCandidate, error)
	ActiveRoots(uint64) (int, error)
	RunTools(uint64) ([]ToolCallRow, error)
	FamilyRuns(uint64) ([]RunRow, error)
	PublicOperation(uint64, bool) (*PublicOperationRow, error)
	InsertPublicOperation(*PublicOperationRow) error
	SavePublicOperation(*PublicOperationRow) error
	InputFiles(uint64) ([]InputFileRow, error)
	ReplaceInputFiles(uint64, []InputFileRow) error
	Sessions(uint64, SessionQuery) ([]SessionSummary, int, error)
	Preference(uint64, uint64, bool) (*PreferenceRow, error)
	SavePin(*PreferenceRow) error
	AdvanceView(*PreferenceRow) error
	SessionCounts(uint64) (SessionCounts, error)
	LatestResult(uint64) (*RunResultRef, error)
	UnviewedResults(uint64, uint64) (int, error)
	ResultAt(uint64, uint64) (*RunResultRef, error)
	Inputs(uint64, InputQuery) ([]InputRow, int, error)
	SessionInteractions(uint64) ([]InteractionRow, error)
	Events(uint64, uint64, uint64, int, bool) ([]EventRow, error)
	EventAt(uint64, uint64) (*EventRow, error)
	Session(uint64, bool) (*SessionRow, error)
	InsertSession(*SessionRow) error
	SaveSession(*SessionRow) error
	Input(uint64, bool) (*InputRow, error)
	InsertInput(*InputRow) error
	SaveInput(*InputRow) error
	Run(uint64, bool) (*RunRow, error)
	UnsettledRoots(int) ([]RunRow, error)
	RootPhysicalPending(uint64) (bool, error)
	RunContext(uint64) (*RunContextRow, error)
	InsertRunContext(*RunContextRow) error
	PrepareMCPManifest(uint64, json.RawMessage, time.Time) error
	InsertRun(*RunRow) error
	SaveRun(*RunRow) error
	Event(uint64, bool) (*EventRow, error)
	InsertEvent(*EventRow) error
	ModelCall(uint64, bool) (*ModelCallRow, error)
	InsertModelCall(*ModelCallRow) error
	SaveModelCall(*ModelCallRow) error
	ToolCall(uint64, bool) (*ToolCallRow, error)
	InsertToolCall(*ToolCallRow) error
	SaveToolCall(*ToolCallRow) error
	Interaction(uint64, bool) (*InteractionRow, error)
	InsertInteraction(*InteractionRow) error
	SaveInteraction(*InteractionRow) error
	Compaction(uint64, bool) (*CompactionRow, error)
	InsertCompaction(*CompactionRow) error
	SaveCompaction(*CompactionRow) error
	File(uint64, bool) (*FileRow, error)
	InsertFile(*FileRow) error
	SaveFile(*FileRow) error
	Attachment(uint64, bool) (*AttachmentRow, error)
	InsertAttachment(*AttachmentRow) error
	SaveAttachment(*AttachmentRow) error
	Artifact(uint64, bool) (*ArtifactRow, error)
	InsertArtifact(*ArtifactRow) error
	SaveArtifact(*ArtifactRow) error
	FileOperation(uint64, bool) (*FileOperationRow, error)
	FileOperationByTool(uint64, bool) (*FileOperationRow, error)
	FileOperationItems(uint64, bool) ([]FileOperationItemRow, error)
	PendingFileOperations(string, time.Time, int) ([]FileOperationRow, error)
	RootInputFileSelected(uint64, string, uint64) (bool, error)
	InsertFileOperation(*FileOperationRow) error
	SaveFileOperation(*FileOperationRow) error
	FileOperationItem(uint64, uint64, bool) (*FileOperationItemRow, error)
	InsertFileOperationItem(*FileOperationItemRow) error
	SaveFileOperationItem(*FileOperationItemRow) error
	ResourceReference(uint64, bool) (*ResourceReferenceRow, error)
	InsertResourceReference(*ResourceReferenceRow) error
	SaveResourceReference(*ResourceReferenceRow) error
	WorkerReference(uint64, bool) (*ResourceReferenceRow, error)
	ReleaseOldWorkers(string, time.Time) error
	ReleaseRootSkills(uint64, time.Time) error
}

func StateFor(tx identity.Tx) (StateRepository, error) {
	p, ok := tx.(interface{ AgentState() StateRepository })
	if !ok {
		return nil, unavailable()
	}
	return p.AgentState(), nil
}

type PublicOperationRow struct {
	ID                      uint64          `db:"id"`
	CommandReceiptID        uint64          `db:"command_receipt_id"`
	Kind                    string          `db:"kind"`
	SubjectKind             string          `db:"subject_kind"`
	SubjectID               *uint64         `db:"subject_id"`
	ContentDomain           string          `db:"content_domain"`
	ContentSessionID        *uint64         `db:"content_session_id"`
	OwnerUserID             *uint64         `db:"owner_user_id"`
	AgentID                 *uint64         `db:"agent_id"`
	Status                  string          `db:"status"`
	ConfigSnapshot          json.RawMessage `db:"config_snapshot"`
	Result                  json.RawMessage `db:"result"`
	StagedFileID            *uint64         `db:"staged_file_id"`
	PublishedSkillVersionID *uint64         `db:"published_skill_version_id"`
	ErrorCode               *string         `db:"error_code"`
	ActorUserID             uint64          `db:"actor_user_id"`
	ExecutorEpoch           *string         `db:"executor_epoch"`
	FenceVersion            uint64          `db:"fence_version"`
	CreatedAt               time.Time       `db:"created_at"`
	StartedAt               *time.Time      `db:"started_at"`
	DeadlineAt              time.Time       `db:"deadline_at"`
	FinishedAt              *time.Time      `db:"finished_at"`
	ExpiresAt               *time.Time      `db:"expires_at"`
	UpdatedAt               time.Time       `db:"updated_at"`
}
