package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type deliveryResponse func(*gin.Context, i.Result, *identity.Auth, error, int)

func registerReleases(api *gin.RouterGroup, o Options, s *d.Service, finish deliveryResponse) {
	api.GET("/projects/:id/workspace", func(c *gin.Context) {
		cmd, ok := deliveryCommand(c)
		if !ok {
			return
		}
		out, a, e := s.Workspace(c.Request.Context(), rawSession(c), cmd.ProjectID)
		finish(c, out, a, e, 200)
	})
	api.GET("/projects/:id/releases", func(c *gin.Context) {
		cmd, ok := deliveryCommand(c)
		if !ok {
			return
		}
		cmd.Query.Status = c.DefaultQuery("status", "active")
		if c.Query("variant_id") != "" {
			var e error
			cmd.Query.VariantID, e = dID(c.Query("variant_id"))
			if e != nil {
				finish(c, i.Result{}, nil, httpx.Invalid("variant_id", "invalid_format"), 200)
				return
			}
		}
		out, a, e := s.ProjectReleases(c.Request.Context(), rawSession(c), cmd.ProjectID, cmd.Query)
		finish(c, out, a, e, 200)
	})
	base := api.Group("/projects/:id/variants/:vid")
	base.PATCH("/release-settings", func(c *gin.Context) {
		cmd, ok := deliveryCommand(c)
		if !ok {
			return
		}
		var w struct {
			Prefix string `json:"tag_prefix"`
		}
		if !collaborationBody(c, &w) {
			return
		}
		out, a, e := s.ReleaseSettings(c.Request.Context(), rawSession(c), cmd, w.Prefix)
		finish(c, out, a, e, 200)
	})
	handle := func(c *gin.Context) {
		cmd, ok := deliveryCommand(c)
		if !ok {
			return
		}
		cmd.Query.Status = c.DefaultQuery("status", "all")
		var rid uint64
		if c.Param("rid") != "" {
			rid, ok = collaborationID(c, "rid")
			if !ok {
				return
			}
		}
		var w *d.ReleaseWrite
		if c.Request.Method != http.MethodGet {
			w = &d.ReleaseWrite{}
			if !collaborationBody(c, w) {
				return
			}
		}
		out, a, e := s.Releases(c.Request.Context(), rawSession(c), cmd, rid, w)
		status := 200
		if c.Request.Method == http.MethodPost {
			status = 201
		}
		finish(c, out, a, e, status)
	}
	registerReleaseMaterials(base, o, s, finish)
	registerReleaseFlow(base, o, s, finish)
	registerTempMaintenance(api, o)
	base.GET("/releases", handle)
	base.POST("/releases", handle)
	base.GET("/releases/:rid", handle)
	base.PATCH("/releases/:rid", handle)
}
