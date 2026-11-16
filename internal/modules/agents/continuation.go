package agents

// continuation is derived from durable execution facts, not the visible history
// page. The command calls it while holding the session lock, just like admission.
func continuation(st StateRepository, session *SessionRow, latest *RunResultRef) (*RunResultRef, error) {
	if latest == nil || latest.Status != "failed" || session.RootSessionID != nil || session.ArchivedAt != nil || session.QueuePaused || session.ActiveRunID != nil || session.ActiveCompactionID != nil {
		return nil, nil
	}
	counts, err := st.SessionCounts(session.ID)
	if err != nil || counts.Inputs > 0 {
		return nil, err
	}
	run, err := st.Run(latest.ID, false)
	if err != nil {
		return nil, err
	}
	if run == nil || run.SessionID != session.ID || run.TriggerInputID == nil || run.EndReason == nil || run.SettledAt == nil || (*run.EndReason != "EXECUTION_FAILED" && !continuableModelFailure(*run.EndReason)) {
		return nil, nil
	}
	input, err := st.Input(*run.TriggerInputID, false)
	if err != nil {
		return nil, err
	}
	if input == nil || input.SessionID != session.ID || input.OriginKind != "human" || input.Status != "claimed" || input.MessageSeq == nil || (input.InputKind != "message" && input.InputKind != "continue") {
		return nil, nil
	}
	calls, err := st.RunModelCalls(run.ID)
	if err != nil {
		return nil, err
	}
	var last *ModelCallRow
	for i := range calls {
		call := &calls[i]
		if call.Purpose == "generation" && call.StepNo == run.CurrentStepNo && (last == nil || call.AttemptNo > last.AttemptNo) {
			last = call
		}
	}
	if last == nil || last.Status != "failed" || last.ResponseEventSeq == nil || last.ErrorCode == nil || !continuableModelFailure(*last.ErrorCode) {
		return nil, nil
	}
	return latest, nil
}

// Manual generation continuation has its own eligibility, independent of the
// automatic retry count, delay and remaining budget of the ended run.
func continuableModelFailure(code string) bool {
	switch code {
	case "MODEL_RATE_LIMITED", "MODEL_REMOTE_SERVICE_ERROR", "MODEL_REQUEST_TIMEOUT", "MODEL_ATTEMPT_TIMEOUT", "MODEL_CONNECTION_FAILED", "MODEL_RESPONSE_EMPTY", "MODEL_STREAM_INCOMPLETE":
		return true
	default:
		return false
	}
}
