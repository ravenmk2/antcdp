package server

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/webaccess"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func writeWebAccessResult(c *gin.Context, o Options, result *webaccess.Result, err error) {
	if err != nil {
		httpx.Write(c, err)
		return
	}
	if result == nil {
		httpx.Write(c, httpx.E(500, "INTERNAL_ERROR", "网络检索结果不可用"))
		return
	}
	setSession(c, o, rawSession(c), result.Auth)
	if result.Tag != "" {
		c.Header("ETag", result.Tag)
	}
	if result.Location != "" {
		c.Header("Location", result.Location)
	}
	status := result.Status
	if status == 0 {
		status = 200
	}
	if status == 204 {
		c.Status(status)
	} else if result.Pagination != nil {
		c.JSON(status, gin.H{"data": result.Data, "pagination": result.Pagination})
	} else {
		httpx.Data(c, status, result.Data)
	}
}
func registerWebAccess(api *gin.RouterGroup, o Options) {
	s := o.WebAccess
	base := api.Group("/admin/web-access")
	base.Use(func(c *gin.Context) {
		if s == nil {
			httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "网络检索尚未就绪"))
			return
		}
		c.Request = c.Request.WithContext(webaccess.WithMetadata(c.Request.Context(), metadata(c)))
		c.Next()
	})
	finish := func(c *gin.Context, r *webaccess.Result, e error) { writeWebAccessResult(c, o, r, e) }
	base.GET("/provider-types", func(c *gin.Context) {
		if !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		r, e := s.ProviderTypes(c.Request.Context(), rawSession(c))
		finish(c, r, e)
	})
	base.GET("/providers", func(c *gin.Context) {
		q, ok := modelQuery(c, "page", "page_size", "q", "provider_type", "enabled", "operation")
		if !ok || !modelEmptyBody(c) {
			return
		}
		v := webaccess.Query{Q: q.Get("q"), ProviderType: q.Get("provider_type"), Operation: q.Get("operation")}
		for key, target := range map[string]*int{"page": &v.Page, "page_size": &v.PageSize} {
			if q.Has(key) {
				n, e := strconv.Atoi(q.Get(key))
				if e != nil || strconv.Itoa(n) != q.Get(key) || n < 1 {
					httpx.Write(c, httpx.Invalid(key, "invalid_format"))
					return
				}
				*target = n
			}
		}
		if q.Has("enabled") {
			value := q.Get("enabled")
			if value != "true" && value != "false" {
				httpx.Write(c, httpx.Invalid("enabled", "invalid_format"))
				return
			}
			b := value == "true"
			v.Enabled = &b
		}
		r, e := s.ListProviders(c.Request.Context(), rawSession(c), v)
		finish(c, r, e)
	})
	base.POST("/providers", func(c *gin.Context) {
		var v webaccess.ProviderCreate
		if !modelNoQuery(c) || !httpx.DecodeStrict(c, &v, 64<<10) {
			return
		}
		r, e := s.CreateProvider(c.Request.Context(), rawSession(c), v)
		finish(c, r, e)
	})
	for _, route := range []struct{ method, path, action string }{{"GET", "", "get"}, {"PATCH", "", "patch"}, {"DELETE", "", "delete"}, {"PUT", "/authentication", "authentication"}, {"POST", "/test", "probe"}, {"GET", "/diagnostics", "diagnostics"}} {
		base.Handle(route.method, "/providers/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok {
				return
			}
			operation := ""
			if route.action == "diagnostics" {
				q, ok := modelQuery(c, "operation")
				if !ok {
					return
				}
				operation = q.Get("operation")
				if operation != "search" && operation != "fetch" {
					httpx.Write(c, httpx.Invalid("operation", "unsupported"))
					return
				}
			} else if !modelNoQuery(c) {
				return
			}
			ctx, raw, tag := c.Request.Context(), rawSession(c), c.GetHeader("If-Match")
			var r *webaccess.Result
			var e error
			switch route.action {
			case "patch":
				var v webaccess.ProviderPatch
				if !httpx.DecodeStrict(c, &v, 64<<10) {
					return
				}
				r, e = s.PatchProvider(ctx, raw, id, tag, v)
			case "authentication":
				var v webaccess.AuthenticationWrite
				if !httpx.DecodeStrict(c, &v, 64<<10) {
					return
				}
				r, e = s.UpdateAuthentication(ctx, raw, id, tag, v)
			case "probe":
				var v webaccess.ProbeWrite
				if !httpx.DecodeStrict(c, &v, 64<<10) {
					return
				}
				r, e = s.TestProvider(ctx, raw, id, tag, v)
			default:
				if !modelEmptyBody(c) {
					return
				}
				switch route.action {
				case "get":
					r, e = s.GetProvider(ctx, raw, id)
				case "delete":
					r, e = s.DeleteProvider(ctx, raw, id, tag)
				case "diagnostics":
					r, e = s.GetDiagnostics(ctx, raw, id, operation)
				}
			}
			finish(c, r, e)
		})
	}
	base.GET("/settings", func(c *gin.Context) {
		if !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		r, e := s.GetSettings(c.Request.Context(), rawSession(c))
		finish(c, r, e)
	})
	base.PUT("/settings", func(c *gin.Context) {
		var v webaccess.SettingsWrite
		if !modelNoQuery(c) || !httpx.DecodeStrict(c, &v, 64<<10) {
			return
		}
		r, e := s.PutSettings(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), v.Settings)
		finish(c, r, e)
	})
	base.GET("/settings/state", func(c *gin.Context) {
		if !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		r, e := s.GetState(c.Request.Context(), rawSession(c))
		finish(c, r, e)
	})
}
