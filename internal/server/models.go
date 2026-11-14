package server

import (
	"io"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerModels(api *gin.RouterGroup, o Options) {
	s := o.Models
	finish := func(c *gin.Context, result *models.Result, err error) {
		if err != nil {
			httpx.Write(c, err)
			return
		}
		if result == nil {
			httpx.Write(c, httpx.E(500, "INTERNAL_ERROR", "模型管理结果不可用"))
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
	base := api.Group("/admin/models")
	base.Use(func(c *gin.Context) {
		if s == nil {
			httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "模型管理尚未就绪"))
			return
		}
		c.Request = c.Request.WithContext(models.WithMetadata(c.Request.Context(), metadata(c)))
		c.Next()
	})
	base.GET("/provider-types", func(c *gin.Context) {
		if !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		result, err := s.ProviderTypes(c.Request.Context(), rawSession(c))
		finish(c, result, err)
	})
	base.GET("/providers", func(c *gin.Context) {
		filter, ok := modelListQuery(c, false)
		if !ok || !modelEmptyBody(c) {
			return
		}
		result, err := s.ListProviders(c.Request.Context(), rawSession(c), filter)
		finish(c, result, err)
	})
	base.POST("/providers", func(c *gin.Context) {
		var input models.ProviderCreate
		if !modelNoQuery(c) || !httpx.DecodeStrict(c, &input, 64<<10) {
			return
		}
		result, err := s.CreateProvider(c.Request.Context(), rawSession(c), input)
		finish(c, result, err)
	})
	for _, route := range []struct{ method, path, operation string }{
		{"GET", "", "get"}, {"PATCH", "", "patch"}, {"DELETE", "", "delete"},
		{"PUT", "/authentication", "authentication"},
		{"POST", "/test", "probe"}, {"POST", "/model-discovery", "discovery"},
	} {
		base.Handle(route.method, "/providers/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok || !modelNoQuery(c) {
				return
			}
			ctx, raw, tag := c.Request.Context(), rawSession(c), c.GetHeader("If-Match")
			var result *models.Result
			var err error
			switch route.operation {
			case "patch":
				var input models.ProviderPatch
				if !httpx.DecodeStrict(c, &input, 64<<10) {
					return
				}
				result, err = s.PatchProvider(ctx, raw, id, tag, input)
			case "authentication":
				var input models.AuthenticationWrite
				if !httpx.DecodeStrict(c, &input, 64<<10) {
					return
				}
				result, err = s.UpdateAuthentication(ctx, raw, id, tag, input)
			case "probe":
				var input struct {
					Level string `json:"level"`
				}
				if !httpx.DecodeStrict(c, &input, 64<<10) {
					return
				}
				if input.Level != "connectivity" {
					httpx.Write(c, httpx.Invalid("level", "unsupported"))
					return
				}
				result, err = s.TestProvider(ctx, raw, id, tag)
			case "discovery":
				if !httpx.DecodeStrict(c, &struct{}{}, 64<<10) {
					return
				}
				result, err = s.DiscoverModels(ctx, raw, id, tag)
			default:
				if !modelEmptyBody(c) {
					return
				}
				switch route.operation {
				case "get":
					result, err = s.GetProvider(ctx, raw, id)
				case "delete":
					result, err = s.DeleteProvider(ctx, raw, id, tag)
				}
			}
			finish(c, result, err)
		})
	}
	base.GET("/definitions", func(c *gin.Context) {
		filter, ok := modelListQuery(c, true)
		if !ok || !modelEmptyBody(c) {
			return
		}
		result, err := s.ListDefinitions(c.Request.Context(), rawSession(c), filter)
		finish(c, result, err)
	})
	base.POST("/definitions", func(c *gin.Context) {
		var input models.DefinitionCreate
		if !modelNoQuery(c) || !httpx.DecodeStrict(c, &input, 64<<10) {
			return
		}
		result, err := s.CreateDefinition(c.Request.Context(), rawSession(c), input)
		finish(c, result, err)
	})
	for _, route := range []struct{ method, path, operation string }{
		{"GET", "", "get"}, {"PATCH", "", "patch"}, {"DELETE", "", "delete"},
		{"POST", "/test", "probe"},
	} {
		base.Handle(route.method, "/definitions/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok || !modelNoQuery(c) {
				return
			}
			ctx, raw, tag := c.Request.Context(), rawSession(c), c.GetHeader("If-Match")
			var result *models.Result
			var err error
			switch route.operation {
			case "patch":
				var input models.DefinitionPatch
				if !httpx.DecodeStrict(c, &input, 64<<10) {
					return
				}
				result, err = s.PatchDefinition(ctx, raw, id, tag, input)
			case "probe":
				var input struct {
					Levels []string `json:"levels"`
				}
				if !httpx.DecodeStrict(c, &input, 64<<10) {
					return
				}
				result, err = s.TestModel(ctx, raw, id, tag, input.Levels)
			default:
				if !modelEmptyBody(c) {
					return
				}
				switch route.operation {
				case "get":
					result, err = s.GetDefinition(ctx, raw, id)
				case "delete":
					result, err = s.DeleteDefinition(ctx, raw, id, tag)
				}
			}
			finish(c, result, err)
		})
	}
}

