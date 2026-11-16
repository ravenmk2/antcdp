package server

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	collab "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerProjectRoles(b *gin.RouterGroup, o Options, s *collab.Service) {
	b.GET("/projects/:id/role-member-options", func(c *gin.Context) {
		projectID, ok := parseID(c)
		if !ok {
			return
		}
		out, a, err := s.ProjectRoleMemberOptions(c.Request.Context(), rawSession(c), projectID, c.Query("q"))
		if collaborationFinish(c, o, a, err) {
			httpx.Data(c, http.StatusOK, out)
		}
	})
	roles := b.Group("/projects/:id/roles")
	roles.GET("", func(c *gin.Context) {
		projectID, ok := parseID(c)
		if !ok {
			return
		}
		out, a, err := s.ProjectRoles(c.Request.Context(), rawSession(c), projectID)
		if collaborationFinish(c, o, a, err) {
			httpx.Data(c, http.StatusOK, gin.H{"items": out})
		}
	})
	roles.POST("", saveProjectRole(o, s, false))
	roles.PATCH("/:roleID", saveProjectRole(o, s, true))
	roles.GET("/:roleID", func(c *gin.Context) {
		projectID, roleID, ok := projectRoleIDs(c)
		if !ok {
			return
		}
		out, a, err := s.ProjectRole(c.Request.Context(), rawSession(c), projectID, roleID)
		if collaborationFinish(c, o, a, err) {
			c.Header("ETag", out.ETag)
			httpx.Data(c, http.StatusOK, out)
		}
	})
	roles.DELETE("/:roleID", func(c *gin.Context) {
		projectID, roleID, ok := projectRoleIDs(c)
		if !ok {
			return
		}
		a, err := s.DeleteProjectRole(c.Request.Context(), rawSession(c), projectID, roleID, c.GetHeader("If-Match"), metadata(c))
		if collaborationFinish(c, o, a, err) {
			c.Status(http.StatusNoContent)
		}
	})
	roles.PUT("/:roleID/members", func(c *gin.Context) {
		projectID, roleID, ok := projectRoleIDs(c)
		if !ok {
			return
		}
		var w struct {
			UserIDs []string `json:"user_ids"`
		}
		if !collaborationBody(c, &w) {
			return
		}
		a, err := s.SetProjectRoleMembers(c.Request.Context(), rawSession(c), projectID, roleID, c.GetHeader("If-Match"), w.UserIDs, metadata(c))
		if collaborationFinish(c, o, a, err) {
			c.Status(http.StatusNoContent)
		}
	})
}

func projectRoleIDs(c *gin.Context) (uint64, uint64, bool) {
	projectID, ok := parseID(c)
	if !ok {
		return 0, 0, false
	}
	roleID, ok := collaborationID(c, "roleID")
	return projectID, roleID, ok
}

func saveProjectRole(o Options, s *collab.Service, update bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		var projectID, roleID uint64
		var ok bool
		status := http.StatusCreated
		if update {
			projectID, roleID, ok = projectRoleIDs(c)
			status = http.StatusOK
		} else {
			projectID, ok = parseID(c)
		}
		if !ok {
			return
		}
		var w collab.RoleWrite
		if !collaborationBody(c, &w) {
			return
		}
		out, a, err := s.SaveProjectRole(c.Request.Context(), rawSession(c), projectID, roleID, c.GetHeader("If-Match"), w, metadata(c))
		if collaborationFinish(c, o, a, err) {
			c.Header("ETag", out.ETag)
			if !update {
				c.Header("Location", c.Request.URL.Path+"/"+strconv.FormatUint(out.ID, 10))
			}
			httpx.Data(c, status, out)
		}
	}
}
