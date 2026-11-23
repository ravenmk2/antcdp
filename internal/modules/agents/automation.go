package agents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

type AutomationChat struct {
	JobRun                                      bool
	ProjectID, ActorID, CallerID, ConsumptionID uint64
	Path                                        resourcecode.Locator
	Message, Title, RequestKey                  string
}
type ChatReceipt struct {
	SessionID uint64 `json:"sessionId,string"`
	InputID   uint64 `json:"inputId,string"`
	Status    string `json:"status"`
	Replayed  bool   `json:"replayed"`
}

var automationKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

// ChatAutomation atomically creates a new service session, its first input and
// an acceptance receipt. It never grants the initiator session-content access.
func (s *Service) ChatAutomation(ctx context.Context, w AutomationChat) (ChatReceipt, error) {
	var accepted ChatReceipt
	if w.CallerID == 0 || !automationKey.MatchString(w.RequestKey) {
		return accepted, httpx.Invalid("requestKey", "invalid")
	}
	content := []agentcore.TextBlock{{Type: "text", Text: w.Message}}
	if err := agentcore.ValidateInput(content, nil, nil); err != nil {
		return accepted, coreError(err)
	}
	title := strings.TrimSpace(w.Title)
	if title == "" {
		title = "新会话"
	}
	if utf8.RuneCountInString(title) > 200 {
		return accepted, httpx.Invalid("title", "invalid_length")
	}
	keySum := sha256.Sum256([]byte("chat:" + w.RequestKey))
	key := hex.EncodeToString(keySum[:])
	out := &Result{}
	err := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		// Store transactions may retry after a deadlock. Publish only the final
		// attempt's committed session events, never a rolled-back admission.
		out = &Result{}
		accepted = ChatReceipt{}
		agent, err := r.DefinitionByPath(w.ProjectID, w.Path)
		if err != nil {
			return err
		}
		if agent == nil || agent.Mode != "service" || agent.RobotUserID == nil {
			return missing()
		}
		if agent.ScopeKind == "project" && (agent.ScopeID == nil || *agent.ScopeID != w.ProjectID) {
			return missing()
		}
		callerKind := "event_subscription"
		originKind, originID := "event_consumption", w.ConsumptionID
		creatorKind, creatorID := "user", idString(w.ActorID)
		if w.JobRun {
			callerKind, originKind, originID = "job_run", "job_run", w.CallerID
			creatorKind, creatorID = "job_run", idString(w.CallerID)
		}
		if err = authorizeAutomation(tx, r, agent, w); err != nil {
			return err
		}
		if err = s.definition(agent); err != nil {
			return err
		}
		payload, err := agentcore.CanonicalJSON(struct {
			Agent          uint64
			Message, Title string
		}{agent.ID, w.Message, title})
		if err != nil {
			return err
		}
		digest := sha256.Sum256(payload)
		caller, scope := strconv.FormatUint(w.CallerID, 10), strconv.FormatUint(w.ProjectID, 10)
		// Authorization locks the project for an event or the run for a job before checking its receipt.
		old, err := r.AutomationReceipt(callerKind, caller, scope, key)
		if err != nil {
			return err
		}
		if old != nil {
			if !hmac.Equal(old.Hash, digest[:]) {
				return httpx.E(409, "REQUEST_CONFLICT", "同一请求标识的内容不同")
			}
			if json.Unmarshal(old.Result, &accepted) != nil {
				return integrity()
			}
			accepted.Replayed = true
			return nil
		}
		if !agent.Enabled || agent.DefaultModelBindingID == nil {
			return httpx.E(409, "AGENT_UNAVAILABLE", "助手当前不可用")
		}
		v := &SessionRow{AgentID: agent.ID, ExecutionMode: "service", ExecutorKind: "robot", SessionKind: "root", RunAsUserID: *agent.RobotUserID, Title: title, NextInputOrder: 1, RowVersion: 1, CreatedByActorKind: creatorKind, CreatedByActorID: creatorID, LockedModelConfig: json.RawMessage(`null`), SelectedModelBindingID: *agent.DefaultModelBindingID}
		executor, err := executionAccount(tx, v, true)
		if err != nil {
			return err
		}
		bindings, err := r.ModelBindings(agent.ID, false)
		if err != nil {
			return err
		}
		for _, binding := range bindings {
			if binding.ID == v.SelectedModelBindingID {
				v.SelectedThinkingOptionKey = binding.DefaultThinking
			}
		}
		model, selection, err := s.selection(tx, r, v)
		if err != nil {
			return err
		}
		current, err := r.Definition(agent.ID, true)
		if err != nil {
			return err
		}
		if current == nil || current.DeletedAt != nil || current.RowVersion != agent.RowVersion || !current.Enabled {
			return httpx.E(409, "AGENT_UNAVAILABLE", "助手配置已变化")
		}
		if !selection.Availability.Available {
			return httpx.E(409, "MODEL_UNAVAILABLE", "所选模型当前不可用")
		}
		if err = requireSessionAgent(r, current, executor); err != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		rec := &Receipt{ActorKind: callerKind, ActorID: caller, ScopeKind: "project", ScopeID: scope, Command: "automation.chat", Key: key, Hash: digest[:], Status: "pending", Result: json.RawMessage(`{}`), CreatedAt: now}
		if err = r.InsertReceipt(rec); err != nil {
			return err
		}
		v.CreatedAt = now
		v.UpdatedAt = now
		v.LastActivityAt = now
		if err = st.InsertSession(v); err != nil {
			return err
		}
		titleSource := "default"
		if w.Title != "" {
			titleSource = "user"
		}
		if err = s.pinSessionTitle(st, v, titleSource, now); err != nil {
			return err
		}
		source := &agentcore.SourceRef{Kind: originKind, ID: agentcore.ID(originID)}
		if err = s.admitInput(st, out, rec, v, agent, model, selection, w.ActorID, "trigger", source, nil, InputCreate{Content: content, ExpectedHash: model.SelectionHash}); err != nil {
			return err
		}
		input := out.Data.(InputAccepted)
		accepted = ChatReceipt{SessionID: v.ID, InputID: input.InputID, Status: "accepted"}
		rec.Result, err = json.Marshal(accepted)
		if err != nil {
			return err
		}
		rec.Status = "completed"
		rec.ResponseStatus = 202
		rec.CompletedAt = &now
		return r.SaveReceipt(rec)
	})
	if err == nil && !accepted.Replayed {
		if s.SessionChanged != nil {
			s.SessionChanged(agentcore.SessionChange{SessionID: agentcore.ID(accepted.SessionID)})
		}
		if s.Committed != nil {
			for _, receipt := range out.Commits {
				s.Committed(ctx, receipt)
			}
		}
	}
	return accepted, err
}

func authorizeAutomation(tx identity.Tx, r Repository, agent *Definition, w AutomationChat) error {
	actor := w.ActorID
	users, err := tx.LockUsers([]uint64{actor, *agent.RobotUserID})
	if err != nil {
		return err
	}
	if _, err = collaboration.AutomationProject(tx, w.ProjectID, actor); err != nil {
		return err
	}
	if w.JobRun {
		id, err := r.JobRunAccount(w.CallerID, w.ProjectID, agent.ID)
		if err != nil {
			return err
		}
		if id == 0 || id != actor {
			return missing()
		}
	}
	allowed, err := r.CanUseAgent(agent.ID, actor, users[actor].Role == "admin")
	if err != nil {
		return err
	}
	if !allowed {
		return missing()
	}
	return nil
}
