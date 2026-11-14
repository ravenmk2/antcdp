package server

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// finalMultipartReader checks the enclosing form before reporting successful
// EOF to the byte store. An extra part cannot follow an already committed file.
type finalMultipartReader struct {
	part     *multipart.Part
	form     *multipart.Reader
	finished bool
	err      error
}

func (r *finalMultipartReader) Read(p []byte) (int, error) {
	if r.finished {
		return 0, r.err
	}
	n, e := r.part.Read(p)
	if e != io.EOF {
		return n, e
	}
	r.finished = true
	_, next := r.form.NextPart()
	if next != io.EOF {
		r.err = httpx.Invalid("body", "unexpected_or_invalid_part")
	} else {
		r.err = io.EOF
	}
	return n, r.err
}

func agentAttachmentSource(c *gin.Context) (*finalMultipartReader, string, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 33<<20)
	form, e := c.Request.MultipartReader()
	if e != nil {
		return nil, "", httpx.Invalid("body", "multipart_required")
	}
	part, e := form.NextPart()
	if e != nil || part.FormName() != "file" {
		return nil, "", httpx.Invalid("file", "required_single_file")
	}
	_, params, e := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
	name := params["filename"]
	if e != nil || name == "" || len(name) > 255 || strings.ContainsAny(name, "/\\\x00\r\n") {
		return nil, "", httpx.Invalid("file", "invalid_filename")
	}
	return &finalMultipartReader{part: part, form: form}, name, nil
}

func registerAgentFiles(u *gin.RouterGroup, o Options) {
	s := o.Agents
	u.POST("/sessions/:id/attachments", func(c *gin.Context) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return
		}
		reader, name, e := agentAttachmentSource(c)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
		defer cancel()
		out, e := s.UploadAttachment(ctx, rawSession(c), id, c.GetHeader("Idempotency-Key"), name, reader)
		agentFinish(c, o, out, e)
	})
	u.GET("/sessions/:id/attachments", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := modelQuery(c, "page", "page_size", "state")
		if !ok {
			return nil, nil
		}
		page, size, ok := agentPaging(c, q)
		if !ok {
			return nil, nil
		}
		return s.ListAttachments(c.Request.Context(), rawSession(c), id, agents.AttachmentQuery{Page: page, PageSize: size, State: q.Get("state")})
	}))
	for _, method := range []string{"GET", "DELETE"} {
		u.Handle(method, "/sessions/:id/attachments/:attachment_id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok || !modelNoQuery(c) {
				return nil, nil
			}
			attachment, ok := agentID(c, "attachment_id")
			if !ok {
				return nil, nil
			}
			if method == "GET" {
				return s.GetAttachment(c.Request.Context(), rawSession(c), id, attachment)
			}
			return s.DeleteAttachment(c.Request.Context(), rawSession(c), id, attachment, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"))
		}))
	}
	u.GET("/files/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetFile(c.Request.Context(), rawSession(c), id)
	}))
	u.GET("/files/:id/content", func(c *gin.Context) {
		id, ok := agentID(c, "id")
		if !ok || !modelEmptyBody(c) {
			return
		}
		q, ok := modelQuery(c, "disposition")
		if !ok {
			return
		}
		disposition := q.Get("disposition")
		if disposition == "" {
			disposition = "attachment"
		}
		if disposition != "attachment" && disposition != "inline" {
			httpx.Write(c, httpx.Invalid("disposition", "unsupported"))
			return
		}
		out, e := s.GetFileContent(c.Request.Context(), rawSession(c), id)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		content, ok := out.Data.(*agents.FileContent)
		if !ok || content == nil || content.Reader == nil {
			httpx.Write(c, httpx.E(500, "INTERNAL_ERROR", "文件内容不可用"))
			return
		}
		defer func() { _ = content.Reader.Close() }()
		setSession(c, o, rawSession(c), out.Auth)
		serveAgentFile(c, content, disposition)
	})
	for _, scope := range []string{"sessions", "runs"} {
		u.GET("/"+scope+"/:id/artifacts", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok {
				return nil, nil
			}
			fields := []string{"page", "page_size", "include_deleted"}
			if scope == "sessions" {
				fields = append(fields, "q")
			}
			q, ok := modelQuery(c, fields...)
			if !ok {
				return nil, nil
			}
			page, size, ok := agentPaging(c, q)
			if !ok {
				return nil, nil
			}
			deleted := false
			if v, exists := q["include_deleted"]; exists {
				if v[0] != "true" && v[0] != "false" {
					return nil, httpx.Invalid("include_deleted", "invalid_boolean")
				}
				deleted = v[0] == "true"
			}
			query := agents.ArtifactQuery{Page: page, PageSize: size, Q: q.Get("q"), IncludeDeleted: deleted}
			if scope == "runs" {
				return s.ListArtifacts(c.Request.Context(), rawSession(c), 0, &id, query)
			}
			return s.ListArtifacts(c.Request.Context(), rawSession(c), id, nil, query)
		}))
	}
	for _, method := range []string{"GET", "DELETE"} {
		u.Handle(method, "/artifacts/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok || !modelNoQuery(c) {
				return nil, nil
			}
			if method == "GET" {
				return s.GetArtifact(c.Request.Context(), rawSession(c), id)
			}
			return s.DeleteArtifact(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"))
		}))
	}
}

func serveAgentFile(c *gin.Context, content *agents.FileContent, disposition string) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox")
	if !content.Preview {
		disposition = "attachment"
	}
	c.Header("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": content.Filename}))
	c.Header("Content-Type", content.MediaType)
	// ServeContent permits multiple byte ranges, while this contract permits one.
	ranges := c.Request.Header.Values("Range")
	if len(ranges) > 1 || len(ranges) == 1 && !validAgentRange(ranges[0], content.Size) {
		c.Header("Content-Range", "bytes */"+strconv.FormatUint(content.Size, 10))
		c.Status(http.StatusRequestedRangeNotSatisfiable)
		c.Writer.WriteHeaderNow()
		return
	}
	http.ServeContent(c.Writer, c.Request, content.Filename, time.Time{}, content.Reader)
}

func validAgentRange(value string, size uint64) bool {
	if !strings.HasPrefix(value, "bytes=") || strings.Contains(value, ",") || size == 0 {
		return false
	}
	start, end, ok := strings.Cut(strings.TrimPrefix(value, "bytes="), "-")
	if !ok {
		return false
	}
	if start == "" {
		n, e := strconv.ParseUint(end, 10, 63)
		return e == nil && n > 0
	}
	n, e := strconv.ParseUint(start, 10, 63)
	if e != nil || n >= size {
		return false
	}
	if end == "" {
		return true
	}
	last, e := strconv.ParseUint(end, 10, 63)
	return e == nil && last >= n
}
