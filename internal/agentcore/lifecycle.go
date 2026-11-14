package agentcore

import "time"

type ChildPlan struct {
	Session      Session
	Run          Run
	ParentBudget BudgetLedger
	Reservation  Reservation
}

// Child creation is called under the root budget + parent Session locks. The
// seed is explicit task input only; parent conversation history is not copied.
func PlanChild(parentSession Session, parent Run, request ChildRequest, now time.Time) (ChildPlan, error) {
	if err := CheckExecution(parent, request.Parent.Ref, now); err != nil {
		return ChildPlan{}, err
	}
	if parent.ParentRunID != nil || parent.Ref.RootRunID != parent.Ref.RunID || parentSession.RootSessionID != nil {
		return ChildPlan{}, reject("CHILD_DEPTH_EXCEEDED")
	}
	if parentSession.ID != parent.Ref.SessionID || parentSession.Model == nil || request.Parent.ID == 0 || request.SessionID == 0 || request.RunID == 0 {
		return ChildPlan{}, invalid("child")
	}
	if err := ValidateInput(request.Content, request.Files); err != nil {
		return ChildPlan{}, err
	}
	budget, reservation, err := parent.Budget.Reserve(Budget{Children: 1})
	if err != nil {
		return ChildPlan{}, err
	}
	rootSession := parentSession.ID
	parentRun := parent.Ref.RunID
	runID := request.RunID
	s := Session{ID: request.SessionID, AgentID: parentSession.AgentID, RootSessionID: &rootSession, Principal: parentSession.Principal, ExecutionMode: parentSession.ExecutionMode, ProjectID: parentSession.ProjectID, Model: parentSession.Model, ModelLockedAt: parentSession.ModelLockedAt, ActiveRunID: &runID, Version: 1, SurfaceRevision: 1, NextInputOrder: 1}
	r := Run{Ref: ExecutionRef{SessionID: s.ID, RunID: runID, RootRunID: parent.Ref.RootRunID, Epoch: parent.Ref.Epoch, Fence: 1}, ParentRunID: &parentRun, Principal: parent.Principal, Status: Preparing, Policy: parent.Policy, Deadline: parent.Deadline, Binding: parent.Binding}
	return ChildPlan{Session: s, Run: r, ParentBudget: budget, Reservation: reservation}, nil
}

type EndPlan struct {
	Session      Session
	Run          Run
	Inputs       []Input
	Interactions []Interaction
	Changed      bool
}

// PlanEnd settles only logical state. Host must atomically append run/ended and
// uniquely settle outstanding tool declarations; physical unknown references
// remain held for reconciliation. For a child, parent-result commit is atomic.
func PlanEnd(s Session, r Run, end RunEnd, inputs []Input, interactions []Interaction) (EndPlan, error) {
	if s.ID != r.Ref.SessionID || !end.Status.Terminal() {
		return EndPlan{}, invalid("run_end")
	}
	p := EndPlan{Session: s, Run: r, Inputs: append([]Input(nil), inputs...), Interactions: append([]Interaction(nil), interactions...)}
	if r.Status.Terminal() {
		return p, nil
	}
	if s.ActiveRunID == nil || *s.ActiveRunID != r.Ref.RunID {
		return EndPlan{}, reject("EXECUTION_FENCED")
	}
	p.Changed = true
	p.Run.Status = end.Status
	p.Run.Reason = end.Reason
	p.Run.Ref.Fence++
	p.Session.ActiveRunID = nil
	for n, i := range p.Inputs {
		if i.SessionID != s.ID {
			return EndPlan{}, reject("NOT_FOUND")
		}
		if (end.Status == Cancelled || end.Status == Interrupted) && i.State == "pending" {
			i.State, i.Version = "cancelled", i.Version+1
			p.Inputs[n] = i
		}
	}
	for n, i := range p.Interactions {
		if i.RunID != r.Ref.RunID {
			continue
		}
		if end.Status != WaitingInput && i.Kind == "approval" && (i.Status == "pending" || i.Status == "approved_once") {
			i.Status = "cancelled"
			i.Version++
		}
		if i.Kind == "question" && (i.Status == "waiting" || i.Status == "continued" || i.Status == "reply_queued") {
			if end.Status == WaitingInput || end.Status == Succeeded || end.Status == Failed {
				if i.Status == "waiting" {
					i.Status = "continued"
					i.Version++
				}
			} else {
				i.Status = "cancelled"
				i.Version++
				i.PendingReplyInputID = nil
			}
		}
		p.Interactions[n] = i
	}
	return p, nil
}

type RecoveryPlan struct {
	End     EndPlan
	Expired []Input
}

func PlanRecovery(s Session, r Run, epoch string, inputs []Input, interactions []Interaction, now time.Time) (RecoveryPlan, error) {
	if r.Ref.Epoch == epoch {
		return RecoveryPlan{}, reject("EXECUTION_CURRENT_EPOCH")
	}
	end, err := PlanEnd(s, r, RunEnd{Status: Interrupted, Reason: "service_restarted"}, inputs, interactions)
	if err != nil {
		return RecoveryPlan{}, err
	}
	p := RecoveryPlan{End: end}
	for n, i := range p.End.Inputs {
		if i.State == "pending" && !now.Before(i.QueueDeadline) {
			i.State = "expired"
			i.Version++
			p.End.Inputs[n] = i
			p.Expired = append(p.Expired, i)
		}
	}
	return p, nil
}

// CheckToolPolicy is independent of caller UI. A child cannot obtain an
// approval or ask a question directly; it returns unresolved facts to its root.
func CheckToolPolicy(execution ExecutionContext, tool ToolSpec) (string, error) {
	if tool.Policy == "deny" {
		return "blocked", nil
	}
	if tool.Policy != "allow" && tool.Policy != "confirm" {
		return "", invalid("tool_policy")
	}
	if tool.Policy == "confirm" {
		if execution.Policy.ApprovalPolicy != "ask" {
			return "blocked", nil
		}
		if execution.Ref.RootRunID != execution.Ref.RunID {
			return "root_intervention_required", nil
		}
		return "approval", nil
	}
	if execution.Ref.RootRunID != execution.Ref.RunID && tool.ExecutionClass == "question" {
		return "root_intervention_required", nil
	}
	return "execute", nil
}
