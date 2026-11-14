package webaccess

import (
	"context"

	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

// A route object contains no credential snapshot. Admission and credentials are
// rechecked at the actual call, including calls after route fallback.
type leasedAdapter struct {
	s         *Service
	route     runtime.RouteRef
	operation runtime.Operation
}

func (s *Service) Resolve(_ context.Context, route runtime.RouteRef, op runtime.Operation) (runtime.Adapter, error) {
	if op != runtime.Search && op != runtime.Fetch {
		return nil, runtime.Fail("WEB_ACCESS_CAPABILITY_UNSUPPORTED")
	}
	return &leasedAdapter{s, route, op}, nil
}
func (a *leasedAdapter) acquire(ctx context.Context) (runtime.Adapter, func(), error) {
	a.s.leaseMu.Lock()
	adapter, e := a.s.resolve(ctx, a.route, a.operation)
	if e != nil {
		a.s.leaseMu.Unlock()
		return nil, nil, e
	}
	id := uint64(0)
	if a.route.Kind == "provider" {
		id, _ = validID(a.route.ID)
		if a.s.active == nil {
			a.s.active = map[uint64]int{}
		}
		a.s.active[id]++
	}
	a.s.leaseMu.Unlock()
	release := func() {
		if id != 0 {
			a.s.leaseMu.Lock()
			a.s.active[id]--
			if a.s.active[id] == 0 {
				delete(a.s.active, id)
			}
			a.s.leaseMu.Unlock()
		}
	}
	return adapter, release, nil
}
func (a *leasedAdapter) Search(ctx context.Context, q runtime.SearchRequest) (runtime.SearchResult, error) {
	if a.operation != runtime.Search {
		return runtime.SearchResult{}, runtime.Fail("WEB_ACCESS_CAPABILITY_UNSUPPORTED")
	}
	adapter, release, e := a.acquire(ctx)
	if e != nil {
		return runtime.SearchResult{}, e
	}
	defer release()
	return adapter.Search(ctx, q)
}
func (a *leasedAdapter) Fetch(ctx context.Context, q runtime.FetchRequest) (runtime.FetchResult, error) {
	if a.operation != runtime.Fetch {
		return runtime.FetchResult{}, runtime.Fail("WEB_ACCESS_CAPABILITY_UNSUPPORTED")
	}
	adapter, release, e := a.acquire(ctx)
	if e != nil {
		return runtime.FetchResult{}, e
	}
	defer release()
	return adapter.Fetch(ctx, q)
}
