package server

import (
	"errors"
	"io"
	"reflect"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/remotehosts"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func remoteHostInput(c *gin.Context, input any) (any, bool) {
	if input == nil {
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1))
		if err != nil || len(body) != 0 {
			httpx.Write(c, httpx.Invalid("body", "unexpected_body"))
			return nil, false
		}
		return nil, true
	}
	if !httpx.Decode(c, input) {
		return nil, false
	}
	return reflect.ValueOf(input).Elem().Interface(), true
}
func registerRemoteHosts(api *gin.RouterGroup, o Options) {
	s := &i.Service{Identity: o.Identity, Cipher: o.Installer.RemoteHostSecret, ETag: o.Installer.RemoteHostETag, PublicURL: o.Runtime.Origin(), Store: func() (identity.Store, error) {
		st, ok := o.Installer.Backend().(identity.Store)
		if !ok {
			return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "系统尚未就绪")
		}
		return st, nil
	}}
	finish := func(c *gin.Context, r i.Result, a *identity.Auth, err error, status int) {
		var apiErr *httpx.Error
		if errors.As(err, &apiErr) && apiErr.Code == "RATE_LIMITED" && c.Writer.Header().Get("Retry-After") == "" {
			c.Header("Retry-After", "1")
		}
		if !collaborationFinish(c, o, a, err) {
			return
		}
		if r.Tag != "" {
			c.Header("ETag", r.Tag)
		}
		if r.CollectionTag != "" {
			c.Header("X-Collection-ETag", r.CollectionTag)
		}
		if r.Location != "" {
			location := r.Location
			if !strings.HasPrefix(location, "/") {
				location = strings.TrimRight(c.Request.URL.Path, "/") + "/" + location
			}
			c.Header("Location", location)
		}
		if status == 204 {
			c.Status(204)
			return
		}
		httpx.Data(c, status, r.Data)
	}
	noQuery := func(c *gin.Context) bool {
		if c.Request.URL.RawQuery != "" {
			httpx.Write(c, httpx.Invalid("query", "unsupported"))
			return false
		}
		return true
	}
	api.GET("/remote-hosts", func(c *gin.Context) {
		if !noQuery(c) {
			return
		}
		r, a, err := s.List(c.Request.Context(), rawSession(c), false)
		finish(c, r, a, err, 200)
	})
	{
		base, personal, project := "/admin/remote-hosts", "/me/remote-hosts", "/projects/:id/remote-hosts"
		api.GET(base, func(c *gin.Context) {
			if !noQuery(c) {
				return
			}
			r, a, err := s.List(c.Request.Context(), rawSession(c), true)
			finish(c, r, a, err, 200)
		})
		api.POST(base, func(c *gin.Context) {
			var w i.ConnectionCreate
			if !httpx.Decode(c, &w) {
				return
			}
			r, a, err := s.Create(c.Request.Context(), rawSession(c), w, metadata(c))
			finish(c, r, a, err, 201)
		})
		for _, route := range []struct{ method, path, op string }{
			{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"},
			{"GET", "/fallback-credential", "fallback"}, {"PUT", "/fallback-credential", "set_fallback"}, {"DELETE", "/fallback-credential", "clear_fallback"}, {"GET", "/diagnostics", "diagnostics"},
		} {
			api.Handle(route.method, base+"/:connection_id"+route.path, func(c *gin.Context) {
				if !noQuery(c) {
					return
				}
				id, ok := collaborationID(c, "connection_id")
				if !ok {
					return
				}
				var input any
				switch route.op {
				case "update":
					input = &i.ConnectionWrite{}
				case "set_fallback":
					input = &i.SelectionWrite{}
				}
				input, ok = remoteHostInput(c, input)
				if !ok {
					return
				}
				r, a, err := s.Admin(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), input, metadata(c))
				status := 200
				if route.method == "DELETE" {
					status = 204
				}
				finish(c, r, a, err, status)
			})
		}
		verifyLimiter := newLimiter(20, time.Minute)
		allowVerify := func(c *gin.Context) bool {
			if !verifyLimiter.Allow(c.ClientIP()) {
				c.Header("Retry-After", "60")
				httpx.Write(c, httpx.E(429, "RATE_LIMITED", "验证过于频繁"))
				return false
			}
			return true
		}
		api.POST(base+"/:connection_id/test", func(c *gin.Context) {
			if !noQuery(c) {
				return
			}
			id, ok := collaborationID(c, "connection_id")
			if !ok {
				return
			}
			if _, ok = remoteHostInput(c, &struct{}{}); !ok {
				return
			}
			if !allowVerify(c) {
				return
			}
			r, a, err := s.Verify(c.Request.Context(), rawSession(c), id, 0, i.CredentialOwnership{Type: "system"}, c.GetHeader("If-Match"), metadata(c))
			finish(c, r, a, err, 200)
		})
		for _, group := range []struct{ path, ownership string }{{base, "system"}, {personal, "personal"}, {project, "project"}} {
			prefix := group.path + "/:connection_id/credentials"
			for _, route := range []struct{ method, path, op string }{
				{"GET", "", "list"}, {"POST", "", "create"}, {"GET", "/preferred", "get_preferred"}, {"PUT", "/preferred", "preferred"}, {"DELETE", "/preferred", "clear_preferred"},
				{"GET", "/:credential_id", "get"}, {"PATCH", "/:credential_id", "update"}, {"DELETE", "/:credential_id", "delete"}, {"PUT", "/:credential_id/authentication", "authentication"}, {"GET", "/:credential_id/diagnostics", "diagnostics"}, {"POST", "/:credential_id/verify", "verify"},
			} {
				api.Handle(route.method, prefix+route.path, func(c *gin.Context) {
					if !noQuery(c) {
						return
					}
					id, ok := collaborationID(c, "connection_id")
					if !ok {
						return
					}
					owner := i.CredentialOwnership{Type: group.ownership}
					if owner.Type == "project" {
						owner.Owner, ok = collaborationID(c, "id")
						if !ok {
							return
						}
					}
					var cid uint64
					if c.Param("credential_id") != "" {
						cid, ok = collaborationID(c, "credential_id")
						if !ok {
							return
						}
					}
					var input any
					switch route.op {
					case "create":
						input = &i.CredentialCreate{}
					case "update":
						input = &i.CredentialWrite{}
					case "preferred":
						input = &i.SelectionWrite{}
					case "authentication":
						input = &i.Authentication{}
					case "verify":
						input = &struct{}{}
					}
					input, ok = remoteHostInput(c, input)
					if !ok {
						return
					}
					if route.op == "verify" {
						if !allowVerify(c) {
							return
						}
						r, a, err := s.Verify(c.Request.Context(), rawSession(c), id, cid, owner, c.GetHeader("If-Match"), metadata(c))
						finish(c, r, a, err, 200)
						return
					}
					r, a, err := s.Credentials(c.Request.Context(), rawSession(c), id, cid, owner, route.op, c.GetHeader("If-Match"), c.GetHeader("X-Collection-If-Match"), input, metadata(c))
					status := 200
					if route.op == "create" {
						status = 201
					}
					if route.method == "DELETE" {
						status = 204
					}
					finish(c, r, a, err, status)
				})
			}
		}
	}
}
