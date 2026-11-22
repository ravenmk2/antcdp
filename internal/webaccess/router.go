package webaccess

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync/atomic"

	"time"
	"unicode/utf8"

	"golang.org/x/sync/errgroup"
)

type Router struct {
	Source Source
	// ClassifyURL validates the URL and DNS policy. Internal=true means only
	// the explicitly selected builtin reader may receive this URL.
	ClassifyURL func(context.Context, string, []string) (internal bool, err error)
}

func prepare(ctx context.Context, permit Permit, maxCalls int) (context.Context, context.CancelFunc, error) {
	if permit.Deadline.IsZero() || permit.MaxCalls < 1 || permit.MaxCalls > maxCalls {
		return nil, nil, Fail("WEB_ACCESS_INVALID_PERMIT")
	}
	if !time.Now().Before(permit.Deadline) {
		return nil, nil, context.DeadlineExceeded
	}
	bounded, cancel := context.WithDeadline(ctx, permit.Deadline)
	return bounded, cancel, nil
}

func (r *Router) Search(ctx context.Context, permit Permit, query string) (SearchResult, error) {
	return r.SearchBatch(ctx, permit, []string{query})
}

func (r *Router) SearchBatch(ctx context.Context, permit Permit, queries []string) (SearchResult, error) {
	result := SearchResult{Results: []SearchEntry{}, Attempts: []Attempt{}}
	if r.Source == nil || len(queries) == 0 || len(queries) > 10 {
		return result, Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	var unique []string
	for _, q := range queries {
		q = strings.TrimSpace(q)
		if q == "" || !utf8.ValidString(q) || utf8.RuneCountInString(q) > 128 {
			return result, Fail("WEB_ACCESS_INVALID_REQUEST")
		}
		if !slices.Contains(unique, q) {
			unique = append(unique, q)
		}
	}
	ctx, cancel, err := prepare(ctx, permit, 10)
	if err != nil {
		return result, err
	}
	defer cancel()
	settings, err := r.Source.RuntimeSettings(ctx)
	if err != nil {
		return result, err
	}
	config := settings.Search
	if config.MaxResults < 1 || config.MaxResults > 20 || len(config.Routes) > 3 {
		return result, Fail("WEB_ACCESS_INVALID_CONFIGURATION")
	}
	if len(config.Routes) == 0 {
		return result, Fail("WEB_ACCESS_NOT_CONFIGURED")
	}
	var extra atomic.Int32
	budget := min(permit.MaxCalls, max(3, len(unique)))
	if budget < len(unique) {
		return result, Fail("WEB_ACCESS_CALL_BUDGET_EXCEEDED")
	}
	extra.Store(int32(budget - len(unique)))
	group, ctx := errgroup.WithContext(ctx)
	parts := make([]SearchResult, len(unique))
	for i, q := range unique {
		group.Go(func() error {
			var e error
			parts[i], e = r.searchRoutes(ctx, config, q, &extra)
			return e
		})
	}
	err = group.Wait()
	for i, part := range parts {
		for j := range part.Attempts {
			part.Attempts[j].Query = unique[i]
		}
		result.Attempts = append(result.Attempts, part.Attempts...)
		result.Truncated = result.Truncated || part.Truncated
	}
	if err != nil {
		return result, err
	}
	if len(parts) == 1 {
		result.Route = parts[0].Route
	}
	seen := map[string]bool{}
	for rank := 0; ; rank++ {
		found := false
		for _, part := range parts {
			if rank >= len(part.Results) {
				continue
			}
			found = true
			entry := part.Results[rank]
			if seen[entry.URL] {
				continue
			}
			if len(result.Results) == config.MaxResults {
				result.Truncated = true
				return result, nil
			}
			seen[entry.URL] = true
			result.Results = append(result.Results, entry)
		}
		if !found {
			return result, nil
		}
	}
}

func (r *Router) searchRoutes(ctx context.Context, config SearchSettings, query string, extra *atomic.Int32) (SearchResult, error) {
	var result SearchResult
	var last error
	for i, route := range config.Routes {
		if i > 0 && extra.Add(-1) < 0 {
			return result, Fail("WEB_ACCESS_CALL_BUDGET_EXCEEDED")
		}
		if err := ctx.Err(); err != nil {
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
			value, resolveErr = adapter.Search(ctx, SearchRequest{Query: query, MaxResults: config.MaxResults})
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
	ctx, cancel, err := prepare(ctx, permit, 3)
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
