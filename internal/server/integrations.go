package server

import (
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func webhookRequest(r *http.Request) bool {
	const prefix = "/api/v1/webhooks/gitlab/"
	if r.Method != "POST" || !strings.HasPrefix(r.URL.Path, prefix) {
		return false
	}
	id := strings.TrimPrefix(r.URL.Path, prefix)
	if id == "" || id[0] == '0' {
		return false
	}
	for _, c := range id {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
func integrationInput(c *gin.Context, input any) (any, bool) {
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
func registerIntegrations(api *gin.RouterGroup, o Options) {
	s := &i.Service{Identity: o.Identity, Cipher: o.Installer.IntegrationSecret, ETag: o.Installer.IntegrationETag, PublicURL: o.Runtime.Origin(), Store: func() (identity.Store, error) {
		st, ok := o.Installer.Backend().(identity.Store)
		if !ok {
			return nil, httpx.E(503, "SERVICE_UNAVAILABLE", "系统尚未就绪")
		}
		return st, nil
	}}
	if o.Events != nil {
		s.ReceiveEvent = o.Events.ReceiveGitLab
	}
	registerProjectRepositories(api, o, s)
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
	api.GET("/service-types", func(c *gin.Context) {
		if !noQuery(c) {
			return
		}
		a, err := o.Identity.BusinessAccess(c.Request.Context(), rawSession(c), nil, func(identity.Tx, *identity.Auth) error { return nil })
		finish(c, i.Result{Data: gin.H{"items": i.Types()}}, a, err, 200)
	})
	api.GET("/service-connections", func(c *gin.Context) {
		if !noQuery(c) {
			return
		}
		r, a, err := s.List(c.Request.Context(), rawSession(c), false)
		finish(c, r, a, err, 200)
	})
	api.GET("/admin/robots/:robot_id/service-connections", func(c *gin.Context) {
		if !noQuery(c) {
			return
		}
		id, ok := collaborationID(c, "robot_id")
		if !ok {
			return
		}
		r, a, err := s.RobotConnections(c.Request.Context(), rawSession(c), id)
		finish(c, r, a, err, 200)
	})
	for _, route := range []struct{ path, kind string }{{"/admin/service-connections", "platform"}, {"/projects/:id/service-connections", "project"}, {"/teams/:id/service-connections", "team"}} {
		api.GET(route.path, func(c *gin.Context) {
			if !noQuery(c) {
				return
			}
			ctx := c.Request.Context()
			if route.kind != "platform" {
				id, ok := collaborationID(c, "id")
				if !ok {
					return
				}
				ctx = i.WithScope(ctx, route.kind, id)
			}
			r, a, err := s.List(ctx, rawSession(c), route.kind == "platform")
			finish(c, r, a, err, 200)
		})
	}
	for _, kind := range []string{"gitlab", "jenkins", "openobserve", "elasticsearch", "mysql", "postgresql"} {
		s := s.ForType(kind)
		base := "/admin/service-connections/" + kind
		verifyLimiter := newLimiter(20, time.Minute)
		allowVerify := func(c *gin.Context) bool {
			if !verifyLimiter.Allow(c.ClientIP()) {
				c.Header("Retry-After", "60")
				httpx.Write(c, httpx.E(429, "RATE_LIMITED", "验证过于频繁"))
				return false
			}
			return true
		}
		for _, prefix := range []string{base, "/projects/:id/service-connections/" + kind} {
			routes := api.Group(prefix, integrationScopeMiddleware)
			routes.GET("", func(c *gin.Context) {
				if !noQuery(c) {
					return
				}
				r, a, err := s.List(c.Request.Context(), rawSession(c), true)
				finish(c, r, a, err, 200)
			})
			routes.POST("", func(c *gin.Context) {
				var w i.ConnectionCreate
				if !httpx.Decode(c, &w) {
					return
				}
				r, a, err := s.Create(c.Request.Context(), rawSession(c), w, metadata(c))
				finish(c, r, a, err, 201)
			})
			for _, route := range []struct{ method, path, op string }{
				{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"},
				{"GET", "/diagnostics", "diagnostics"},
			} {
				routes.Handle(route.method, "/:connection_id"+route.path, func(c *gin.Context) {
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
					}
					input, ok = integrationInput(c, input)
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
			routes.POST("/:connection_id/test", func(c *gin.Context) {
				if !noQuery(c) {
					return
				}
				id, ok := collaborationID(c, "connection_id")
				if !ok {
					return
				}
				if _, ok = integrationInput(c, &struct{}{}); !ok {
					return
				}
				if !allowVerify(c) {
					return
				}
				r, a, err := s.Verify(c.Request.Context(), rawSession(c), id, 0, integrationScope(c), c.GetHeader("If-Match"))
				finish(c, r, a, err, 200)
			})

			if kind == "gitlab" {
				webhook := "/:connection_id/webhook"
				for _, route := range []struct{ method, path, op string }{
					{"GET", "", "get"}, {"PATCH", "", "update"},
					{"PUT", "/verification", "verification"}, {"POST", "/verification/generate", "generate"}, {"GET", "/receiver", "receiver"}, {"GET", "/diagnostics", "diagnostics"},
				} {
					routes.Handle(route.method, webhook+route.path, func(c *gin.Context) {
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
							input = &i.WebhookWrite{}
						case "verification":
							input = &i.VerificationWrite{}
						case "generate":
							input = &struct{}{}
						}
						input, ok = integrationInput(c, input)
						if !ok {
							return
						}
						r, a, err := s.Webhook(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), input, metadata(c))
						finish(c, r, a, err, 200)
					})
				}
			}

		}
		api.GET(base+"/:connection_id/grants", func(c *gin.Context) {
			if !noQuery(c) {
				return
			}
			id, ok := collaborationID(c, "connection_id")
			if !ok {
				return
			}
			r, a, err := s.Grants(c.Request.Context(), rawSession(c), id, i.CredentialOwnership{}, "", nil, metadata(c))
			finish(c, r, a, err, 200)
		})
		api.PUT(base+"/:connection_id/grants/:subject_kind/:subject_id", func(c *gin.Context) {
			if !noQuery(c) {
				return
			}
			id, ok := collaborationID(c, "connection_id")
			if !ok {
				return
			}
			subject, ok := collaborationID(c, "subject_id")
			if !ok {
				return
			}
			var w i.GrantWrite
			if !httpx.Decode(c, &w) {
				return
			}
			if w.Enabled == nil {
				httpx.Write(c, httpx.Invalid("enabled", "required"))
				return
			}
			r, a, err := s.Grants(c.Request.Context(), rawSession(c), id, i.CredentialOwnership{Type: c.Param("subject_kind"), Owner: subject}, c.GetHeader("If-Match"), w.Enabled, metadata(c))
			finish(c, r, a, err, 200)
		})
		for _, group := range []struct{ path, ownership string }{{base, "platform"}, {"/me/service-connections/" + kind, "personal"}, {"/projects/:id/service-connections/" + kind, "project"}, {"/admin/robots/:robot_id/service-connections/" + kind, "robot"}} {
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
					if owner.Type == "robot" {
						owner.Owner, ok = collaborationID(c, "robot_id")
						if !ok {
							return
						}
					}
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
					input, ok = integrationInput(c, input)
					if !ok {
						return
					}
					if route.op == "verify" {
						if !allowVerify(c) {
							return
						}
						r, a, err := s.Verify(c.Request.Context(), rawSession(c), id, cid, owner, c.GetHeader("If-Match"))
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
	webhookLimiter := newLimiter(120, time.Minute)
	api.POST("/webhooks/gitlab/:connection_id", func(c *gin.Context) {
		if !webhookLimiter.Allow(c.ClientIP()) {
			c.Header("Retry-After", "60")
			httpx.Write(c, httpx.E(429, "RATE_LIMITED", "Webhook 请求过于频繁"))
			return
		}
		id, ok := collaborationID(c, "connection_id")
		if !ok {
			return
		}
		if c.ContentType() != "application/json" {
			httpx.Write(c, httpx.E(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 JSON 请求"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			httpx.Write(c, httpx.E(413, "PAYLOAD_TOO_LARGE", "请求内容过大"))
			return
		}
		d, err := s.Receive(c.Request.Context(), id, c.Request.Header, body)
		if err != nil {
			httpx.Write(c, err)
			return
		}
		result := gin.H{"status": d.Status}
		httpx.Data(c, 200, result)
	})
}

func integrationScope(c *gin.Context) i.CredentialOwnership {
	if c.Param("id") != "" {
		id, _ := collaborationID(c, "id")
		return i.CredentialOwnership{Type: "project", Owner: id}
	}
	return i.CredentialOwnership{Type: "platform"}
}

func integrationScopeMiddleware(c *gin.Context) {
	if c.Param("id") != "" {
		id, ok := collaborationID(c, "id")
		if !ok {
			c.Abort()
			return
		}
		c.Request = c.Request.WithContext(i.WithScope(c.Request.Context(), "project", id))
	}
	c.Next()
}
