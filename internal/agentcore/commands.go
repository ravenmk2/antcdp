package agentcore

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type AdmissionState struct {
	Session   Session
	ActiveRun *Run
	Candidate LockedModel
	Policy    Policy
}
type AdmissionCommand struct {
	InputID           ID
	Actor             ActorRef
	Origin            string
	Source            *SourceRef
	Kind              string
	Content           []TextBlock
	Files             []FileRef
	ExpectedModelHash string
}
type AdmissionPlan struct {
	Session Session
	Input   Input
	Events  []Event
}

func ValidateInput(content []TextBlock, files []FileRef) error {
	if len(content) > 16 || len(files) > 10 {
		return invalid("content")
	}
	size := 0
	nonblank := false
	for _, b := range content {
		if b.Type != "text" || !utf8.ValidString(b.Text) {
			return invalid("content")
		}
		size += len(b.Text)
		nonblank = nonblank || strings.TrimSpace(b.Text) != ""
	}
	if size > 32<<10 || !nonblank && len(files) == 0 {
		return invalid("content")
	}
	seen := map[FileRef]bool{}
	for _, f := range files {
		if f.ID == 0 || f.Kind != "attachment" && f.Kind != "artifact" || seen[f] {
			return invalid("file_refs")
		}
		seen[f] = true
	}
	return nil
}

// The host must resolve the current authorized candidate and validate file
// ownership/integrity in the same transaction before applying this plan.
func PlanAdmission(state AdmissionState, command AdmissionCommand, now time.Time) (AdmissionPlan, error) {
	s := state.Session
	if s.RootSessionID != nil {
		return AdmissionPlan{}, reject("CHILD_SESSION_READ_ONLY")
	}
	if s.ArchivedAt != nil {
		return AdmissionPlan{}, reject("SESSION_ARCHIVED")
	}
	if err := ValidatePolicy(state.Policy); err != nil {
		return AdmissionPlan{}, err
	}
	if err := ValidateInput(command.Content, command.Files); err != nil {
		return AdmissionPlan{}, err
	}
	if command.InputID == 0 || command.Origin != "human" && command.Origin != "system" && command.Origin != "trigger" {
		return AdmissionPlan{}, invalid("source")
	}
	if command.Kind == "" {
		command.Kind = "message"
	}
	if command.Kind != "message" && command.Kind != "continue" {
		return AdmissionPlan{}, invalid("kind")
	}
	chosen := state.Candidate
	if s.ModelLockedAt != nil {
		if s.Model == nil {
			return AdmissionPlan{}, reject("MODEL_STATE_INVALID")
		}
		chosen = *s.Model
	} else if command.ExpectedModelHash == "" {
		return AdmissionPlan{}, invalid("expected_model_selection_hash")
	}
	if chosen.SelectionHash == "" || command.ExpectedModelHash != "" && command.ExpectedModelHash != chosen.SelectionHash {
		return AdmissionPlan{}, reject("MODEL_SELECTION_CHANGED")
	}
	plan := AdmissionPlan{Session: s}
	if s.ModelLockedAt == nil {
		plan.Session.Model = &chosen
		plan.Session.ModelLockedAt = &now
		plan.Session.Version++
		// Internal historical projection: the host selects the public fields.
		e, err := NewEvent(s.ID, s.LastSeq+1, nil, "session/configured", "", map[string]any{"session": plan.Session, "changed_fields": []string{"model_locked_at", "model"}, "actor_ref": command.Actor}, now)
		if err != nil {
			return AdmissionPlan{}, err
		}
		plan.Events = append(plan.Events, e)
		plan.Session.LastSeq++
	}
	if plan.Session.NextInputOrder == 0 {
		plan.Session.NextInputOrder = 1
	}
	i := Input{ID: command.InputID, SessionID: s.ID, Kind: command.Kind, Origin: command.Origin, Actor: command.Actor, Source: command.Source, Content: append([]TextBlock(nil), command.Content...), Files: append([]FileRef(nil), command.Files...), Delivery: "next_turn", State: "pending", Position: plan.Session.NextInputOrder, Revision: 1, Version: 1, QueueDeadline: now.Add(time.Duration(state.Policy.QueueTimeoutSeconds) * time.Second)}
	plan.Session.NextInputOrder++
	i.AcceptedSeq = plan.Session.LastSeq + 1
	e, err := NewEvent(s.ID, i.AcceptedSeq, nil, "input/accepted", "", map[string]any{"input": i}, now)
	if err != nil {
		return AdmissionPlan{}, err
	}
	plan.Session.LastSeq++
	plan.Events = append(plan.Events, e)
	plan.Input = i
	return plan, nil
}

type ClaimPlan struct {
	Session Session
	Input   Input
	Run     Run
}

