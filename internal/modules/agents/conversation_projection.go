package agents

import (
	"crypto/sha256"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

const conversationProjectionVersion = 3

// ConversationProjection contains display facts only. It grants no permission
// and cannot replace the execution rows that own leases and side effects.
type ConversationProjection struct {
	Version    int              `json:"version"`
	Through    agentcore.Seq    `json:"through_seq"`
	Title      string           `json:"title"`
	Runs       uint64           `json:"run_count"`
	ModelCalls uint64           `json:"model_call_count"`
	ToolCalls  uint64           `json:"tool_call_count"`
	LatestRun  *ConversationRun `json:"latest_run"`
}

type ConversationRun struct {
	ID         agentcore.ID `json:"id"`
	Status     string       `json:"status"`
	Step       uint64       `json:"step"`
	EndedSteps uint64       `json:"completed_steps"`
	Settled    bool         `json:"settled"`
	ModelCalls uint64       `json:"model_call_count"`
	ToolCalls  uint64       `json:"tool_call_count"`
	Todos      []TodoItem   `json:"todos"`
}

type ConversationProjectionRow struct {
	SessionID uint64          `db:"session_id"`
	Version   int             `db:"projection_version"`
	Through   uint64          `db:"through_seq"`
	Payload   json.RawMessage `db:"payload"`
	Hash      []byte          `db:"payload_sha256"`
	UpdatedAt time.Time       `db:"updated_at"`
}

type SessionTitleRow struct {
	SessionID   uint64    `db:"session_id"`
	Source      string    `db:"source"`
	SourceSeq   uint64    `db:"source_event_seq"`
	Status      string    `db:"status"`
	ModelCallID *uint64   `db:"model_call_id"`
	Epoch       string    `db:"executor_epoch"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}

// Separate from the runtime port so read-only and in-memory hosts can replay
// events without acquiring a persistent cache or a title worker.
type ConversationRepository interface {
	ConversationProjection(uint64) (*ConversationProjectionRow, error)
	SaveConversationProjection(*ConversationProjectionRow) error
	SessionTitle(uint64, bool) (*SessionTitleRow, error)
	SaveSessionTitle(*SessionTitleRow) error
	PendingSessionTitles(int) ([]SessionTitleRow, error)
}

// FoldConversation is deterministic and never reads current configuration.
func FoldConversation(state ConversationProjection, record DurableRecord) (ConversationProjection, error) {
	if record.SchemaVersion != 1 || uint64(record.Seq) != uint64(state.Through)+1 {
		return state, integrity()
	}
	var data struct {
		Configuration struct {
			Title string `json:"title"`
		} `json:"configuration"`
		RunID  agentcore.ID `json:"run_id"`
		Status string       `json:"status"`
		Step   uint64       `json:"step_no"`
		Todos  []TodoItem   `json:"todos"`
	}
	encoded, err := json.Marshal(record.Data)
	if err != nil || json.Unmarshal(encoded, &data) != nil {
		return state, integrity()
	}
	state.Version = conversationProjectionVersion
	state.Through = record.Seq
	if state.LatestRun != nil {
		run := *state.LatestRun
		state.LatestRun = &run
	}
	switch record.Type {
	case "session/configured", "session/title":
		state.Title = data.Configuration.Title
	case "run/started":
		state.Runs++
		state.LatestRun = &ConversationRun{ID: data.RunID, Status: "running", Todos: []TodoItem{}}
	case "run/state", "run/ended":
		if state.LatestRun != nil && state.LatestRun.ID == data.RunID {
			state.LatestRun.Status = data.Status
			if record.Type == "run/ended" {
				state.LatestRun.EndedSteps = state.LatestRun.Step
			}
		}
	case "step/started", "step/ended":
		if state.LatestRun != nil && state.LatestRun.ID == data.RunID {
			state.LatestRun.Step = max(state.LatestRun.Step, data.Step)
			if record.Type == "step/ended" {
				state.LatestRun.EndedSteps = max(state.LatestRun.EndedSteps, data.Step)
			}
		}
	case "run/settled":
		if state.LatestRun != nil && state.LatestRun.ID == data.RunID {
			state.LatestRun.Settled = true
		}
	case "assistant/message", "assistant/attempt":
		state.ModelCalls++
		if state.LatestRun != nil && record.RunID != nil && uint64(state.LatestRun.ID) == *record.RunID {
			state.LatestRun.Step = max(state.LatestRun.Step, data.Step)
			state.LatestRun.ModelCalls++
		}
	case "tool/call":
		state.ToolCalls++
		if state.LatestRun != nil && record.RunID != nil && uint64(state.LatestRun.ID) == *record.RunID {
			state.LatestRun.ToolCalls++
		}
	case "todo/write":
		if state.LatestRun != nil && record.RunID != nil && *record.RunID == uint64(state.LatestRun.ID) {
			state.LatestRun.Todos = data.Todos
		}

	}
	return state, nil
}

func loadConversationProjection(st StateRepository, session uint64, through uint64) (ConversationProjection, error) {
	state := ConversationProjection{Version: conversationProjectionVersion}
	if repo, ok := st.(ConversationRepository); ok {
		row, err := repo.ConversationProjection(session)
		if err != nil {
			return state, err
		}
		if row != nil && row.Version == conversationProjectionVersion && row.Through <= through {
			canonical, err := agentcore.CanonicalJSON(row.Payload)
			hash := sha256.Sum256(canonical)
			var cached ConversationProjection
			if err == nil && string(hash[:]) == string(row.Hash) && json.Unmarshal(canonical, &cached) == nil && uint64(cached.Through) == row.Through && cached.Version == row.Version {
				state = cached
			}
		}
	}
	for uint64(state.Through) < through {
		rows, err := st.Events(session, uint64(state.Through), through, 500, false)
		if err != nil {
			return state, err
		}
		if len(rows) == 0 {
			return state, integrity()
		}
		for _, row := range rows {
			record, err := projectEvent(row)
			if err != nil {
				return state, err
			}
			state, err = FoldConversation(state, record)
			if err != nil {
				return state, err
			}
		}
	}
	return state, nil
}

func checkpointConversation(st StateRepository, row EventRow) error {
	repo, ok := st.(ConversationRepository)
	if !ok {
		return nil
	}
	state, err := loadConversationProjection(st, row.SessionID, row.Seq)
	if err != nil {
		return err
	}
	payload, err := agentcore.CanonicalJSON(state)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(payload)
	return repo.SaveConversationProjection(&ConversationProjectionRow{SessionID: row.SessionID, Version: conversationProjectionVersion, Through: row.Seq, Payload: payload, Hash: hash[:], UpdatedAt: row.OccurredAt})
}
