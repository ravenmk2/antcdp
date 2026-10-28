package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"io"
	"net/http"
	"strings"
	"time"
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
func registerIntegrations(api *gin.RouterGroup, o Options) {
	s := &i.Service{Identity: o.Identity, Cipher: o.Installer.IntegrationSecret, Store: func() (identity.Store, error) {
		st, ok := o.Installer.Backend().(identity.Store)
		if !ok {
			return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
		}
		return st, nil
	}}
	finish := func(c *gin.Context, result i.Result, a *identity.Auth, e error, status int) {
		if collaborationFinish(c, o, a, e) {
			if result.Tag != "" {
				c.Header("ETag", result.Tag)
			}
			httpx.Data(c, status, result.Data)
		}
	}
	api.GET("/integrations/types", func(c *gin.Context) {
		a, e := o.Identity.BusinessAccess(c.Request.Context(), rawSession(c), nil, func(identity.Tx, *identity.Auth) error { return nil })
		if collaborationFinish(c, o, a, e) {
			httpx.Data(c, 200, []gin.H{{"service_type": "gitlab", "name": "GitLab", "credentials": true, "webhook": true, "connection_test": true, "auth_methods": []string{"gitlab_access_token"}}})
		}
	})
	api.GET("/integrations", func(c *gin.Context) {
		r, a, e := s.List(c.Request.Context(), rawSession(c), false)
		finish(c, r, a, e, 200)
	})
	base := "/admin/integrations/gitlab"
	api.GET(base, func(c *gin.Context) {
		r, a, e := s.List(c.Request.Context(), rawSession(c), true)
		finish(c, r, a, e, 200)
	})
	api.POST(base, func(c *gin.Context) {
		var w i.Create
		if !collaborationBody(c, &w) {
			return
		}
		r, a, e := s.Create(c.Request.Context(), rawSession(c), w, metadata(c))
		finish(c, r, a, e, 201)
	})
	for _, route := range []struct{ method, path, op string }{
		{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"},
		{"GET", "/config", "config"}, {"PATCH", "/config", "update_config"},
		{"GET", "/default-credential", "default"}, {"PUT", "/default-credential", "set_default"}, {"DELETE", "/default-credential", "clear_default"},
		{"GET", "/diagnostics", "diagnostics"}, {"PUT", "/webhook-secret", "webhook_secret"}, {"POST", "/webhook-secret/generate", "generate_webhook"},
	} {
		api.Handle(route.method, base+"/:integration_id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "integration_id")
			if !ok {
				return
			}
			var input any
			switch route.op {
			case "update":
				input = &i.CommonWrite{}
			case "delete", "set_default":
				input = &i.Command{}
			case "update_config":
				input = &i.ConfigWrite{}
			case "webhook_secret":
				input = &i.SecretWrite{}
			}
			if input != nil && !collaborationBody(c, input) {
				return
			}
			switch v := input.(type) {
			case *i.CommonWrite:
				input = *v
			case *i.ConfigWrite:
				input = *v
			case *i.Command:
				input = *v
			case *i.SecretWrite:
				input = *v
			}
			r, a, e := s.Admin(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), input, metadata(c))
			finish(c, r, a, e, 200)
		})
	}
	verifyLimiter := newLimiter(20, time.Minute)
	api.POST(base+"/:integration_id/test", func(c *gin.Context) {
		id, ok := collaborationID(c, "integration_id")
		if !ok {
			return
		}
		if !verifyLimiter.Allow(c.ClientIP()) {
			httpx.Write(c, httpx.E(429, "RATE_LIMITED", "验证过于频繁"))
			return
		}
		r, a, e := s.Verify(c.Request.Context(), rawSession(c), id, 0, i.Scope{Type: "system"})
		finish(c, r, a, e, 200)
	})
	for _, group := range []struct{ path, scope string }{{base, "system"}, {"/me/integrations/gitlab", "personal"}, {"/projects/:id/integrations/gitlab", "project"}} {
		prefix := group.path + "/:integration_id/credentials"
		for _, route := range []struct{ method, path, op string }{{"GET", "", "list"}, {"POST", "", "create"}, {"PUT", "/preferred", "preferred"}, {"DELETE", "/preferred", "clear_preferred"}, {"GET", "/:credential_id", "get"}, {"PATCH", "/:credential_id", "update"}, {"DELETE", "/:credential_id", "delete"}, {"PUT", "/:credential_id/secret", "secret"}, {"GET", "/:credential_id/diagnostics", "diagnostics"}, {"POST", "/:credential_id/verify", "verify"}} {
			api.Handle(route.method, prefix+route.path, func(c *gin.Context) {
				id, ok := collaborationID(c, "integration_id")
				if !ok {
					return
				}
				scope := i.Scope{Type: group.scope}
				if scope.Type == "project" {
					scope.Owner, ok = collaborationID(c, "id")
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
				if route.op == "verify" {
					if !verifyLimiter.Allow(c.ClientIP()) {
						httpx.Write(c, httpx.E(429, "RATE_LIMITED", "验证过于频繁"))
						return
					}
					r, a, e := s.Verify(c.Request.Context(), rawSession(c), id, cid, scope)
					finish(c, r, a, e, 200)
					return
				}
				var input any
				switch route.op {
				case "create":
					input = &i.CredentialCreate{}
				case "update":
					input = &i.CredentialWrite{}
				case "delete", "preferred":
					input = &i.Command{}
				case "secret":
					input = &i.SecretWrite{}
				}
				if input != nil && !collaborationBody(c, input) {
					return
				}
				switch v := input.(type) {
				case *i.CredentialCreate:
					input = *v
				case *i.CredentialWrite:
					input = *v
				case *i.Command:
					input = *v
				case *i.SecretWrite:
					input = *v
				}
				r, a, e := s.Credentials(c.Request.Context(), rawSession(c), id, cid, scope, route.op, c.GetHeader("If-Match"), input, metadata(c))
				status := 200
				if route.op == "create" {
					status = 201
				}
				finish(c, r, a, e, status)
			})
		}
	}
	webhookLimiter := newLimiter(120, time.Minute)
	api.POST("/webhooks/gitlab/:integration_id", func(c *gin.Context) {
		if !webhookLimiter.Allow(c.ClientIP()) {
			httpx.Write(c, httpx.E(429, "RATE_LIMITED", "Webhook 请求过于频繁"))
			return
		}
		id, ok := collaborationID(c, "integration_id")
		if !ok {
			return
		}
		if c.ContentType() != "application/json" {
			httpx.Write(c, httpx.E(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 JSON 请求"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		body, e := io.ReadAll(c.Request.Body)
		if e != nil {
			httpx.Write(c, httpx.E(413, "PAYLOAD_TOO_LARGE", "请求内容过大"))
			return
		}
		d, e := s.Receive(c.Request.Context(), id, c.Request.Header, body)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		httpx.Data(c, 200, gin.H{"status": d.Status})
	})
}
