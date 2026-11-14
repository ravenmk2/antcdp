package agentcore

import (
	"strings"
	"time"
	"unicode/utf8"
)

type QuestionOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Recommended *bool  `json:"recommended,omitempty"`
}
type Question struct {
	ID        string           `json:"question_id"`
	Prompt    string           `json:"prompt"`
	Type      string           `json:"type"`
	Options   []QuestionOption `json:"options"`
	AllowText bool             `json:"allow_text"`
}
type AnswerItem struct {
	QuestionID string   `json:"question_id"`
	OptionIDs  []string `json:"option_ids"`
	Text       *string  `json:"text"`
}
type QuestionAnswer struct {
	Skip    bool         `json:"skip"`
	Answers []AnswerItem `json:"answers"`
}
type Interaction struct {
	ID                  ID
	SessionID           ID
	RunID               ID
	ToolCallID          ID
	Kind                string
	Status              string
	Version             Version
	Deadline            time.Time
	Questions           []Question
	Answer              *QuestionAnswer
	AnsweredBy          *ActorRef
	PendingReplyInputID *ID
	ArgumentsHash       string
	ApprovalConsumedAt  *time.Time
}
type InteractionPlan struct {
	Interaction Interaction
	Delivery    string
	SettleTool  bool
	ToolStatus  string
	Executed    *bool
	Reason      string
}

func ValidateQuestions(questions []Question) error {
	if len(questions) < 1 || len(questions) > 3 {
		return invalid("questions")
	}
	seen := map[string]bool{}
	for _, q := range questions {
		if !asciiID(q.ID, 64) || seen[q.ID] || strings.TrimSpace(q.Prompt) == "" || utf8.RuneCountInString(q.Prompt) > 2000 || len(q.Options) > 8 {
			return invalid("questions")
		}
		seen[q.ID] = true
		if q.Type != "single_choice" && q.Type != "multi_choice" && q.Type != "text" {
			return invalid("question_type")
		}
		if q.Type == "text" && len(q.Options) != 0 {
			return invalid("options")
		}
		options := map[string]bool{}
		recommended := 0
		for _, o := range q.Options {
			if !asciiID(o.ID, 64) || options[o.ID] || strings.TrimSpace(o.Label) == "" || utf8.RuneCountInString(o.Label) > 80 || utf8.RuneCountInString(o.Description) > 200 {
				return invalid("options")
			}
			options[o.ID] = true
			if o.Recommended != nil && *o.Recommended {
				recommended++
			}
		}
		if q.Type == "single_choice" && recommended > 1 {
			return invalid("recommended")
		}
	}
	return nil
}
func asciiID(value string, max int) bool {
	if len(value) < 1 || len(value) > max {
		return false
	}
	for _, c := range value {
		if c < 33 || c > 126 {
			return false
		}
	}
	return true
}
func ValidateAnswer(questions []Question, answer QuestionAnswer) error {
	if err := ValidateQuestions(questions); err != nil {
		return err
	}
	if answer.Skip {
		if len(answer.Answers) != 0 {
			return invalid("answers")
		}
		return nil
	}
	if len(answer.Answers) != len(questions) {
		return invalid("answers")
	}
	byID := map[string]Question{}
	for _, q := range questions {
		byID[q.ID] = q
	}
	seen := map[string]bool{}
	for _, a := range answer.Answers {
		q, ok := byID[a.QuestionID]
		if !ok || seen[a.QuestionID] {
			return invalid("question_id")
		}
		seen[a.QuestionID] = true
		if q.Type == "single_choice" && len(a.OptionIDs) > 1 || q.Type == "text" && len(a.OptionIDs) != 0 {
			return invalid("option_ids")
		}
		valid := map[string]bool{}
		for _, o := range q.Options {
			valid[o.ID] = true
		}
		picked := map[string]bool{}
		for _, id := range a.OptionIDs {
			if !valid[id] || picked[id] {
				return invalid("option_ids")
			}
			picked[id] = true
		}
		text := ""
		if a.Text != nil {
			text = *a.Text
			if utf8.RuneCountInString(text) > 4000 || q.Type != "text" && !q.AllowText {
				return invalid("text")
			}
		}
		if len(a.OptionIDs) == 0 && strings.TrimSpace(text) == "" {
			return invalid("answers")
		}
	}
	return nil
}

