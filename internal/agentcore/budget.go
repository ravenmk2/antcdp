package agentcore

import "time"

type Budget struct {
	ModelCalls   uint64 `json:"model_calls"`
	ToolCalls    uint64 `json:"tool_calls"`
	Children     uint64 `json:"children"`
	InputTokens  uint64 `json:"input_tokens"`
	OutputTokens uint64 `json:"output_tokens"`
}
type BudgetLedger struct {
	Limit    Budget  `json:"limit"`
	Reserved Budget  `json:"reserved"`
	Used     Budget  `json:"used"`
	Version  Version `json:"version"`
}
type Reservation struct {
	Amount  Budget
	Settled bool
}

func budgetFields(v *Budget) []*uint64 {
	return []*uint64{&v.ModelCalls, &v.ToolCalls, &v.Children, &v.InputTokens, &v.OutputTokens}
}

// Reserve operates on a value; the store commits it while holding the root Run
// lock. Child runs must use the root ledger, not an independent copy of limits.
func (v BudgetLedger) Reserve(amount Budget) (BudgetLedger, Reservation, error) {
	limits, used, reserved, amounts := budgetFields(&v.Limit), budgetFields(&v.Used), budgetFields(&v.Reserved), budgetFields(&amount)
	for i, limit := range limits {
		if *used[i] > *limit || *reserved[i] > *limit-*used[i] || *amounts[i] > *limit-*used[i]-*reserved[i] {
			return v, Reservation{}, reject("BUDGET_EXCEEDED")
		}
	}
	for i := range reserved {
		*reserved[i] += *amounts[i]
	}
	v.Version++
	return v, Reservation{Amount: amount}, nil
}

// A nil actual preserves the reservation for an unknown external outcome.
// Settlement exceeding a reserved estimate still records known actual use;
// subsequent reservations fail rather than silently discarding billed usage.
func (v BudgetLedger) Settle(r Reservation, actual *Budget) (BudgetLedger, Reservation, error) {
	if r.Settled || actual == nil {
		return v, r, nil
	}
	reserved, amounts, used, values := budgetFields(&v.Reserved), budgetFields(&r.Amount), budgetFields(&v.Used), budgetFields(actual)
	for i := range reserved {
		if *reserved[i] < *amounts[i] || ^uint64(0)-*used[i] < *values[i] {
			return v, r, reject("BUDGET_INTEGRITY_ERROR")
		}
	}
	for i := range reserved {
		*reserved[i] -= *amounts[i]
		*used[i] += *values[i]
	}
	v.Version++
	r.Settled = true
	return v, r, nil
}

func ValidatePolicy(p Policy) error {
	if p.MaxSteps < 1 || p.MaxSteps > 200 || p.MaxModelCalls < 1 || p.MaxModelCalls > 1000 || p.MaxToolCalls < 1 || p.MaxToolCalls > 1000 || p.MaxChildren > 8 || p.MaxParallelTools < 1 || p.MaxParallelTools > 16 {
		return invalid("budget")
	}
	if p.RunTimeoutSeconds < 60 || p.RunTimeoutSeconds > 86400 || p.QueueTimeoutSeconds < 60 || p.QueueTimeoutSeconds > 86400 || p.QuestionTimeoutSeconds < 5 || p.QuestionTimeoutSeconds > 600 || p.ApprovalTimeoutSeconds < 15 || p.ApprovalTimeoutSeconds > 900 {
		return invalid("timeout")
	}
	if p.MaxInputTokens < 1 || p.MaxInputTokens > 10000000 || p.MaxOutputTokens < 1 || p.MaxOutputTokens > 10000000 {
		return invalid("token_budget")
	}
	if p.ApprovalPolicy != "ask" && p.ApprovalPolicy != "preauthorized_only" {
		return invalid("approval_policy")
	}
	return nil
}

func LimitFromPolicy(p Policy) Budget {
	return Budget{ModelCalls: p.MaxModelCalls, ToolCalls: p.MaxToolCalls, Children: p.MaxChildren, InputTokens: p.MaxInputTokens, OutputTokens: p.MaxOutputTokens}
}
func BoundedDeadline(now time.Time, seconds int, root time.Time) time.Time {
	deadline := now.Add(time.Duration(seconds) * time.Second)
	if root.Before(deadline) {
		return root
	}
	return deadline
}

func CheckExecution(run Run, ref ExecutionRef, now time.Time) error {
	if run.Ref != ref {
		return reject("EXECUTION_FENCED")
	}
	if !run.Status.Active() || run.Status == Stopping {
		return reject("RUN_NOT_EXECUTABLE")
	}
	if !now.Before(run.Deadline) {
		return reject("DEADLINE_EXCEEDED")
	}
	return nil
}
