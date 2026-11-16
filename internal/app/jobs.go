package app

import (
	"github.com/ravenmk2/antcdp/internal/jobadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/jobs"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/statestore"
)

func newJobService(installer *install.Service, accounts *identity.Service) *jobs.Service {
	return &jobs.Service{Identity: accounts, Executor: sobek.Executor{}, Cipher: installer.DingTalkSecret, Store: func() (identity.Store, error) {
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
