package server

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerDingTalk(api *gin.RouterGroup, o Options) {
	s := &dingtalk.Service{Identity: o.Identity, Cipher: o.Installer.DingTalkSecret, ETag: o.Installer.DingTalkETag, Store: func() (identity.Store, error) {
		st, ok := o.Installer.Backend().(identity.Store)
		if !ok {
			return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
		}
		return st, nil
	}}
	finish := func(c *gin.Context, r dingtalk.Result, a *identity.Auth, e error, status int) {
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
	base := "/admin/dingtalk/robots"
	api.GET(base, func(c *gin.Context) {
		f := dingtalk.Filter{Page: 1, PageSize: 20}
		for key, values := range c.Request.URL.Query() {
			if len(values) != 1 {
				httpx.Write(c, httpx.Invalid(key, "duplicate"))
				return
			}
			v := values[0]
			switch key {
			case "page", "page_size":
				n, e := strconv.Atoi(v)
				if e != nil || n < 1 || n > 1000000 || key == "page_size" && n > 100 {
					httpx.Write(c, httpx.Invalid(key, "invalid_value"))
					return
				}
				if key == "page" {
					f.Page = n
				} else {
					f.PageSize = n
				}
			case "q":
				if len(v) > 256 {
					httpx.Write(c, httpx.Invalid(key, "too_long"))
					return
				}
				f.Query = v
			case "status":
				if v != "" && v != "enabled" && v != "disabled" {
					httpx.Write(c, httpx.Invalid(key, "invalid_value"))
					return
				}
				f.Status = v
			default:
				httpx.Write(c, httpx.Invalid(key, "unsupported"))
				return
			}
		}
		r, a, e := s.List(c.Request.Context(), rawSession(c), f)
		finish(c, r, a, e, 200)
	})
	api.POST(base, func(c *gin.Context) {
		var w dingtalk.Write
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Admin(c.Request.Context(), rawSession(c), 0, "create", "", w, metadata(c))
		finish(c, r, a, e, 201)
	})
	for _, route := range []struct{ method, path, op string }{{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"}, {"PUT", "/authentication", "authentication"}, {"GET", "/diagnostics", "diagnostics"}} {
		api.Handle(route.method, base+"/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok {
				return
			}
			var w dingtalk.Write
			if route.op == "update" {
				if !httpx.Decode(c, &w) {
					return
				}
			}
			if route.op == "authentication" {
				var auth dingtalk.Authentication
				if !httpx.Decode(c, &auth) {
					return
				}
				w.Authentication = &auth
			}
			r, a, e := s.Admin(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), w, metadata(c))
			status := 200
			if route.op == "delete" {
				status = 204
			}
			finish(c, r, a, e, status)
		})
	}
	api.POST(base+"/:id/test", func(c *gin.Context) {
		id, ok := collaborationID(c, "id")
		if !ok {
			return
		}
		var w dingtalk.TestInput
		if !httpx.Decode(c, &w) {
			return
		}
		r, a, e := s.Test(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w, metadata(c))
		finish(c, r, a, e, 200)
	})
}
