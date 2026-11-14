package app

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/webaccess"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
	"github.com/ravenmk2/antcdp/internal/webaccessadapters"
)

func newWebAccessService(installer *install.Service, accounts *identity.Service) *webaccess.Service {
	return &webaccess.Service{Identity: accounts, Cipher: installer.WebAccessSecret, ETag: installer.WebAccessETag, Store: func() (identity.Store, error) {
		if store, ok := installer.Backend().(identity.Store); ok {
			return store, nil
		}
		return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
	}, Adapter: func(_ context.Context, p webaccess.Provider, key string) (runtime.Adapter, error) {
		hosts, err := installer.OutboundProtectedHosts()
		if err != nil {
			return nil, err
		}
		return webaccessadapters.NewRemote(webaccessadapters.Config{Provider: p.Type, BaseURL: p.Config.BaseURL, APIKey: key, Timeout: time.Duration(p.Config.Timeout) * time.Second, ProtectedHosts: hosts}, nil)
	}, Reader: protectedWebReader{installer}}
}

type protectedWebReader struct{ installer *install.Service }

func (protectedWebReader) Search(context.Context, runtime.SearchRequest) (runtime.SearchResult, error) {
	return runtime.SearchResult{}, runtime.Fail("WEB_ACCESS_CAPABILITY_UNSUPPORTED")
}
func (r protectedWebReader) Fetch(ctx context.Context, request runtime.FetchRequest) (runtime.FetchResult, error) {
	hosts, err := r.installer.OutboundProtectedHosts()
	if err != nil {
		return runtime.FetchResult{}, err
	}
	return (webaccessadapters.Reader{ProtectedHosts: hosts}).Fetch(ctx, request)
}
