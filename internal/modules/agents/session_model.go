package agents

import (
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

type ModelSelection struct {
	BindingID string `json:"model_binding_id"`
	Thinking  string `json:"thinking_option_key"`
}
type SessionCreate struct {
	AgentID   string          `json:"agent_id"`
	Title     Field[string]   `json:"title"`
	ProjectID Field[string]   `json:"project_context_id"`
	Selection *ModelSelection `json:"model_selection"`
}
type SessionPatch struct {
	Title     Field[string]         `json:"title"`
	ProjectID Field[string]         `json:"project_context_id"`
	Selection Field[ModelSelection] `json:"model_selection"`
}
type SessionConfiguration struct {
	ID            uint64         `json:"id,string"`
	AgentID       uint64         `json:"agent_id,string"`
	Mode          string         `json:"agent_type"`
	Title         string         `json:"title"`
	ProjectID     *uint64        `json:"project_context_id,string"`
	Selection     ModelSelection `json:"model_selection"`
	ModelLockedAt *time.Time     `json:"model_locked_at"`
	ArchivedAt    *time.Time     `json:"archived_at"`
	Version       string         `json:"version"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}
type SessionQuery struct {
	Page, PageSize               int
	Q, Mode, Archived, Attention string
	AgentID                      uint64
}
type SessionSummary struct {
	Attention       SessionAttention `db:"-" json:"attention"`
	ID              uint64           `db:"id" json:"id,string"`
	AgentID         uint64           `db:"agent_id" json:"agent_id,string"`
	Mode            string           `db:"agent_type" json:"agent_type"`
	Title           string           `db:"title" json:"title"`
	ArchivedAt      *time.Time       `db:"archived_at" json:"archived_at"`
	Pinned          bool             `db:"pinned" json:"pinned"`
	LastActivityAt  time.Time        `db:"last_activity_at" json:"last_activity_at"`
	ActiveRunStatus *string          `db:"active_run_status" json:"active_run_status"`
}
type Permissions struct {
	Read    bool `json:"read"`
	Submit  bool `json:"submit"`
	Answer  bool `json:"answer"`
	Control bool `json:"control"`
	Manage  bool `json:"manage"`
	Approve bool `json:"approve"`
}
type WorkspaceState struct {
	BindingID    *uint64 `json:"binding_id,string"`
	ComputerID   *uint64 `json:"cloud_computer_id,string"`
	CWD          string  `json:"cwd"`
	Availability string  `json:"availability"`
}
type SessionState struct {
	LastSeq                 uint64         `json:"last_seq,string"`
	ActiveRunID             *uint64        `json:"active_run_id,string"`
	ActiveRunStatus         *string        `json:"active_run_status"`
	QueuePaused             bool           `json:"queue_paused"`
	PendingInputCount       int            `json:"pending_input_count"`
	PendingInteractionCount int            `json:"pending_interaction_count"`
	LastActivityAt          time.Time      `json:"last_activity_at"`
	ScopeKind               string         `json:"scope_kind"`
	AgentAccessAvailable    bool           `json:"agent_access_available"`
	ProjectContextAvailable bool           `json:"project_context_available"`
	Workspace               WorkspaceState `json:"workspace"`
}
type SessionPreference struct {
	Pinned  bool   `json:"pinned"`
	Version string `json:"version"`
}
type PreferencePatch struct {
	Pinned Field[bool] `json:"pinned"`
}
type PreferenceRow struct {
	UserID           uint64     `db:"user_id"`
	SessionID        uint64     `db:"session_id"`
	Pinned           bool       `db:"pinned"`
	PinnedAt         *time.Time `db:"pinned_at"`
	ViewedThroughSeq uint64     `db:"viewed_through_seq"`
	ViewedAt         *time.Time `db:"viewed_at"`
	RowVersion       uint64     `db:"row_version"`
	CreatedAt        time.Time  `db:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at"`
}
type RunResultRef struct {
	ID         uint64    `db:"id" json:"run_id,string"`
	Status     string    `db:"status" json:"status"`
	Reason     *string   `db:"end_reason" json:"reason_code"`
	FinishedAt time.Time `db:"finished_at" json:"finished_at"`
	EndSeq     uint64    `db:"ended_seq" json:"end_seq,string"`
}
type ViewState struct {
	SessionID        uint64        `json:"session_id,string"`
	ViewedThroughSeq uint64        `json:"viewed_through_seq,string"`
	ViewedAt         *time.Time    `json:"viewed_at"`
	LatestResult     *RunResultRef `json:"latest_result"`
	UnviewedCount    int           `json:"unviewed_run_count"`
	HasUnviewed      bool          `json:"has_unviewed_result"`
}
type ViewStateWrite struct {
	ThroughSeq string `json:"through_seq"`
}
type SessionDetail struct {
	Configuration SessionConfiguration   `json:"configuration"`
	Principal     agentcore.PrincipalRef `json:"principal"`
	RootSessionID *uint64                `json:"root_session_id,string"`
	Selection     EffectiveSelection     `json:"selection"`
	State         SessionState           `json:"state"`
	Permissions   Permissions            `json:"permissions"`
	Preference    SessionPreference      `json:"preference"`
	ViewState     *ViewState             `json:"view_state"`
}
type SessionCounts struct {
	Inputs       int
	Interactions int
}
type InputCreate struct {
	Content      []agentcore.TextBlock `json:"content"`
	ExpectedHash string                `json:"expected_model_selection_hash"`
	Files        []agentcore.FileRef   `json:"file_refs"`
}
type InputEdit struct {
	Content Field[[]agentcore.TextBlock]    `json:"content"`
	Files   Field[[]agentcore.FileRef]      `json:"file_refs"`
	Answer  Field[agentcore.QuestionAnswer] `json:"question_answer"`
}
type InputAccepted struct {
	InputID     uint64  `json:"input_id,string"`
	RunID       *uint64 `json:"run_id,string"`
	Delivery    string  `json:"delivery"`
	QueuePaused bool    `json:"queue_paused"`
	AcceptedSeq uint64  `json:"accepted_seq,string"`
}
type ApprovalReply struct {
	InteractionID uint64 `json:"interaction_id,string"`
	Decision      string `json:"decision"`
}

type InputView struct {
	QuestionContext *QuestionReplyContext     `json:"question_context,omitempty"`
	Approval        *ApprovalReply            `json:"approval_reply,omitempty"`
	ID              uint64                    `json:"id,string"`
	SessionID       uint64                    `json:"session_id,string"`
	Kind            string                    `json:"kind"`
	Content         []agentcore.TextBlock     `json:"content"`
	Files           []agentcore.FileRef       `json:"file_refs"`
	Answer          *agentcore.QuestionAnswer `json:"question_answer"`
	Origin          string                    `json:"origin_kind"`
	Actor           agentcore.ActorRef        `json:"actor_ref"`
	Source          *agentcore.SourceRef      `json:"source_ref"`
	Delivery        string                    `json:"delivery"`
	State           string                    `json:"state"`
	Position        uint64                    `json:"position,string"`
	QueueDeadline   time.Time                 `json:"queue_deadline_at"`
	ClaimedRunID    *uint64                   `json:"claimed_run_id,string"`
	AcceptedSeq     uint64                    `json:"accepted_seq,string"`
	Revision        uint64                    `json:"revision,string"`
	Version         string                    `json:"version"`
	CreatedAt       time.Time                 `json:"created_at"`
	UpdatedAt       time.Time                 `json:"updated_at"`
	ModifiedBy      *agentcore.ActorRef       `json:"last_modified_by"`
}
type QuestionReplyContext struct {
	ToolCallID agentcore.ID         `json:"tool_call_id"`
	Questions  []agentcore.Question `json:"questions"`
}
type InputQuery struct {
	Page, PageSize int
	State          string
}
type HistoryQuery struct {
	Through, Before *uint64
	Limit           int
}
type DurableRecord struct {
	Seq           agentcore.Seq `json:"seq"`
	Type          string        `json:"event_type"`
	SchemaVersion int           `json:"schema_version"`
	OccurredAt    time.Time     `json:"occurred_at"`
	RunID         *uint64       `json:"run_id,string"`
	Data          any           `json:"data"`
}
type HistoryPage struct {
	SessionID uint64          `json:"session_id,string"`
	Through   uint64          `json:"through_seq,string"`
	Records   []DurableRecord `json:"records"`
	Before    *uint64         `json:"before_seq,string"`
	HasMore   bool            `json:"has_more"`
}
