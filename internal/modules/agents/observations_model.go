package agents

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type ObservationQuery struct {
	Page, PageSize int
	Status, Kind   string
}
type SequenceRange struct {
	From    uint64 `db:"from_seq"`
	Through uint64 `db:"through_seq"`
}
type RunCounts struct {
	ModelCalls       uint64 `db:"model_calls"`
	ToolCalls        uint64 `db:"tool_calls"`
	UnknownTools     uint64 `db:"unknown_tools"`
	ActiveTools      uint64 `db:"active_tools"`
	PendingTransfers uint64 `db:"pending_transfers"`
}
type ObservationRepository interface {
	HistoryGroups(uint64, uint64, uint64) ([]SequenceRange, error)
	RunPage(uint64, bool, ObservationQuery) ([]RunRow, int, error)
	ToolPage(uint64, ObservationQuery) ([]ToolCallRow, int, error)
	InteractionPage(uint64, ObservationQuery) ([]InteractionRow, int, error)
	RunCounts(uint64) (RunCounts, error)
}

func observationsFor(tx identity.Tx) (ObservationRepository, error) {
	p, ok := tx.(interface{ AgentObservations() ObservationRepository })
	if !ok {
		return nil, unavailable()
	}
	return p.AgentObservations(), nil
}

type RunSummary struct {
	ID                uint64     `json:"id,string"`
	SessionID         uint64     `json:"session_id,string"`
	RootRunID         uint64     `json:"root_run_id,string"`
	ParentRunID       *uint64    `json:"parent_run_id,string"`
	TriggerInputID    *uint64    `json:"trigger_input_id,string"`
	Status            string     `json:"status"`
	Reason            *string    `json:"reason_code"`
	StartedAt         *time.Time `json:"started_at"`
	FinishedAt        *time.Time `json:"finished_at"`
	SettledAt         *time.Time `json:"settled_at"`
	Deadline          time.Time  `json:"deadline_at"`
	Steps             uint64     `json:"step_count"`
	ModelCalls        uint64     `json:"model_call_count"`
	ToolCalls         uint64     `json:"tool_call_count"`
	UsageCompleteness string     `json:"usage_completeness"`
}
type RunDetail struct {
	RunSummary
	Origin    string                 `json:"origin_kind"`
	Actor     agentcore.ActorRef     `json:"actor_ref"`
	Source    *agentcore.SourceRef   `json:"source_ref"`
	Principal agentcore.PrincipalRef `json:"principal"`
	LastSeq   uint64                 `json:"last_event_seq,string"`
	EndSeq    *uint64                `json:"end_seq,string"`
	Budget    json.RawMessage        `json:"budget_usage"`
	Binding   any                    `json:"binding"`
	Physical  PhysicalActivity       `json:"physical_activity"`
}
type PhysicalActivity struct {
	State     string `json:"state"`
	Unknown   uint64 `json:"unknown_execution_count"`
	Transfers uint64 `json:"pending_transfer_count"`
}
type ChildRunSummary struct {
	ID          uint64     `json:"id,string"`
	SessionID   uint64     `json:"session_id,string"`
	RootRunID   uint64     `json:"root_run_id,string"`
	ParentRunID *uint64    `json:"parent_run_id,string"`
	Status      string     `json:"status"`
	Reason      *string    `json:"reason_code"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	Summary     *string    `json:"result_summary"`
}
type ApprovalAction struct {
	ToolKey   string          `json:"tool_key"`
	Summary   string          `json:"summary"`
	Arguments json.RawMessage `json:"arguments"`
	Hash      string          `json:"arguments_hash"`
}
type InteractionView struct {
	ID           uint64                    `json:"id,string"`
	SessionID    uint64                    `json:"session_id,string"`
	RunID        uint64                    `json:"run_id,string"`
	ToolCallID   uint64                    `json:"tool_call_id,string"`
	Kind         string                    `json:"kind"`
	Version      string                    `json:"version"`
	CreatedAt    time.Time                 `json:"created_at"`
	ExpiresAt    time.Time                 `json:"expires_at"`
	UpdatedAt    time.Time                 `json:"updated_at"`
	AnsweredBy   *agentcore.ActorRef       `json:"answered_by"`
	Status       string                    `json:"status"`
	Questions    []agentcore.Question      `json:"questions,omitempty"`
	PendingReply *uint64                   `json:"pending_reply_input_id,string,omitempty"`
	Answer       *agentcore.QuestionAnswer `json:"answer,omitempty"`
	Action       *ApprovalAction           `json:"action,omitempty"`
	Decision     *string                   `json:"decision,omitempty"`
}

// MarshalJSON emits the exact kind-specific nullable fields without leaking
// request hashes, authorization snapshots or internal specification variants.
func (v InteractionView) MarshalJSON() ([]byte, error) {
	type plain InteractionView
	raw, e := json.Marshal(plain(v))
	if e != nil {
		return nil, e
	}
	var m map[string]any
	if e = json.Unmarshal(raw, &m); e != nil {
		return nil, e
	}
	if v.Kind == "question" {
		m["questions"] = v.Questions
		m["pending_reply_input_id"] = nil
		if v.PendingReply != nil {
			m["pending_reply_input_id"] = agentcore.ID(*v.PendingReply)
		}
		m["answer"] = v.Answer
	} else {
		m["action"] = v.Action
		m["decision"] = v.Decision
	}
	return json.Marshal(m)
}

type InputSummary struct {
	ID       uint64             `json:"id,string"`
	Kind     string             `json:"kind"`
	Delivery string             `json:"delivery"`
	Preview  string             `json:"preview"`
	Actor    agentcore.ActorRef `json:"actor_ref"`
	Deadline time.Time          `json:"queue_deadline_at"`
	Version  string             `json:"version"`
}
type SnapshotState struct {
	Conversation          ConversationProjection `json:"conversation"`
	Configuration         SessionConfiguration   `json:"configuration"`
	Selection             EffectiveSelection     `json:"selection"`
	Permissions           Permissions            `json:"permissions"`
	View                  *ViewState             `json:"view_state"`
	RunID                 *uint64                `json:"run_id,string"`
	RunStatus             *string                `json:"run_status"`
	QueuePaused           bool                   `json:"queue_paused"`
	Inputs                []InputSummary         `json:"inputs"`
	InputTotal            int                    `json:"input_total"`
	InputsTruncated       bool                   `json:"inputs_truncated"`
	Interactions          []InteractionView      `json:"interactions"`
	InteractionTotal      int                    `json:"interaction_total"`
	InteractionsTruncated bool                   `json:"interactions_truncated"`
}
type ObservationSnapshot struct {
	SessionID uint64          `json:"session_id,string"`
	Through   uint64          `json:"through_seq,string"`
	State     SnapshotState   `json:"state"`
	Records   []DurableRecord `json:"records"`
	Before    *uint64         `json:"before_seq,string"`
	HasMore   bool            `json:"has_more"`
}
