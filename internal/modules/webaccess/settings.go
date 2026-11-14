package webaccess

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

func (s *Service) ProviderTypes(ctx context.Context, raw string) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, _ Repository, _ *identity.Auth, out *Result) error {
		items := []any{}
		for _, p := range []struct{ kind, name, base string }{{"deepseek", "DeepSeek", "https://api.deepseek.com"}, {"glm", "GLM", "https://open.bigmodel.cn"}} {
			items = append(items, map[string]any{"provider_type": p.kind, "name": p.name, "supported_operations": capabilities(p.kind), "auth_methods": []string{"api_key"}, "configuration_schema": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"base_url", "timeout_seconds"}, "properties": map[string]any{"base_url": map[string]any{"type": "string", "format": "uri", "maxLength": 2048, "default": p.base}, "timeout_seconds": map[string]any{"type": "integer", "minimum": 1, "maximum": 60, "default": 15}}}})
		}
		out.Data = map[string]any{"items": items, "builtin_readers": []any{map[string]any{"id": "http", "name": "内置 HTTP 读取", "supported_operations": []string{"fetch"}}}}
		return nil
	})
}
func (s *Service) settings(row *SettingsRow) (*Settings, error) {
	if row == nil {
		return nil, integrity()
	}
	v := &Settings{Settings: runtime.Settings{Search: runtime.SearchSettings{MaxResults: row.MaxResults}, Fetch: runtime.FetchSettings{MaxBytes: row.MaxBytes, TimeoutSeconds: row.Timeout, MaxRedirects: row.MaxRedirects}}, Version: strings.Trim(s.tag("settings", 1, row.RowVersion), `"`)}
	if json.Unmarshal(row.SearchRoutes, &v.Search.Routes) != nil || json.Unmarshal(row.FetchRoutes, &v.Fetch.Routes) != nil || json.Unmarshal(row.InternalHosts, &v.Fetch.AllowedInternalHosts) != nil || NormalizeSettings(&v.Settings) != nil {
		return nil, integrity()
	}
	return v, nil
}
func (s *Service) GetSettings(ctx context.Context, raw string) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		row, e := r.Settings()
		if e != nil {
			return e
		}
		v, e := s.settings(row)
		if e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("settings", 1, row.RowVersion)
		return nil
	})
}
func (s *Service) PutSettings(ctx context.Context, raw, tag string, input runtime.Settings) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		row, e := r.Settings()
		if e != nil {
			return e
		}
		current, e := s.settings(row)
		if e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("settings", 1, row.RowVersion)); e != nil {
			return e
		}
		if e = NormalizeSettings(&input); e != nil {
			return e
		}
		ids := []uint64{}
		seen := map[uint64]bool{}
		for _, routes := range [][]runtime.RouteRef{input.Search.Routes, input.Fetch.Routes} {
			for _, route := range routes {
				if route.Kind == "provider" {
					id, _ := validID(route.ID)
					if !seen[id] {
						seen[id] = true
						ids = append(ids, id)
					}
				}
			}
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		providers := map[uint64]*Provider{}
		for _, id := range ids {
			p, err := r.Provider(id)
			if err != nil {
				return err
			}
			if err = s.provider(p); err != nil {
				return err
			}
			providers[id] = p
		}
		for _, g := range []struct {
			op     string
			routes []runtime.RouteRef
		}{{"search", input.Search.Routes}, {"fetch", input.Fetch.Routes}} {
			for _, route := range g.routes {
				if route.Kind == "provider" {
					id, _ := validID(route.ID)
					p := providers[id]
					if !supports(p.Type, g.op) {
						return httpx.E(422, "WEB_ACCESS_CAPABILITY_UNSUPPORTED", "提供商不支持所选能力")
					}
				}
			}
		}
		if !same(current.Settings, input) {
			row.SearchRoutes, e = json.Marshal(input.Search.Routes)
			if e != nil {
				return e
			}
			row.FetchRoutes, e = json.Marshal(input.Fetch.Routes)
			if e != nil {
				return e
			}
			row.InternalHosts, e = json.Marshal(input.Fetch.AllowedInternalHosts)
			if e != nil {
				return e
			}
			row.MaxResults = input.Search.MaxResults
			row.MaxBytes = input.Fetch.MaxBytes
			row.Timeout = input.Fetch.TimeoutSeconds
			row.MaxRedirects = input.Fetch.MaxRedirects
			row.RowVersion++
			row.UpdatedBy = &a.User.ID
			if e = r.SaveSettings(row); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "web_access_settings.update", "web_access_setting", 1); e != nil {
				return e
			}
		}
		v, e := s.settings(row)
		if e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("settings", 1, row.RowVersion)
		return nil
	})
}
func (s *Service) routeState(r Repository, route runtime.RouteRef, op string) (RouteState, error) {
	state := RouteState{Route: route}
	reason := ""
	if route.Kind == "builtin" {
		if route.ID != "http" || op != "fetch" {
			reason = "operation_unsupported"
		} else if s.Reader == nil {
			reason = "adapter_unavailable"
		}
	} else {
		id, e := validID(route.ID)
		if e != nil {
			return state, integrity()
		}
		p, e := r.Provider(id)
		if e != nil {
			return state, e
		}
		switch {
		case p == nil:
			reason = "adapter_unavailable"
		case !p.Enabled:
			reason = "provider_disabled"
		case !p.SecretValid || !p.HasSecret:
			reason = "secret_unavailable"
		case !supports(p.Type, op):
			reason = "operation_unsupported"
		case s.Adapter == nil:
			reason = "adapter_unavailable"
		default:
			if s.Cipher == nil {
				reason = "secret_unavailable"
			} else {
				cipher, e := r.Secret(id)
				if e != nil {
					return state, e
				}
				if _, e = s.Cipher(fmt.Sprintf("webaccess/provider/%d/authentication", id), cipher, false); e != nil {
					reason = "secret_unavailable"
				}
			}
		}
	}
	state.Available = reason == ""
	if reason != "" {
		state.Reason = &reason
	}
	return state, nil
}
func (s *Service) operationState(r Repository, routes []runtime.RouteRef, op string) (OperationState, error) {
	state := OperationState{Routes: []RouteState{}}
	for _, route := range routes {
		v, e := s.routeState(r, route, op)
		if e != nil {
			return state, e
		}
		state.Routes = append(state.Routes, v)
		state.Available = state.Available || v.Available
	}
	if !state.Available {
		reason := "not_configured"
		if len(state.Routes) > 0 && state.Routes[0].Reason != nil {
			reason = *state.Routes[0].Reason
		}
		state.Reason = &reason
	}
	return state, nil
}
func (s *Service) GetState(ctx context.Context, raw string) (*Result, error) {
	return s.access(ctx, raw, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		row, e := r.Settings()
		if e != nil {
			return e
		}
		v, e := s.settings(row)
		if e != nil {
			return e
		}
		var state State
		state.Search, e = s.operationState(r, v.Search.Routes, "search")
		if e != nil {
			return e
		}
		state.Fetch, e = s.operationState(r, v.Fetch.Routes, "fetch")
		if e != nil {
			return e
		}
		out.Data = state
		return nil
	})
}
func (s *Service) background(ctx context.Context, fn func(identity.Tx, Repository) error) error {
	if s.Store == nil || s.ETag == nil {
		return httpx.E(503, "SERVICE_UNAVAILABLE", "网络检索存储暂不可用")
	}
	store, e := s.Store()
	if e != nil {
		return e
	}
	return store.Transact(ctx, func(tx identity.Tx) error {
		r, e := repository(tx)
		if e != nil {
			return e
		}
		return fn(tx, r)
	})
}

