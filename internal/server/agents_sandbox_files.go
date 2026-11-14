package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerSandboxFiles(u *gin.RouterGroup, o Options) {
	s := o.Sandboxes
	u.GET("/cloud-computers/:id/entries", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := modelQuery(c, "path", "page", "page_size")
		if !ok {
			return nil, nil
		}
		page, size, ok := agentPaging(c, q)
		if !ok {
			return nil, nil
		}
		return s.ListWorkspaceEntries(c.Request.Context(), rawSession(c), id, agents.WorkspaceEntryQuery{Path: q.Get("path"), Page: page, PageSize: size})
	}))
	u.GET("/cloud-computers/:id/file-content", func(c *gin.Context) {
		id, ok := agentID(c, "id")
		if !ok || !modelEmptyBody(c) {
			return
		}
		q, ok := modelQuery(c, "path", "disposition")
		if !ok {
			return
		}
		if q.Get("path") == "" {
			httpx.Write(c, httpx.Invalid("path", "required"))
			return
		}
		disposition := q.Get("disposition")
		if disposition != "" && disposition != "attachment" && disposition != "inline" {
			httpx.Write(c, httpx.Invalid("disposition", "unsupported"))
			return
		}
		out, content, err := s.OpenWorkspaceFile(c.Request.Context(), rawSession(c), id, q.Get("path"))
		if err != nil {
			httpx.Write(c, err)
			return
		}
		if out == nil || content == nil || content.Reader == nil {
			httpx.Write(c, httpx.E(500, "INTERNAL_ERROR", "工作文件内容不可用"))
			return
		}
		defer func() { _ = content.Reader.Close() }()
		setSession(c, o, rawSession(c), out.Auth)
		serveAgentFile(c, &agents.FileContent{Reader: content.Reader, Filename: content.Filename, MediaType: "application/octet-stream", Size: content.Size, Preview: false}, "attachment")
	})
	u.POST("/cloud-computers/:id/directories", agentJSON[agents.WorkspaceDirectoryWrite](o, 64<<10, func(c *gin.Context, w agents.WorkspaceDirectoryWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.CreateWorkspaceDirectory(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"), w)
	}))
	u.POST("/cloud-computers/:id/file-removals", agentJSON[agents.WorkspaceRemovalWrite](o, 64<<10, func(c *gin.Context, w agents.WorkspaceRemovalWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.RemoveWorkspaceFiles(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
}
