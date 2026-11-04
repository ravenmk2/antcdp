package server

import (
	"github.com/gin-gonic/gin"
	collab "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerProjectDelivery(api *gin.RouterGroup, o Options, integrations *i.Service) {
	s := &d.Service{Identity: o.Identity, Integrations: integrations}
	finish := func(c *gin.Context, r i.Result, a *identity.Auth, e error, status int) {
		if !collaborationFinish(c, o, a, e) {
			return
		}
		if r.Tag != "" {
			c.Header("ETag", r.Tag)
		}
		if r.CollectionTag != "" {
			c.Header("X-Collection-ETag", r.CollectionTag)
		}
		if status == 204 {
			c.Status(204)
			return
		}
		httpx.Data(c, status, r.Data)
	}
	registerReleases(api, o, s, finish)
	type route struct{ method, path, op string }
	routes := []route{
		{"GET", "/branch-model", "model.get"}, {"PUT", "/branch-model", "model.save"}, {"POST", "/branch-model/preview", "model.preview"},
		{"GET", "/variants", "variant.list"}, {"POST", "/variants", "variant.create"}, {"GET", "/variants/:vid", "variant.get"}, {"PATCH", "/variants/:vid", "variant.save"}, {"DELETE", "/variants/:vid", "variant.delete"}, {"POST", "/variants/:vid/archive", "variant.archive"}, {"POST", "/variants/:vid/restore", "variant.restore"},
		{"GET", "/variants/:vid/environments", "environment.list"}, {"POST", "/variants/:vid/environments", "environment.create"}, {"GET", "/variants/:vid/environments/:eid", "environment.get"}, {"PATCH", "/variants/:vid/environments/:eid", "environment.save"}, {"DELETE", "/variants/:vid/environments/:eid", "environment.delete"},
		{"GET", "/variants/:vid/repositories", "repositories.get"}, {"GET", "/variants/:vid/environments/:eid/repositories", "repositories.get"}, {"POST", "/repository-scope-preview", "scope.preview"},
	}
	for _, r := range routes {
		api.Handle(r.method, "/projects/:id"+r.path, func(c *gin.Context) {
			cmd, ok := deliveryCommand(c)
			if !ok {
				return
			}
			cmd.Operation = r.op
			if r.method == "POST" || r.method == "PUT" || r.method == "PATCH" {
				var body any
				switch r.op {
				case "model.preview", "model.save":
					body = &cmd.Model
				case "scope.preview":
					body = &cmd.Scope
				case "variant.archive", "variant.restore":
					body = &struct{}{}
				default:
					body = &cmd.Write
				}
				if !collaborationBody(c, body) {
					return
				}
			}
			out, a, e := s.Config(c.Request.Context(), rawSession(c), cmd)
			status := 200
			if r.op == "variant.create" || r.op == "environment.create" {
				status = 201
			}
			if r.method == "DELETE" {
				status = 204
			}
			finish(c, out, a, e, status)
		})
	}
	for _, suffix := range []string{"/variants/:vid/check-branches", "/variants/:vid/environments/:eid/check-branches"} {
		api.POST("/projects/:id"+suffix, func(c *gin.Context) {
			cmd, ok := deliveryCommand(c)
			if !ok {
				return
			}
			var w d.Selection
			if !collaborationBody(c, &w) {
				return
			}
			out, a, e := s.Check(c.Request.Context(), rawSession(c), cmd.ProjectID, cmd.VariantID, cmd.EnvironmentID, w, cmd.Tag)
			finish(c, out, a, e, 200)
		})
	}
	api.POST("/projects/:id/variants/:vid/branch-creations", func(c *gin.Context) {
		cmd, ok := deliveryCommand(c)
		if !ok {
			return
		}
		var w d.PrepareWrite
		if !collaborationBody(c, &w) {
			return
		}
		out, a, e := s.Prepare(c.Request.Context(), rawSession(c), cmd.ProjectID, cmd.VariantID, w, cmd.Tag, c.GetHeader("Idempotency-Key"), cmd.Meta)
		finish(c, out, a, e, 201)
	})
	for _, suffix := range []string{"", "/:bid", "/:bid/items"} {
		api.GET("/projects/:id/branch-creations"+suffix, func(c *gin.Context) {
			cmd, ok := deliveryCommand(c)
			if !ok {
				return
			}
			var bid uint64
			if c.Param("bid") != "" {
				bid, ok = collaborationID(c, "bid")
				if !ok {
					return
				}
			}
			if c.Query("variant_id") != "" {
				var e error
				cmd.Query.VariantID, e = dID(c.Query("variant_id"))
				if e != nil {
					httpx.Write(c, e)
					return
				}
			}
			cmd.Query.Status = c.DefaultQuery("status", "all")
			out, a, e := s.History(c.Request.Context(), rawSession(c), cmd.ProjectID, bid, suffix == "/:bid/items", cmd.Query)
			finish(c, out, a, e, 200)
		})
	}
	for _, action := range []string{"execute", "reconcile"} {
		api.POST("/projects/:id/branch-creations/:bid/"+action, func(c *gin.Context) {
			cmd, ok := deliveryCommand(c)
			if !ok {
				return
			}
			bid, ok := collaborationID(c, "bid")
			if !ok {
				return
			}
			var out i.Result
			var a *identity.Auth
			var e error
			if action == "execute" {
				var w d.ExecuteWrite
				if !collaborationBody(c, &w) {
					return
				}
				out, a, e = s.Execute(c.Request.Context(), rawSession(c), cmd.ProjectID, bid, w, cmd.Tag, cmd.Meta)
			} else {
				var w d.ReconcileWrite
				if !collaborationBody(c, &w) {
					return
				}
				out, a, e = s.Reconcile(c.Request.Context(), rawSession(c), cmd.ProjectID, bid, w, cmd.Tag, cmd.Meta)
			}
			finish(c, out, a, e, 200)
		})
	}
}
func dID(s string) (uint64, error) { return collab.ID(s) }
func deliveryCommand(c *gin.Context) (d.Command, bool) {
	var cmd d.Command
	var ok bool
	cmd.ProjectID, ok = parseID(c)
	if !ok {
		return cmd, false
	}
	if c.Param("vid") != "" {
		cmd.VariantID, ok = collaborationID(c, "vid")
		if !ok {
			return cmd, false
		}
	}
	if c.Param("eid") != "" {
		cmd.EnvironmentID, ok = collaborationID(c, "eid")
		if !ok {
			return cmd, false
		}
	}
	cmd.Query.Page, ok = queryInt(c, "page", 1)
	if !ok {
		return cmd, false
	}
	cmd.Query.Size, ok = queryInt(c, "page_size", 20)
	if !ok {
		return cmd, false
	}
	cmd.Query.Search = c.Query("q")
	cmd.Query.Status = c.DefaultQuery("archived", "active")
	cmd.Tag = c.GetHeader("If-Match")
	cmd.Collection = c.GetHeader("X-Collection-If-Match")
	cmd.Meta = metadata(c)
	return cmd, true
}
