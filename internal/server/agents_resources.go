package server

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	r "github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func agentResourceResult(v *r.Result, e error) (*agents.Result, error) {
	if e != nil || v == nil {
		return nil, e
	}
	return &agents.Result{Data: v.Data, Status: v.Status, Tag: v.Tag, Location: v.Location, Replayed: v.Replayed, Pagination: v.Pagination, Auth: v.Auth}, nil
}
func resourceQuery(c *gin.Context, extra ...string) (r.Query, bool) {
	values, ok := modelQuery(c, append([]string{"page", "page_size"}, extra...)...)
	if !ok {
		return r.Query{}, false
	}
	page, size, ok := agentPaging(c, values)
	q := r.Query{Page: page, PageSize: size, Q: values.Get("q"), Availability: values.Get("availability")}
	if v, present := values["enabled"]; present {
		if v[0] != "true" && v[0] != "false" {
			httpx.Write(c, httpx.Invalid("enabled", "invalid_boolean"))
			return q, false
		}
		value := v[0] == "true"
		q.Enabled = &value
	}
	return q, ok
}
func registerAgentResources(admin *gin.RouterGroup, o Options) {
	a := admin.Group("")
	a.Use(func(c *gin.Context) {
		if o.AgentResources == nil {
			httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "智能体资源服务尚未就绪"))
			return
		}
		c.Request = c.Request.WithContext(r.WithMetadata(c.Request.Context(), metadata(c)))
		c.Next()
	})
	s := o.AgentResources
	a.GET("/mcp-servers/:id/agents", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := resourceQuery(c)
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.MCPAgents(c.Request.Context(), rawSession(c), id, q))
	}))
	a.GET("/mcp-servers", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := resourceQuery(c, "q", "enabled")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.ListMCPServers(c.Request.Context(), rawSession(c), q))
	}))
	a.POST("/mcp-servers", agentJSON[r.MCPServerCreate](o, 64<<10, func(c *gin.Context, w r.MCPServerCreate) (*agents.Result, error) {
		return agentResourceResult(s.CreateMCPServer(c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), w))
	}))
	for _, name := range []string{"", "/diagnostics"} {
		a.GET("/mcp-servers/:id"+name, agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok {
				return nil, nil
			}
			if !modelNoQuery(c) {
				return nil, nil
			}
			if name == "/diagnostics" {
				return agentResourceResult(s.MCPDiagnostics(c.Request.Context(), rawSession(c), id))
			}
			return agentResourceResult(s.GetMCPServer(c.Request.Context(), rawSession(c), id))
		}))
	}
	a.PATCH("/mcp-servers/:id", agentJSON[r.MCPServerPatch](o, 64<<10, func(c *gin.Context, w r.MCPServerPatch) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.PatchMCPServer(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w))
	}))
	a.DELETE("/mcp-servers/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return agentResourceResult(s.DeleteMCPServer(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key")))
	}))
	a.PUT("/mcp-servers/:id/authentication", agentJSON[r.MCPAuthenticationWrite](o, 64<<10, func(c *gin.Context, w r.MCPAuthenticationWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.SetMCPAuthentication(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w))
	}))
	a.POST("/mcp-servers/:id/test", agentJSON[struct{}](o, 64<<10, func(c *gin.Context, _ struct{}) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.TestMCP(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match")))
	}))
	a.POST("/mcp-servers/:id/debug-sessions", agentJSON[struct {
		SessionID string `json:"session_id"`
	}](o, 4096, func(c *gin.Context, w struct {
		SessionID string `json:"session_id"`
	}) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.ConnectMCP(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w.SessionID))
	}))
	a.DELETE("/mcp-servers/:id/debug-sessions/:session", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return agentResourceResult(s.DisconnectMCP(c.Request.Context(), rawSession(c), id, c.Param("session")))
	}))
	a.POST("/mcp-servers/:id/call-tool", agentJSON[r.MCPCallWrite](o, 64<<10, func(c *gin.Context, w r.MCPCallWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.CallMCPTool(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w))
	}))
	a.POST("/mcp-servers/:id/example-arguments", agentJSON[r.MCPExampleWrite](o, 4096, func(c *gin.Context, w r.MCPExampleWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.MCPExample(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w))
	}))
	a.GET("/skills", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := resourceQuery(c, "q", "enabled")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.ListSkills(c.Request.Context(), rawSession(c), q))
	}))
	a.POST("/skills", agentJSON[r.SkillCreate](o, 64<<10, func(c *gin.Context, w r.SkillCreate) (*agents.Result, error) {
		return agentResourceResult(s.CreateSkill(c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), w))
	}))
	a.POST("/skills/from-upload", agentJSON[r.SkillCreateFromUpload](o, 64<<10, func(c *gin.Context, w r.SkillCreateFromUpload) (*agents.Result, error) {
		return agentResourceResult(s.CreateSkillFromUpload(c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), w))
	}))
	a.GET("/skills/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return agentResourceResult(s.GetSkill(c.Request.Context(), rawSession(c), id))
	}))
	a.PATCH("/skills/:id", agentJSON[r.SkillPatch](o, 64<<10, func(c *gin.Context, w r.SkillPatch) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.PatchSkill(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w))
	}))
	a.DELETE("/skills/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return agentResourceResult(s.DeleteSkill(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key")))
	}))
	a.POST("/skills/uploads", func(c *gin.Context) {
		if !modelNoQuery(c) {
			return
		}
		if o.Identity == nil {
			httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "认证服务尚未就绪"))
			return
		}
		if _, e := o.Identity.AdminAccess(c.Request.Context(), rawSession(c), nil); e != nil {
			httpx.Write(c, e)
			return
		}
		file, name, skill, e := agentMultipart(c, 20<<20, 21<<20, true)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		result, e := s.UploadSkill(c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), name, skill, bytes.NewReader(file))
		out, e := agentResourceResult(result, e)
		agentFinish(c, o, out, e)
	})
	a.GET("/skills/uploads/:operation_id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "operation_id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return agentResourceResult(s.GetSkillUpload(c.Request.Context(), rawSession(c), id))
	}))
	a.DELETE("/skills/uploads/:operation_id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "operation_id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return agentResourceResult(s.DeleteSkillUpload(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key")))
	}))
	a.POST("/skills/:id/versions", agentJSON[r.SkillPublish](o, 64<<10, func(c *gin.Context, w r.SkillPublish) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.PublishSkill(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w))
	}))
	a.GET("/skills/:id/versions", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := resourceQuery(c)
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.ListSkillVersions(c.Request.Context(), rawSession(c), id, q))
	}))
	for _, name := range []string{"", "/entries", "/content"} {
		a.GET("/skills/:id/versions/:version_id"+name, agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok {
				return nil, nil
			}
			version, ok := agentID(c, "version_id")
			if !ok {
				return nil, nil
			}
			switch name {
			case "/entries":
				q, ok := resourceQuery(c, "path")
				if !ok {
					return nil, nil
				}
				return agentResourceResult(s.ListSkillEntries(c.Request.Context(), rawSession(c), id, version, c.Query("path"), q))
			case "/content":
				values, ok := modelQuery(c, "path")
				if !ok {
					return nil, nil
				}
				return agentResourceResult(s.ReadSkillContent(c.Request.Context(), rawSession(c), id, version, values.Get("path")))
			default:
				if !modelNoQuery(c) {
					return nil, nil
				}
				return agentResourceResult(s.GetSkillVersion(c.Request.Context(), rawSession(c), id, version))
			}
		}))
	}
	a.DELETE("/skills/:id/versions/:version_id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		version, ok := agentID(c, "version_id")
		if !ok {
			return nil, nil
		}
		return agentResourceResult(s.DeleteSkillVersion(c.Request.Context(), rawSession(c), id, version, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key")))
	}))
	a.GET("/skills/:id/versions/:version_id/archive", func(c *gin.Context) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) || !modelEmptyBody(c) {
			return
		}
		version, ok := agentID(c, "version_id")
		if !ok {
			return
		}
		download, e := s.OpenSkillArchive(c.Request.Context(), rawSession(c), id, version)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		defer func() { _ = download.Reader.Close() }()
		setSession(c, o, rawSession(c), download.Auth)
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": download.Filename}))
		c.Header("Content-Security-Policy", "sandbox")
		c.DataFromReader(200, int64(download.Size), "application/zip", download.Reader, nil)
	})
}

