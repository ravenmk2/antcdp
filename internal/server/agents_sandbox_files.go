package server

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func registerSandboxFiles(u *gin.RouterGroup, o Options) {
	s := o.Sandboxes
	u.POST("/cloud-computers/:id/home", agentJSON[struct{}](o, 64<<10, func(c *gin.Context, _ struct{}) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.EnsureWorkspaceHome(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"))
	}))
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
		ranges := c.Request.Header.Values("Range")
		if len(ranges) > 1 || !sandboxcore.ValidFileRange(c.GetHeader("Range")) {
			c.Status(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		out, content, err := s.OpenWorkspaceFile(c.Request.Context(), rawSession(c), id, q.Get("path"), c.GetHeader("Range"))
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
		serveWorkspaceStream(c, content)
	})
	u.POST("/cloud-computers/:id/directories", agentJSON[agents.WorkspaceDirectoryWrite](o, 64<<10, func(c *gin.Context, w agents.WorkspaceDirectoryWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.CreateWorkspaceDirectory(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"), w)
	}))
	u.POST("/cloud-computers/:id/file-uploads", func(c *gin.Context) {
		id, ok := agentID(c, "id")
		if !ok {
			return
		}
		q, ok := modelQuery(c, "path")
		if !ok {
			return
		}
		const bodyLimit = agents.WorkspaceUploadMaxBytes + 1<<20
		if c.Request.ContentLength > bodyLimit {
			httpx.Write(c, agents.WorkspaceUploadTooLarge())
			return
		}
		source, name, err := agentSingleFileSource(c, bodyLimit)
		if err != nil {
			var limit *http.MaxBytesError
			if errors.As(err, &limit) {
				err = agents.WorkspaceUploadTooLarge()
			}
			httpx.Write(c, err)
			return
		}
		out, err := s.UploadWorkspaceFile(c.Request.Context(), rawSession(c), id, q.Get("path"), name, source)
		agentFinish(c, o, out, err)
	})
	u.POST("/cloud-computers/:id/file-removals", agentJSON[agents.WorkspaceRemovalWrite](o, 64<<10, func(c *gin.Context, w agents.WorkspaceRemovalWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.RemoveWorkspaceFiles(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
}

func serveWorkspaceStream(c *gin.Context, content *agents.WorkspaceFileContent) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": content.Filename}))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Accept-Ranges", "bytes")
	if content.ContentRange != "" {
		c.Header("Content-Range", content.ContentRange)
	}
	if content.StatusCode == http.StatusRequestedRangeNotSatisfiable {
		c.Status(content.StatusCode)
		c.Writer.WriteHeaderNow()
		return
	}
	if content.ContentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(content.ContentLength, 10))
	}
	c.Status(content.StatusCode)
	c.Writer.Flush()
	n, err := io.Copy(workspaceStreamWriter{c.Writer}, content.Reader)
	if err != nil || content.ContentLength >= 0 && n != content.ContentLength {
		// Headers/body may already be on the wire. Abort rather than presenting
		// a truncated download as a successful response or appending JSON to it.
		panic(http.ErrAbortHandler)
	}
}

type workspaceStreamWriter struct{ http.ResponseWriter }

func (w workspaceStreamWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	if err == nil {
		err = http.NewResponseController(w.ResponseWriter).Flush()
	}
	return n, err
}
