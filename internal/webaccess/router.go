package webaccess

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

type Router struct {
	Source Source
	// ClassifyURL validates the URL and DNS policy. Internal=true means only
	// the explicitly selected builtin reader may receive this URL.
	ClassifyURL func(context.Context, string, []string) (internal bool, err error)
}

func prepare(ctx context.Context, permit Permit) (context.Context, context.CancelFunc, error) {
	if permit.Deadline.IsZero() || permit.MaxCalls < 1 || permit.MaxCalls > 3 {
		return nil, nil, Fail("WEB_ACCESS_INVALID_PERMIT")
	}
	if !time.Now().Before(permit.Deadline) {
		return nil, nil, context.DeadlineExceeded
	}
	bounded, cancel := context.WithDeadline(ctx, permit.Deadline)
	return bounded, cancel, nil
}

func (r *Router) Search(ctx context.Context, permit Permit, query string) (SearchResult, error) {
	result := SearchResult{Results: []SearchEntry{}, Attempts: []Attempt{}}
	if r.Source == nil || !utf8.ValidString(query) || strings.TrimSpace(query) == "" || utf8.RuneCountInString(query) > 128 {
		return result, Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	ctx, cancel, err := prepare(ctx, permit)
	if err != nil {
		return result, err
	}
	defer cancel()
	settings, err := r.Source.RuntimeSettings(ctx)
	if err != nil {
		return result, err
	}
	if settings.Search.MaxResults < 1 || settings.Search.MaxResults > 20 || len(settings.Search.Routes) > 3 {
		return result, Fail("WEB_ACCESS_INVALID_CONFIGURATION")
	}
	if len(settings.Search.Routes) == 0 {
		return result, Fail("WEB_ACCESS_NOT_CONFIGURED")
	}
	var last error
	for i, route := range settings.Search.Routes {
		if i >= permit.MaxCalls {
			return result, Fail("WEB_ACCESS_CALL_BUDGET_EXCEEDED")
		}
		if err = ctx.Err(); err != nil {
			return result, err
		}
		if route.Kind != "provider" {
			return result, Fail("WEB_ACCESS_INVALID_CONFIGURATION")
		}
		adapter, resolveErr := r.Source.Resolve(ctx, route, Search)
		if resolveErr == nil && adapter == nil {
			resolveErr = Fail("WEB_ACCESS_INVALID_CONFIGURATION")
		}
		if resolveErr == nil {
			var value SearchResult
			value, resolveErr = adapter.Search(ctx, SearchRequest{Query: query, MaxResults: settings.Search.MaxResults})
			if resolveErr == nil {
				if value.Results == nil {
					value.Results = []SearchEntry{}
				}
				value.Route = route
				value.Attempts = append(result.Attempts, attempt(route, nil))
				return value, nil // An empty success never triggers a backup provider.
			}
		}
		result.Attempts = append(result.Attempts, attempt(route, resolveErr))
		last = resolveErr
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if !CanFallback(resolveErr) {
			return result, resolveErr
		}
	}
	return result, last
}

func (r *Router) Fetch(ctx context.Context, permit Permit, rawURL string) (FetchResult, error) {
	result := FetchResult{RequestedURL: rawURL, Attempts: []Attempt{}}
	if r.Source == nil || r.ClassifyURL == nil {
		return result, Fail("WEB_ACCESS_NOT_CONFIGURED")
	}
	ctx, cancel, err := prepare(ctx, permit)
	if err != nil {
		return result, err
	}
	defer cancel()
	settings, err := r.Source.RuntimeSettings(ctx)
	if err != nil {
		return result, err
	}
	f := settings.Fetch
	if f.MaxBytes < 64<<10 || f.MaxBytes > 10<<20 || f.TimeoutSeconds < 1 || f.TimeoutSeconds > 60 || f.MaxRedirects < 0 || f.MaxRedirects > 5 || len(f.Routes) > 3 {
		return result, Fail("WEB_ACCESS_INVALID_CONFIGURATION")
	}
	ctx, timeout := context.WithTimeout(ctx, time.Duration(f.TimeoutSeconds)*time.Second)
	defer timeout()
	internal, err := r.ClassifyURL(ctx, rawURL, f.AllowedInternalHosts)
	if err != nil {
		return result, err
	}
	if len(f.Routes) == 0 {
		return result, Fail("WEB_ACCESS_NOT_CONFIGURED")
	}
	calls := 0
	var last error
	for _, route := range f.Routes {
		if internal && route.Kind != "builtin" {
			continue
		} // Never send private URLs to a third party.
		if err = ctx.Err(); err != nil {
			return result, err
		}
		if calls >= permit.MaxCalls {
			return result, Fail("WEB_ACCESS_CALL_BUDGET_EXCEEDED")
		}
		calls++
		adapter, resolveErr := r.Source.Resolve(ctx, route, Fetch)
		if resolveErr == nil && adapter == nil {
			resolveErr = Fail("WEB_ACCESS_INVALID_CONFIGURATION")
		}
		if resolveErr == nil {
			var value FetchResult
			value, resolveErr = adapter.Fetch(ctx, FetchRequest{URL: rawURL, MaxBytes: f.MaxBytes, MaxRedirects: f.MaxRedirects, AllowedInternalHosts: f.AllowedInternalHosts})
			if resolveErr == nil {
				value.Route = route
				value.RequestedURL = rawURL
				value.Attempts = append(result.Attempts, attempt(route, nil))
				return value, nil
			}
		}
		result.Attempts = append(result.Attempts, attempt(route, resolveErr))
		last = resolveErr
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if !CanFallback(resolveErr) {
			return result, resolveErr
		}
	}
	if last == nil {
		last = Fail("WEB_ACCESS_TARGET_NOT_ALLOWED")
	}
	return result, last
}

func attempt(route RouteRef, err error) Attempt {
	if err == nil {
		return Attempt{Route: route, Status: "succeeded", Outcome: "known"}
	}
	code, certainty := "WEB_ACCESS_FAILED", "unknown"
	var failure *Failure
	if errors.As(err, &failure) {
		code = failure.Code
		if !failure.Unknown {
			certainty = "known"
		}
	}
	return Attempt{Route: route, Status: "failed", Reason: &code, Outcome: certainty}
}
