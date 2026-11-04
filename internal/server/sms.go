package server

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/sms"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerSMS(api *gin.RouterGroup, o Options) {
	s := &sms.Service{Identity: o.Identity, Cipher: o.Installer.SMSSecret, ETag: o.Installer.SMSETag, Store: func() (identity.Store, error) {
		st, ok := o.Installer.Backend().(identity.Store)
		if !ok {
			return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
		}
		return st, nil
	}}
	finish := func(c *gin.Context, r sms.Result, a *identity.Auth, e error, status int) {
		if !collaborationFinish(c, o, a, e) {
			return
		}
		if r.Tag != "" {
			c.Header("ETag", r.Tag)
		}
		if status == 204 {
			c.Status(204)
			return
		}
		httpx.Data(c, status, r.Data)
	}
	base := "/admin/sms"
	for _, kind := range []string{"profiles", "templates", "send-logs", "template-engines"} {
		api.GET(base+"/"+kind, func(c *gin.Context) {
			f, ok := smsFilter(c)
			if !ok {
				return
			}
			r, a, e := s.List(c.Request.Context(), rawSession(c), kind, f)
			finish(c, r, a, e, 200)
		})
	}
	api.POST(base+"/profiles", func(c *gin.Context) {
		var w sms.ProfileWrite
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Profile(c.Request.Context(), rawSession(c), 0, "create", "", w, metadata(c))
		finish(c, r, a, e, 201)
	})
	for _, route := range []struct{ method, path, op string }{{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"}, {"PUT", "/authentication", "authentication"}, {"GET", "/diagnostics", "diagnostics"}} {
		api.Handle(route.method, base+"/profiles/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok {
				return
			}
			var w sms.ProfileWrite
			if route.op == "update" {
				if !httpx.Decode(c, &w) {
					return
				}
			}
			if route.op == "authentication" {
				var auth sms.Authentication
				if !httpx.Decode(c, &auth) {
					return
				}
				w.Authentication = &auth
			}
			r, a, e := s.Profile(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), w, metadata(c))
			status := 200
			if route.op == "delete" {
				status = 204
			}
			finish(c, r, a, e, status)
		})
	}
	api.POST(base+"/templates", func(c *gin.Context) {
		var w sms.Template
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Template(c.Request.Context(), rawSession(c), 0, "create", "", w, metadata(c))
		finish(c, r, a, e, 201)
	})
	api.POST(base+"/templates/preview", func(c *gin.Context) {
		var w sms.PreviewInput
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Preview(c.Request.Context(), rawSession(c), w)
		finish(c, r, a, e, 200)
	})
	for _, route := range []struct{ method, path, op string }{{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"}, {"GET", "/diagnostics", "diagnostics"}} {
		api.Handle(route.method, base+"/templates/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok {
				return
			}
			var w sms.Template
			if route.op == "update" {
				if !httpx.Decode(c, &w) {
					return
				}
			}
			r, a, e := s.Template(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), w, metadata(c))
			status := 200
			if route.op == "delete" {
				status = 204
			}
			finish(c, r, a, e, status)
		})
	}
	api.GET(base+"/send-logs/:id", func(c *gin.Context) {
		id, ok := collaborationID(c, "id")
		if !ok {
			return
		}
		r, a, e := s.Log(c.Request.Context(), rawSession(c), id)
		finish(c, r, a, e, 200)
	})
	api.POST(base+"/profiles/:id/test", func(c *gin.Context) {
		id, ok := collaborationID(c, "id")
		if !ok {
			return
		}
		var w sms.TestInput
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Test(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w, metadata(c))
		finish(c, r, a, e, 200)
	})
	api.POST(base+"/templates/:id/simulate", func(c *gin.Context) {
		id, ok := collaborationID(c, "id")
		if !ok {
			return
		}
		var w struct {
			Parameters map[string]any `json:"parameters"`
		}
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Simulate(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w.Parameters, metadata(c))
		finish(c, r, a, e, 200)
	})
	api.GET(base+"/providers", func(c *gin.Context) {
		a, e := o.Identity.AdminAccess(c.Request.Context(), rawSession(c), nil)
		finish(c, sms.Result{Data: sms.ProviderCatalog()}, a, e, 200)
	})
}

func smsFilter(c *gin.Context) (sms.Filter, bool) {
	f := sms.Filter{Page: 1, PageSize: 20}
	for key, values := range c.Request.URL.Query() {
		if len(values) != 1 {
			httpx.Write(c, httpx.Invalid(key, "duplicate"))
			return f, false
		}
		v := values[0]
		switch key {
		case "page", "page_size":
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || key == "page_size" && n > 100 || n > 1000000 {
				httpx.Write(c, httpx.Invalid(key, "invalid_value"))
				return f, false
			}
			if key == "page" {
				f.Page = n
			} else {
				f.PageSize = n
			}
		case "q":
			if len(v) > 256 {
				httpx.Write(c, httpx.Invalid(key, "too_long"))
				return f, false
			}
			f.Query = v
		case "status":
			switch v {
			case "", "enabled", "disabled", "accepted", "rejected", "unknown", "failed_before_submit", "in_progress":
				f.Status = v
			default:
				httpx.Write(c, httpx.Invalid(key, "invalid_value"))
				return f, false
			}
		case "profile_id", "template_id", "actor_user_id":
			n, e := strconv.ParseUint(v, 10, 64)
			if e != nil || n == 0 {
				httpx.Write(c, httpx.Invalid(key, "invalid_id"))
				return f, false
			}
			switch key {
			case "profile_id":
				f.ProfileID = n
			case "template_id":
				f.TemplateID = n
			case "actor_user_id":
				f.ActorID = n
			}
		case "from", "to":
			n, e := time.Parse(time.RFC3339, v)
			if e != nil || n.Year() < 1000 || n.Year() > 9999 {
				httpx.Write(c, httpx.Invalid(key, "invalid_time"))
				return f, false
			}
			if key == "from" {
				f.From = &n
			} else {
				f.To = &n
			}
		default:
			httpx.Write(c, httpx.Invalid(key, "unsupported"))
			return f, false
		}
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		httpx.Write(c, httpx.Invalid("to", "invalid_range"))
		return f, false
	}
	return f, true
}
