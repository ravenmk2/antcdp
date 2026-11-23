package app

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/jobadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/jobs"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

func newJobService(installer *install.Service, accounts *identity.Service, agentService *agents.Service) *jobs.Service {
	return &jobs.Service{Identity: accounts, AgentChat: func(ctx context.Context, project, run, account uint64, path string, opts jobs.AgentChatOptions) (any, error) {
		locator, err := resourcecode.Parse(path)
		if err != nil {
			return nil, httpx.Invalid("path", "invalid")
		}
		return agentService.ChatAutomation(ctx, agents.AutomationChat{JobRun: true, ActorID: account, ProjectID: project, CallerID: run, Path: locator, Message: opts.Message, Title: opts.Title, RequestKey: opts.RequestKey})
	}, Executor: sobek.Executor{}, Cipher: installer.DingTalkSecret, Store: func() (identity.Store, error) {
		if store, ok := installer.Backend().(identity.Store); ok {
			return store, nil
		}
		return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
	}, State: func() (statestore.Backend, error) {
		if store, ok := installer.Backend().(interface{ StateStore() statestore.Backend }); ok {
			return store.StateStore(), nil
		}
		return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
	}}
}
