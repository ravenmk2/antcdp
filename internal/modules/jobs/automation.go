package jobs

import (
	"context"
	"encoding/json"
	"regexp"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

type AutomationStart struct {
	ProjectID, ActorID, CallerID uint64
	Path                         resourcecode.Locator
	Inputs                       map[string]json.RawMessage
	RequestKey                   string
	Trace                        json.RawMessage
}

var automationRequestKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

// StartAutomation admits a run as the robot, independently of console sessions.
// Only accepted commands consume a key; busy/validation failures remain retryable.
func (s *Service) StartAutomation(ctx context.Context, w AutomationStart) (Receipt, error) {
	var out Receipt
	if w.CallerID == 0 || !automationRequestKey.MatchString(w.RequestKey) {
		return out, httpx.Invalid("requestKey", "invalid")
	}
	if w.Path.ScopeKind != "" && w.Path.ScopeKind != "project" {
		return out, missing()
	}
	store, err := s.Store()
	if err != nil {
		return out, err
	}
	err = store.Transact(ctx, func(tx identity.Tx) error {
		p, err := collaboration.AutomationProject(tx, w.ProjectID, w.ActorID)
		if err != nil {
			return err
		}
		if w.Path.ScopeKind == "project" && p.Code != w.Path.ScopeCode {
			return missing()
		}
		r, err := repository(tx)
		if err != nil {
			return err
		}
		j, err := r.JobByCode(w.ProjectID, w.Path.Code)
		if err != nil {
			return err
		}
		if j == nil {
			return missing()
		}
		allowed := p.Role == "admin"
		if !allowed {
			allowed, err = r.RunAllowed(j.ID, w.ActorID)
		}
		if err != nil {
			return err
		}
		if !allowed {
			return forbidden()
		}
		// Hash the supplied semantic input, never an attempt's changing trace/actor.
		digest, err := hash(struct {
			Job    uint64
			Inputs map[string]json.RawMessage
		}{j.ID, w.Inputs})
		if err != nil {
			return httpx.Invalid("inputs", "invalid")
		}
		prior, err := r.AutomationReceipt(j.ID, w.CallerID, w.RequestKey)
		if err != nil {
			return err
		}
		if prior != nil {
			if prior.Hash != digest {
				return httpx.E(409, "REQUEST_CONFLICT", "同一请求标识的内容不同")
			}
			out = *prior
			return nil
		}
		if !j.Enabled {
			return httpx.E(409, "JOB_DISABLED", "任务已停用")
		}
		if j.RevisionID == nil {
			return httpx.E(409, "NO_CONFIGURATION", "任务尚未配置")
		}
		rev, err := r.Revision(*j.RevisionID)
		if err != nil {
			return err
		}
		if rev == nil {
			return missing()
		}
		values, err := inputs(rev.Config, w.Inputs)
		if err != nil {
			return err
		}
		v := &Run{JobID: j.ID, RevisionID: rev.ID, Trigger: "event", Actor: &w.ActorID, TriggerContext: w.Trace, Inputs: values, TimeoutMS: j.TimeoutMS, StateMode: "default", Status: "queued", QueuedAt: now()}
		if len(v.TriggerContext) == 0 {
			v.TriggerContext = json.RawMessage(`{}`)
		}
		accepted, err := admit(r, j, v)
		if err != nil {
			return err
		}
		out = Receipt{JobID: j.ID, Actor: w.ActorID, CallerKind: "event_subscription", CallerID: w.CallerID, Key: w.RequestKey, Hash: digest, Trigger: "event", At: now()}
		if !accepted {
			out.Outcome = "skipped"
			out.Reason = "JOB_BUSY"
			return nil
		}
		out.Outcome = "accepted"
		out.RunID = &v.ID
		return r.SaveReceipt(&out)
	})
	return out, err
}
