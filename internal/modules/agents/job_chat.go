package agents

import (
	"context"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type JobChatReply struct {
	ChatReceipt
	RunID uint64 `json:"runId,string"`
	Text  string `json:"text"`
}

// ChatJob waits only for the input admitted under this job run's request key.
// The assistant owns its execution after admission, including if the job stops.
func (s *Service) ChatJob(ctx context.Context, w AutomationChat) (*JobChatReply, error) {
	w.JobRun = true
	receipt, err := s.ChatAutomation(ctx, w)
	if err != nil {
		return nil, err
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		var reply *JobChatReply
		err := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
			var err error
			reply, err = jobChatReply(tx, r, st, w, receipt)
			return err
		})
		if err != nil || reply != nil {
			return reply, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func jobChatReply(tx identity.Tx, r Repository, st StateRepository, w AutomationChat, receipt ChatReceipt) (*JobChatReply, error) {
	input, err := st.Input(receipt.InputID, false)
	if err != nil {
		return nil, err
	}
	if input == nil || input.SessionID != receipt.SessionID || input.SourceKind == nil || *input.SourceKind != "job_run" || input.SourceID == nil || *input.SourceID != idString(w.CallerID) {
		return nil, integrity()
	}
	switch input.Status {
	case "pending":
		return nil, nil
	case "claimed":
		if input.ClaimedRunID == nil {
			return nil, integrity()
		}
	case "cancelled", "expired", "removed":
		return nil, jobChatError("AGENT_INPUT_", input.Status, input.EndReason)
	default:
		return nil, integrity()
	}
	run, err := st.Run(*input.ClaimedRunID, false)
	if err != nil {
		return nil, err
	}
	if run == nil || run.SessionID != receipt.SessionID || run.ParentRunID != nil || run.TriggerInputID == nil || *run.TriggerInputID != input.ID {
		return nil, integrity()
	}
	status := agentcore.RunStatus(run.Status)
	if status.Active() {
		return nil, nil
	}
	if !status.Terminal() || run.EndedSeq == nil {
		return nil, integrity()
	}
	if status != agentcore.Succeeded {
		return nil, jobChatError("AGENT_RUN_", run.Status, run.EndReason)
	}
	// Recheck the job's current grant before releasing service-session content.
	session, err := st.Session(receipt.SessionID, false)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, integrity()
	}
	agent, err := r.Definition(session.AgentID, false)
	if err != nil {
		return nil, err
	}
	if agent == nil || agent.DeletedAt != nil || agent.RobotUserID == nil {
		return nil, missing()
	}
	if err := authorizeAutomation(tx, r, agent, w); err != nil {
		return nil, err
	}
	return finalJobReply(st, receipt, run)
}

func finalJobReply(st StateRepository, receipt ChatReceipt, run *RunRow) (*JobChatReply, error) {
	event, err := st.LastAssistantMessage(run.ID)
	if err != nil {
		return nil, err
	}
	if event != nil {
		if event.SessionID != receipt.SessionID || event.Seq >= *run.EndedSeq {
			return nil, integrity()
		}
		facts, err := decodeEvent(*event)
		if err != nil {
			return nil, err
		}
		if msg := facts.Message; msg != nil && msg.Role == "assistant" && len(msg.ToolCalls) == 0 && msg.Content != "" {
			receipt.Status = run.Status
			return &JobChatReply{ChatReceipt: receipt, RunID: run.ID, Text: msg.Content}, nil
		}
	}
	return nil, httpx.E(409, "AGENT_REPLY_MISSING", "助手运行成功但缺少最终回复正文")
}

func jobChatError(prefix, status string, reason *string) error {
	message := "助手调用未完成（" + status + "）"
	if reason != nil && *reason != "" {
		message += "：" + *reason
	}
	return httpx.E(409, prefix+strings.ToUpper(status), message)
}
