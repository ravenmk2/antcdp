package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

func registerRepositoryLabels(api *gin.RouterGroup, s *i.Service, finish func(*gin.Context, i.Result, *identity.Auth, error, int)) {
	base := "/projects/:id/repository-labels"
	api.GET(base, func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		r, a, e := s.RepositoryLabels(c.Request.Context(), rawSession(c), pid)
		finish(c, r, a, e, 200)
	})
	for _, method := range []string{"POST", "PATCH", "DELETE"} {
		path := base
		if method != "POST" {
			path += "/:lid"
		}
		api.Handle(method, path, func(c *gin.Context) {
			pid, ok := parseID(c)
			if !ok {
				return
			}
			var id uint64
			if method != "POST" {
				id, ok = collaborationID(c, "lid")
				if !ok {
					return
				}
			}
			var w i.RepositoryLabelWrite
			if method != "DELETE" && !collaborationBody(c, &w) {
				return
			}
			r, a, e := s.WriteRepositoryLabel(c.Request.Context(), rawSession(c), pid, id, w, method == "DELETE", c.GetHeader("If-Match"), metadata(c))
			status := 200
			if method == "POST" {
				status = 201
			}
			finish(c, r, a, e, status)
		})
	}
	api.PUT("/projects/:id/repositories/:rid/labels", func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		rid, ok := collaborationID(c, "rid")
		if !ok {
			return
		}
		var w i.RepositoryLabelsWrite
		if !collaborationBody(c, &w) {
			return
		}
		r, a, e := s.SetRepositoryLabels(c.Request.Context(), rawSession(c), pid, rid, w, c.GetHeader("If-Match"), metadata(c))
		finish(c, r, a, e, 200)
	})
}