// Parse the complete bounded multipart before creating a persistent upload.
// Filename is read from the raw disposition rather than FileName's path base.
func agentMultipart(c *gin.Context, fileLimit, totalLimit int64, allowSkill bool) ([]byte, string, string, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, totalLimit)
	reader, e := c.Request.MultipartReader()
	if e != nil {
		return nil, "", "", httpx.Invalid("body", "multipart_required")
	}
	var file []byte
	name, skill := "", ""
	seen := map[string]bool{}
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, "", "", httpx.E(413, "UPLOAD_TOO_LARGE", "上传内容无效或超过上限")
		}
		field := part.FormName()
		if seen[field] || field != "file" && (!allowSkill || field != "skill_id") {
			_ = part.Close()
			return nil, "", "", httpx.Invalid("body", "unexpected_or_repeated_part")
		}
		seen[field] = true
		if field == "file" {
			_, params, e := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
			if e != nil || params["filename"] == "" {
				_ = part.Close()
				return nil, "", "", httpx.Invalid("file", "filename_required")
			}
			name = params["filename"]
			if strings.ContainsAny(name, "/\\\x00\r\n") || len(name) > 255 {
				_ = part.Close()
				return nil, "", "", httpx.Invalid("file", "invalid_filename")
			}
			file, e = io.ReadAll(io.LimitReader(part, fileLimit+1))
			if e != nil || int64(len(file)) > fileLimit {
				_ = part.Close()
				return nil, "", "", httpx.E(413, "UPLOAD_TOO_LARGE", "上传文件超过上限")
			}
		} else {
			value, e := io.ReadAll(io.LimitReader(part, 22))
			if e != nil || len(value) > 20 || part.FileName() != "" {
				_ = part.Close()
				return nil, "", "", httpx.Invalid("skill_id", "invalid_format")
			}
			skill = string(value)
		}
		if e = part.Close(); e != nil {
			return nil, "", "", httpx.Invalid("body", "invalid_multipart")
		}
	}
	if !seen["file"] {
		return nil, "", "", httpx.Invalid("file", "required")
	}
	return file, name, skill, nil
}
