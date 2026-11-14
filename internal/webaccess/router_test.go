package webaccess

import (
	"context"
	"errors"
	"testing"
	"time"
)

type adapterFixture struct {
	search func(context.Context, SearchRequest) (SearchResult, error)
	fetch  func(context.Context, FetchRequest) (FetchResult, error)
}

func (a adapterFixture) Search(ctx context.Context, r SearchRequest) (SearchResult, error) {
	return a.search(ctx, r)
}
func (a adapterFixture) Fetch(ctx context.Context, r FetchRequest) (FetchResult, error) {
	return a.fetch(ctx, r)
}

type sourceFixture struct {
	settings Settings
	resolve  func(context.Context, RouteRef, Operation) (Adapter, error)
}

func (s sourceFixture) RuntimeSettings(context.Context) (Settings, error) { return s.settings, nil }
func (s sourceFixture) Resolve(ctx context.Context, r RouteRef, o Operation) (Adapter, error) {
	return s.resolve(ctx, r, o)
}
func permit() Permit { return Permit{Deadline: time.Now().Add(time.Minute), MaxCalls: 3} }

func TestSearchEmptyAndUnknownResultsNeverTriggerFallback(t *testing.T) {
	for _, unknown := range []bool{false, true} {
		count := 0
		router := Router{Source: sourceFixture{settings: Settings{Search: SearchSettings{Routes: []RouteRef{{Kind: "provider", ID: "1"}, {Kind: "provider", ID: "2"}}, MaxResults: 5}}, resolve: func(context.Context, RouteRef, Operation) (Adapter, error) {
			count++
			return adapterFixture{search: func(context.Context, SearchRequest) (SearchResult, error) {
				if unknown {
					return SearchResult{}, &Failure{Code: "UNKNOWN", Unknown: true, Fallback: true}
				}
				return SearchResult{Results: []SearchEntry{}}, nil
			}}, nil
		}}}
		result, err := router.Search(t.Context(), permit(), "test query")
		if count != 1 || (err != nil) != unknown || len(result.Attempts) != 1 {
			t.Fatalf("unknown=%v calls=%d err=%v attempts=%v", unknown, count, err, result.Attempts)
		}
		if unknown && result.Attempts[0].Outcome != "unknown" {
			t.Fatal("unknown outcome erased")
		}
	}
}

func TestExplicitFallbackSharesDeadlineAndReResolvesEachRoute(t *testing.T) {
	p := permit()
	calls := []string{}
	router := Router{Source: sourceFixture{settings: Settings{Search: SearchSettings{Routes: []RouteRef{{Kind: "provider", ID: "1"}, {Kind: "provider", ID: "2"}}, MaxResults: 5}}, resolve: func(ctx context.Context, route RouteRef, _ Operation) (Adapter, error) {
		deadline, ok := ctx.Deadline()
		if !ok || !deadline.Equal(p.Deadline) {
			t.Fatal("deadline reset")
		}
		calls = append(calls, route.ID)
		return adapterFixture{search: func(context.Context, SearchRequest) (SearchResult, error) {
			if route.ID == "1" {
				return SearchResult{}, &Failure{Code: "UNAVAILABLE", Fallback: true}
			}
			return SearchResult{Results: []SearchEntry{{Title: "result", URL: "https://example.com"}}}, nil
		}}, nil
	}}}
	result, err := router.Search(t.Context(), p, "test query")
	if err != nil || len(calls) != 2 || result.Route.ID != "2" || len(result.Attempts) != 2 {
		t.Fatalf("result=%+v calls=%v error=%v", result, calls, err)
	}
}

func TestInternalFetchNeverResolvesOrSendsURLToRemoteProvider(t *testing.T) {
	settings := Settings{Fetch: FetchSettings{Routes: []RouteRef{{Kind: "provider", ID: "1"}, {Kind: "builtin", ID: "http"}}, MaxBytes: 2 << 20, TimeoutSeconds: 20, MaxRedirects: 3, AllowedInternalHosts: []string{"internal.example"}}}
	count := 0
	router := Router{ClassifyURL: func(context.Context, string, []string) (bool, error) { return true, nil }, Source: sourceFixture{settings: settings, resolve: func(_ context.Context, route RouteRef, _ Operation) (Adapter, error) {
		count++
		if route.Kind != "builtin" {
			t.Fatal("private URL reached remote configuration")
		}
		return adapterFixture{fetch: func(_ context.Context, r FetchRequest) (FetchResult, error) {
			if r.URL != "https://internal.example/page" {
				t.Fatal("URL rewritten")
			}
			return FetchResult{Content: "private text"}, nil
		}}, nil
	}}}
	result, err := router.Fetch(t.Context(), permit(), "https://internal.example/page")
	if err != nil || count != 1 || result.Route.Kind != "builtin" {
		t.Fatalf("result=%+v calls=%d error=%v", result, count, err)
	}
	router.ClassifyURL = func(context.Context, string, []string) (bool, error) {
		return false, Fail("WEB_ACCESS_TARGET_NOT_ALLOWED")
	}
	_, err = router.Fetch(t.Context(), permit(), "https://internal.example/page")
	if err == nil || count != 1 {
		t.Fatal("target rejection attempted fallback")
	}
}

func TestCancellationAndExhaustedPermitDoNotCallProvider(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	router := Router{Source: sourceFixture{settings: Settings{Search: SearchSettings{Routes: []RouteRef{{Kind: "provider", ID: "1"}}, MaxResults: 5}}, resolve: func(context.Context, RouteRef, Operation) (Adapter, error) {
		t.Fatal("cancelled operation dispatched")
		return nil, nil
	}}}
	if _, err := router.Search(ctx, permit(), "query"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	p := permit()
	p.Deadline = time.Now().Add(-time.Second)
	if _, err := router.Search(t.Context(), p, "query"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
}
