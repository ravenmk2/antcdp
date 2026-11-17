package app

import (
	"bytes"
	"context"
	"encoding/json"
	"strconv"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/events"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/jobs"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
	"github.com/ravenmk2/antcdp/internal/scriptadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

func newEventService(installer *install.Service, accounts *identity.Service, jobService *jobs.Service, agentService *agents.Service) *events.Service {
	return &events.Service{Identity: accounts, Executor: sobek.Executor{}, Store: func() (identity.Store, error) {
		if store, ok := installer.Backend().(identity.Store); ok {
			return store, nil
		}
		return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
	}, State: func() (statestore.Backend, error) {
		if store, ok := installer.Backend().(interface{ StateStore() statestore.Backend }); ok {
			return store.StateStore(), nil
		}
		return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
	}, Dispatch: func(ctx context.Context, a events.Action) (any, error) {
		path, err := resourcecode.Parse(a.Path)
		if err != nil {
			return nil, httpx.Invalid("path", "invalid")
		}
		decoder := json.NewDecoder(bytes.NewReader(a.Args))
		decoder.DisallowUnknownFields()
		switch a.Kind {
		case "jobs.start":
			var w struct {
				Inputs     map[string]json.RawMessage `json:"inputs"`
				RequestKey string                     `json:"requestKey"`
			}
			if decoder.Decode(&w) != nil {
				return nil, httpx.Invalid("options", "invalid")
			}
			trace, _ := json.Marshal(map[string]any{"subscription_id": a.SubscriptionID, "consumption_id": a.ConsumptionID, "attempt": a.Attempt})
			receipt, err := jobService.StartAutomation(ctx, jobs.AutomationStart{ProjectID: a.ProjectID, ActorID: a.ActorID, CallerID: a.SubscriptionID, Path: path, Inputs: w.Inputs, RequestKey: w.RequestKey, Trace: trace})
			if err != nil {
				return nil, err
			}
			var runID any
			if receipt.RunID != nil {
				runID = strconv.FormatUint(*receipt.RunID, 10)
			}
			return map[string]any{"status": receipt.Outcome, "runId": runID, "reason": receipt.Reason}, nil
		case "agents.chat":
			var w struct {
				Message    string `json:"message"`
				Title      string `json:"title"`
				RequestKey string `json:"requestKey"`
			}
			if decoder.Decode(&w) != nil {
				return nil, httpx.Invalid("options", "invalid")
			}
			return agentService.ChatAutomation(ctx, agents.AutomationChat{ProjectID: a.ProjectID, ActorID: a.ActorID, CallerID: a.SubscriptionID, ConsumptionID: a.ConsumptionID, Path: path, Message: w.Message, Title: w.Title, RequestKey: w.RequestKey})
		default:
			return nil, httpx.Invalid("operation", "unknown")
		}
	}}
}