func modelEmptyBody(c *gin.Context) bool {
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, 1))
	if err != nil || len(data) != 0 {
		httpx.Write(c, httpx.Invalid("body", "unexpected_body"))
		return false
	}
	return true
}

func modelNoQuery(c *gin.Context) bool {
	_, ok := modelQuery(c)
	return ok
}

func modelQuery(c *gin.Context, allowed ...string) (url.Values, bool) {
	query, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		httpx.Write(c, httpx.Invalid("query", "invalid_format"))
		return nil, false
	}
	for key, values := range query {
		valid := false
		for _, candidate := range allowed {
			if key == candidate {
				valid = true
				break
			}
		}
		if !valid || len(values) != 1 {
			httpx.Write(c, httpx.Invalid("query", "unsupported_or_repeated_field"))
			return nil, false
		}
	}
	return query, true
}

func modelListQuery(c *gin.Context, definitions bool) (models.Query, bool) {
	allowed := []string{"page", "page_size", "q", "enabled"}
	if definitions {
		allowed = append(allowed, "provider_id", "protocol")
	} else {
		allowed = append(allowed, "provider_type")
	}
	values, ok := modelQuery(c, allowed...)
	q := models.Query{Page: 1, PageSize: 20}
	if !ok {
		return q, false
	}
	for _, item := range []struct {
		name    string
		value   *int
		maximum int
	}{{"page", &q.Page, 1000000}, {"page_size", &q.PageSize, 100}} {
		if value, exists := values[item.name]; exists {
			n, err := strconv.Atoi(value[0])
			if err != nil || n < 1 || n > item.maximum {
				httpx.Write(c, httpx.Invalid(item.name, "out_of_range"))
				return q, false
			}
			*item.value = n
		}
	}
	q.Q = strings.TrimSpace(values.Get("q"))
	if !utf8.ValidString(q.Q) || utf8.RuneCountInString(q.Q) > 64 {
		httpx.Write(c, httpx.Invalid("q", "invalid_length"))
		return q, false
	}
	if raw, exists := values["enabled"]; exists {
		if raw[0] != "true" && raw[0] != "false" {
			httpx.Write(c, httpx.Invalid("enabled", "invalid_boolean"))
			return q, false
		}
		value := raw[0] == "true"
		q.Enabled = &value
	}
	q.ProviderType, q.Protocol = values.Get("provider_type"), values.Get("protocol")
	if raw, exists := values["provider_id"]; exists {
		id, err := strconv.ParseUint(raw[0], 10, 64)
		if err != nil || id == 0 || strconv.FormatUint(id, 10) != raw[0] {
			httpx.Write(c, httpx.Invalid("provider_id", "invalid_format"))
			return q, false
		}
		q.ProviderID = id
	}
	return q, true
}