// RuntimeSettings is a trusted internal port. Public users cannot call it as an
// unauthenticated search proxy; each caller authorizes its own business request.
func (s *Service) RuntimeSettings(ctx context.Context) (runtime.Settings, error) {
	var result runtime.Settings
	e := s.background(ctx, func(_ identity.Tx, r Repository) error {
		row, e := r.Settings()
		if e != nil {
			return e
		}
		v, e := s.settings(row)
		if e != nil {
			return e
		}
		result = v.Settings
		return nil
	})
	return result, e
}
func (s *Service) resolve(ctx context.Context, route runtime.RouteRef, op runtime.Operation) (runtime.Adapter, error) {
	var p *Provider
	var secret string
	e := s.background(ctx, func(_ identity.Tx, r Repository) error {
		st, e := s.routeState(r, route, string(op))
		if e != nil {
			return e
		}
		if !st.Available {
			return &runtime.Failure{Code: "WEB_ACCESS_" + strings.ToUpper(*st.Reason), Fallback: true}
		}
		if route.Kind == "builtin" {
			return nil
		}
		id, e := strconv.ParseUint(route.ID, 10, 64)
		if e != nil {
			return e
		}
		p, e = r.Provider(id)
		if e != nil {
			return e
		}
		if e = s.provider(p); e != nil {
			return e
		}
		cipher, e := r.Secret(id)
		if e != nil {
			return e
		}
		secret, e = s.Cipher(fmt.Sprintf("webaccess/provider/%d/authentication", id), cipher, false)
		return e
	})
	if e != nil {
		return nil, e
	}
	if route.Kind == "builtin" {
		return s.Reader, nil
	}
	return s.Adapter(ctx, *p, secret)
}