// PlanAnswer is called under Session + interaction locks. Late replies require
// an atomically inserted inbox row and the database's cross-actor unique slot.
func PlanAnswer(session Session, interaction Interaction, expected Version, actor ActorRef, answer QuestionAnswer, replyInputID ID, now time.Time) (InteractionPlan, error) {
	if session.RootSessionID != nil {
		return InteractionPlan{}, reject("CHILD_SESSION_READ_ONLY")
	}
	if session.ArchivedAt != nil {
		return InteractionPlan{}, reject("SESSION_ARCHIVED")
	}
	if interaction.SessionID != session.ID || interaction.Kind != "question" {
		return InteractionPlan{}, reject("NOT_FOUND")
	}
	if interaction.Status == "answered" || interaction.Status == "reply_queued" {
		return InteractionPlan{}, reject("INTERACTION_ALREADY_ANSWERED")
	}
	if interaction.Status != "waiting" && interaction.Status != "continued" {
		return InteractionPlan{}, reject("INTERACTION_CLOSED")
	}
	if interaction.Version != expected {
		return InteractionPlan{}, reject("PRECONDITION_FAILED")
	}
	if err := ValidateAnswer(interaction.Questions, answer); err != nil {
		return InteractionPlan{}, err
	}
	interaction.Answer = &answer
	interaction.AnsweredBy = &actor
	interaction.Version++
	if interaction.Status == "waiting" && now.Before(interaction.Deadline) && session.ActiveRunID != nil && *session.ActiveRunID == interaction.RunID {
		interaction.Status = "answered"
		interaction.PendingReplyInputID = nil
		return InteractionPlan{Interaction: interaction, Delivery: "tool_result", SettleTool: true, ToolStatus: "succeeded"}, nil
	}
	if replyInputID == 0 {
		return InteractionPlan{}, invalid("reply_input_id")
	}
	// If the timer has not run yet this command also settles the original tool
	// as pending. A late answer never overwrites an already committed result.
	settle := interaction.Status == "waiting"
	interaction.Status = "reply_queued"
	interaction.PendingReplyInputID = &replyInputID
	delivery := "next_turn"
	if session.ActiveRunID != nil && !session.QueuePaused {
		delivery = "next_step"
	}
	return InteractionPlan{Interaction: interaction, Delivery: delivery, SettleTool: settle, ToolStatus: "succeeded", Reason: "question_pending"}, nil
}

func PlanDecision(session Session, interaction Interaction, expected Version, actor ActorRef, approve bool, now time.Time) (InteractionPlan, error) {
	if session.ExecutionMode != "interactive" {
		return InteractionPlan{}, reject("APPROVAL_NOT_ALLOWED")
	}
	if session.ArchivedAt != nil {
		return InteractionPlan{}, reject("SESSION_ARCHIVED")
	}
	if session.RootSessionID != nil {
		return InteractionPlan{}, reject("CHILD_SESSION_READ_ONLY")
	}
	if interaction.SessionID != session.ID || interaction.Kind != "approval" {
		return InteractionPlan{}, reject("NOT_FOUND")
	}
	if interaction.Status == "expired" || interaction.Status == "pending" && !now.Before(interaction.Deadline) {
		return InteractionPlan{}, reject("APPROVAL_EXPIRED")
	}
	if interaction.Status != "pending" {
		return InteractionPlan{}, reject("INTERACTION_CLOSED")
	}
	if expected != interaction.Version {
		return InteractionPlan{}, reject("PRECONDITION_FAILED")
	}
	interaction.Version++
	interaction.AnsweredBy = &actor
	interaction.Status = "rejected"
	if approve {
		interaction.Status = "approved_once"
	}
	executed := false
	return InteractionPlan{Interaction: interaction, SettleTool: !approve, ToolStatus: "blocked", Executed: &executed, Reason: "approval_rejected"}, nil
}

func PlanInteractionExpiry(i Interaction, now time.Time) (InteractionPlan, error) {
	if now.Before(i.Deadline) {
		return InteractionPlan{}, reject("NOT_DUE")
	}
	if i.Kind == "approval" && i.Status == "pending" {
		i.Status = "expired"
		i.Version++
		no := false
		return InteractionPlan{Interaction: i, SettleTool: true, ToolStatus: "blocked", Executed: &no, Reason: "APPROVAL_EXPIRED"}, nil
	}
	if i.Kind == "question" && i.Status == "waiting" {
		i.Status = "continued"
		i.Version++
		return InteractionPlan{Interaction: i, SettleTool: true, ToolStatus: "succeeded", Reason: "question_pending"}, nil
	}
	return InteractionPlan{Interaction: i}, nil
}

func CancelPendingReply(session Session, i Interaction, input ID, explicit bool) Interaction {
	if i.Kind != "question" || i.Status != "reply_queued" || i.PendingReplyInputID == nil || *i.PendingReplyInputID != input {
		return i
	}
	i.PendingReplyInputID = nil
	i.Status = "continued"
	i.Answer = nil
	if explicit || session.ArchivedAt != nil {
		i.Status = "cancelled"
	}
	i.Version++
	return i
}
