package server

import (
	"github.com/gin-gonic/gin"
	collab "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerProjectRepositories(api *gin.RouterGroup, o Options, s *i.Service) {
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
		httpx.Data(c, status, r.Data)
	}
	base := "/projects/:id/repositories"
	api.GET(base, func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		page, ok := queryInt(c, "page", 1)
		if !ok {
			return
		}
		size, ok := queryInt(c, "page_size", 20)
		if !ok {
			return
		}
		var cid uint64
		if c.Query("connection_id") != "" {
			var e error
			cid, e = collab.ID(c.Query("connection_id"))
			if e != nil {
				httpx.Write(c, e)
				return
			}
		}
		r, a, e := s.ProjectRepoList(c.Request.Context(), rawSession(c), pid, i.RepoQuery{Search: c.Query("q"), ConnectionID: cid, Page: page, Size: size})
		finish(c, r, a, e, 200)
	})
	for _, suffix := range []string{"/:rid", "/:rid/diagnostics"} {
		api.GET(base+suffix, func(c *gin.Context) {
			pid, ok := parseID(c)
			if !ok {
				return
			}
			rid, ok := collaborationID(c, "rid")
			if !ok {
				return
			}
			r, a, e := s.GetProjectRepo(c.Request.Context(), rawSession(c), pid, rid, suffix == "/:rid/diagnostics")
			finish(c, r, a, e, 200)
		})
	}
	api.POST(base, func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		var w i.RepoWrite
		if !collaborationBody(c, &w) {
			return
		}
		r, a, e := s.LinkRepos(c.Request.Context(), rawSession(c), pid, w, c.GetHeader("If-Match"), metadata(c))
		finish(c, r, a, e, 201)
	})
	api.POST(base+"/batch-unlink", func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		var w i.RepoWrite
		if !collaborationBody(c, &w) {
			return
		}
		r, a, e := s.UnlinkRepos(c.Request.Context(), rawSession(c), pid, w, c.GetHeader("If-Match"), metadata(c))
		finish(c, r, a, e, 200)
	})
	api.POST(base+"/:rid/refresh", func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		rid, ok := collaborationID(c, "rid")
		if !ok {
			return
		}
		var empty struct{}
		if !collaborationBody(c, &empty) {
			return
		}
		r, a, e := s.RefreshRepo(c.Request.Context(), rawSession(c), pid, rid, c.GetHeader("If-Match"), metadata(c))
		finish(c, r, a, e, 200)
	})
	connections := "/admin/projects/:id/repository-connections"
	api.GET(connections, func(c *gin.Context) {
		pid, ok := parseID(c)
		if !ok {
			return
		}
		r, a, e := s.RepoConnections(c.Request.Context(), rawSession(c), pid)
		finish(c, r, a, e, 200)
	})
	for _, kind := range []string{"containers", "repos"} {
		api.GET(connections+"/:cid/"+kind, func(c *gin.Context) {
			pid, ok := parseID(c)
			if !ok {
				return
			}
			cid, ok := collaborationID(c, "cid")
			if !ok {
				return
			}
			recursive := c.Query("recursive")
			if recursive != "" && recursive != "true" && recursive != "false" {
				httpx.Write(c, httpx.Invalid("recursive", "invalid_format"))
				return
			}
			container := c.Query("container_id")
			if kind == "containers" {
				container = c.Query("parent_id")
			}
			r, a, e := s.BrowseRepos(c.Request.Context(), rawSession(c), pid, cid, i.RepoBrowseQuery{Kind: kind, Search: c.Query("q"), Container: container, Cursor: c.Query("cursor"), Recursive: recursive == "true"})
			finish(c, r, a, e, 200)
		})
	}
}
