package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	collab "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func collaborationBody(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpx.Write(c, httpx.E(413, "PAYLOAD_TOO_LARGE", "请求内容过大"))
			return false
		}
		httpx.Write(c, httpx.Invalid("body", "invalid_json"))
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		httpx.Write(c, httpx.Invalid("body", "invalid_json"))
		return false
	}
	return true
}
func collaborationID(c *gin.Context, name string) (uint64, bool) {
	v, e := collab.ID(c.Param(name))
	if e != nil {
		httpx.Write(c, e)
		return 0, false
	}
	return v, true
}
func collaborationFinish(c *gin.Context, o Options, a *identity.Auth, err error) bool {
	if err != nil {
		httpx.Write(c, err)
		return false
	}
	setSession(c, o, rawSession(c), a)
	return true
}
func registerCollaboration(b *gin.RouterGroup, o Options) {
	s := &collab.Service{Identity: o.Identity}
	registerIcons(b, o, s)
	b.GET("/icon-catalog", func(c *gin.Context) {
		_, a, e := o.Identity.Sidebar(c.Request.Context(), rawSession(c))
		if !collaborationFinish(c, o, a, e) {
			return
		}
		httpx.Data(c, 200, collab.IconKeys)
	})
	b.GET("/admin/collaboration/user-options", func(c *gin.Context) {
		out, a, e := s.Options(c.Request.Context(), rawSession(c), collab.Project, 0, false, c.Query("q"))
		if collaborationFinish(c, o, a, e) {
			httpx.Data(c, 200, out)
		}
	})
	for _, k := range []collab.Kind{collab.Project, collab.Team} {
		base := "/" + string(k) + "s"
		b.GET(base, func(c *gin.Context) {
			page, ok := queryInt(c, "page", 1)
			if !ok {
				return
			}
			size, ok := queryInt(c, "page_size", 20)
			if !ok {
				return
			}
			out, a, e := s.List(c.Request.Context(), rawSession(c), k, collab.Query{Scope: c.Query("scope"), Search: c.Query("q"), Status: c.Query("status"), Page: page, Size: size, Unmanaged: c.Query("unmanaged") == "true"})
			if collaborationFinish(c, o, a, e) {
				httpx.Data(c, 200, out)
			}
		})
		b.POST(base, func(c *gin.Context) {
			var w collab.Write
			if !collaborationBody(c, &w) {
				return
			}
			out, a, e := s.Create(c.Request.Context(), rawSession(c), k, w, metadata(c))
			if collaborationFinish(c, o, a, e) {
				c.Header("ETag", out.ETag)
				c.Header("Location", "/api/v1"+base+"/"+strconv.FormatUint(out.ID, 10))
				httpx.Data(c, 201, out)
			}
		})
		b.GET(base+"/:id", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			out, a, e := s.Get(c.Request.Context(), rawSession(c), k, id)
			if collaborationFinish(c, o, a, e) {
				c.Header("ETag", out.ETag)
				httpx.Data(c, 200, out)
			}
		})
		b.PATCH(base+"/:id", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			var w collab.Write
			if !collaborationBody(c, &w) {
				return
			}
			out, a, e := s.Update(c.Request.Context(), rawSession(c), k, id, w, c.GetHeader("If-Match"), metadata(c))
			if collaborationFinish(c, o, a, e) {
				c.Header("ETag", out.ETag)
				httpx.Data(c, 200, out)
			}
		})
		b.GET(base+"/:id/members", func(c *gin.Context) {
			id, ok := parseID(c)
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
			out, a, e := s.Members(c.Request.Context(), rawSession(c), k, id, collab.Query{Search: c.Query("q"), Page: page, Size: size})
			if collaborationFinish(c, o, a, e) {
				httpx.Data(c, 200, out)
			}
		})
		b.GET(base+"/:id/member-options", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			out, a, e := s.Options(c.Request.Context(), rawSession(c), k, id, false, c.Query("q"))
			if collaborationFinish(c, o, a, e) {
				httpx.Data(c, 200, out)
			}
		})
		b.POST(base+"/:id/members", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			var w struct {
				UserID string `json:"user_id"`
				Role   string `json:"role"`
			}
			if !httpx.Decode(c, &w) {
				return
			}
			uid, e := collab.ID(w.UserID)
			if e != nil {
				httpx.Write(c, e)
				return
			}
			a, e := s.Member(c.Request.Context(), rawSession(c), k, id, uid, w.Role, c.GetHeader("If-Match"), "add", metadata(c))
			if collaborationFinish(c, o, a, e) {
				c.Status(204)
			}
		})
		b.PATCH(base+"/:id/members/:userID", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			uid, ok := collaborationID(c, "userID")
			if !ok {
				return
			}
			var w struct {
				Role string `json:"role"`
			}
			if !httpx.Decode(c, &w) {
				return
			}
			a, e := s.Member(c.Request.Context(), rawSession(c), k, id, uid, w.Role, c.GetHeader("If-Match"), "role", metadata(c))
			if collaborationFinish(c, o, a, e) {
				c.Status(204)
			}
		})
		b.DELETE(base+"/:id/members/:userID", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			uid, ok := collaborationID(c, "userID")
			if !ok {
				return
			}
			a, e := s.Member(c.Request.Context(), rawSession(c), k, id, uid, "", c.GetHeader("If-Match"), "remove", metadata(c))
			if collaborationFinish(c, o, a, e) {
				c.Status(204)
			}
		})
		b.POST(base+"/:id/leave", func(c *gin.Context) {
			id, ok := parseID(c)
			if !ok {
				return
			}
			a, e := s.Member(c.Request.Context(), rawSession(c), k, id, 0, "", "", "leave", metadata(c))
			if collaborationFinish(c, o, a, e) {
				c.Status(204)
			}
		})
		ops := []string{"archive", "restore"}
		if k == collab.Team {
			ops = []string{"dissolve"}
		}
		for _, op := range ops {
			b.POST(base+"/:id/"+op, func(c *gin.Context) {
				id, ok := parseID(c)
				if !ok {
					return
				}
				a, e := s.Lifecycle(c.Request.Context(), rawSession(c), k, id, op, c.GetHeader("If-Match"), metadata(c))
				if collaborationFinish(c, o, a, e) {
					c.Status(204)
				}
			})
		}
	}
	b.GET("/projects/:id/teams", func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		out, a, e := s.Teams(c.Request.Context(), rawSession(c), id)
		if collaborationFinish(c, o, a, e) {
			httpx.Data(c, 200, out)
		}
	})
	b.GET("/teams/:id/projects", func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		out, a, e := s.Projects(c.Request.Context(), rawSession(c), id)
		if collaborationFinish(c, o, a, e) {
			httpx.Data(c, 200, out)
		}
	})
	b.GET("/projects/:id/team-options", func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		out, a, e := s.Options(c.Request.Context(), rawSession(c), collab.Project, id, true, c.Query("q"))
		if collaborationFinish(c, o, a, e) {
			httpx.Data(c, 200, out)
		}
	})
	b.POST("/projects/:id/teams", func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		var w struct {
			TeamID string `json:"team_id"`
		}
		if !httpx.Decode(c, &w) {
			return
		}
		tid, e := collab.ID(w.TeamID)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		a, e := s.TeamGrant(c.Request.Context(), rawSession(c), id, tid, true, c.GetHeader("If-Match"), metadata(c))
		if collaborationFinish(c, o, a, e) {
			c.Status(204)
		}
	})
	b.DELETE("/projects/:id/teams/:teamID", func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		tid, ok := collaborationID(c, "teamID")
		if !ok {
			return
		}
		a, e := s.TeamGrant(c.Request.Context(), rawSession(c), id, tid, false, c.GetHeader("If-Match"), metadata(c))
		if collaborationFinish(c, o, a, e) {
			c.Status(204)
		}
	})
}