func PlanClaim(s Session, input Input, runID ID, epoch string, policy Policy, now time.Time) (ClaimPlan, error) {
	if s.RootSessionID != nil {
		return ClaimPlan{}, reject("CHILD_SESSION_READ_ONLY")
	}
	if s.ArchivedAt != nil {
		return ClaimPlan{}, reject("SESSION_ARCHIVED")
	}
	if s.QueuePaused || s.ActiveRunID != nil || s.ActiveCompactionID != nil {
		return ClaimPlan{}, reject("SESSION_NOT_IDLE")
	}
	if input.SessionID != s.ID || input.State != "pending" {
		return ClaimPlan{}, reject("INPUT_NOT_PENDING")
	}
	if !now.Before(input.QueueDeadline) {
		return ClaimPlan{}, reject("INPUT_EXPIRED")
	}
	if s.ModelLockedAt == nil || s.Model == nil || runID == 0 || epoch == "" {
		return ClaimPlan{}, reject("MODEL_STATE_INVALID")
	}
	input.State = "claimed"
	input.Version++
	input.ClaimedRunID = &runID
	input.Delivery = "next_turn"
	s.ActiveRunID = &runID
	r := Run{Ref: ExecutionRef{SessionID: s.ID, RunID: runID, RootRunID: runID, Epoch: epoch, Fence: 1}, Principal: s.Principal, TriggerInputID: input.ID, Status: Preparing, Policy: policy, Deadline: now.Add(time.Duration(policy.RunTimeoutSeconds) * time.Second), Budget: BudgetLedger{Limit: LimitFromPolicy(policy), Version: 1}}
	return ClaimPlan{Session: s, Input: input, Run: r}, nil
}

type StopPlan struct {
	Session Session
	Run     Run
	Changed bool
}

func PlanStop(s Session, r Run, now time.Time, grace time.Duration) (StopPlan, error) {
	if r.Ref.SessionID != s.ID {
		return StopPlan{}, reject("NOT_FOUND")
	}
	if r.ParentRunID != nil {
		return StopPlan{}, reject("CHILD_SESSION_READ_ONLY")
	}
	if r.Status.Terminal() {
		return StopPlan{Session: s, Run: r}, nil
	}
	if s.ArchivedAt != nil {
		return StopPlan{}, reject("SESSION_ARCHIVED")
	}
	if grace <= 0 || grace > 5*time.Minute {
		return StopPlan{}, invalid("stop_grace")
	}
	if r.Status == Stopping {
		return StopPlan{Session: s, Run: r}, nil
	}
	deadline := now.Add(grace)
	r.Status = Stopping
	r.StopDeadline = &deadline
	r.Reason = "user_stopped"
	return StopPlan{Session: s, Run: r, Changed: true}, nil
}

type ArchivePlan struct {
	Session      Session
	Inputs       []Input
	Interactions []Interaction
}

func PlanArchive(s Session, expected Version, inputs []Input, interactions []Interaction, now time.Time) (ArchivePlan, error) {
	if s.RootSessionID != nil {
		return ArchivePlan{}, reject("CHILD_SESSION_READ_ONLY")
	}
	if s.Version != expected {
		return ArchivePlan{}, reject("PRECONDITION_FAILED")
	}
	if s.ActiveRunID != nil {
		return ArchivePlan{}, reject("SESSION_ACTIVE")
	}
	if s.ActiveCompactionID != nil {
		return ArchivePlan{}, reject("SESSION_NOT_IDLE")
	}
	p := ArchivePlan{Session: s, Inputs: append([]Input(nil), inputs...), Interactions: append([]Interaction(nil), interactions...)}
	if s.ArchivedAt != nil {
		return p, nil
	}
	p.Session.ArchivedAt = &now
	p.Session.QueuePaused = true
	p.Session.Version++
	for n, i := range p.Inputs {
		if i.SessionID != s.ID {
			return ArchivePlan{}, reject("NOT_FOUND")
		}
		if i.State == "pending" {
			i.State = "cancelled"
			i.Version++
			p.Inputs[n] = i
		}
	}
	for n, i := range p.Interactions {
		if i.SessionID != s.ID {
			return ArchivePlan{}, reject("NOT_FOUND")
		}
		if i.Kind == "question" && (i.Status == "waiting" || i.Status == "continued" || i.Status == "reply_queued") {
			i.Status = "cancelled"
			i.PendingReplyInputID = nil
			i.Version++
			p.Interactions[n] = i
		}
	}
	return p, nil
}
func PlanRestore(s Session, expected Version) (Session, error) {
	if s.RootSessionID != nil {
		return s, reject("CHILD_SESSION_READ_ONLY")
	}
	if s.Version != expected {
		return s, reject("PRECONDITION_FAILED")
	}
	if s.ArchivedAt != nil {
		s.ArchivedAt = nil
		s.QueuePaused = false
		s.Version++
	}
	return s, nil
}
func CheckPendingEdit(s Session, i Input, expected Version, now time.Time) error {
	if s.RootSessionID != nil {
		return reject("CHILD_SESSION_READ_ONLY")
	}
	if s.ArchivedAt != nil {
		return reject("SESSION_ARCHIVED")
	}
	if i.SessionID != s.ID {
		return reject("NOT_FOUND")
	}
	if i.Version != expected {
		return reject("PRECONDITION_FAILED")
	}
	if i.State != "pending" {
		return reject("INPUT_NOT_PENDING")
	}
	if !now.Before(i.QueueDeadline) {
		return reject("INPUT_EXPIRED")
	}
	return nil
}
func AdvanceView(current Seq, presented Seq, rootResults map[Seq]RunStatus) (Seq, error) {
	status, ok := rootResults[presented]
	if !ok || presented == 0 || !status.Terminal() {
		return current, reject("VIEW_POSITION_INVALID")
	}
	return max(current, presented), nil
}
func ToolResultKey(id ID) string { return fmt.Sprintf("tool-result:%d", id) }
