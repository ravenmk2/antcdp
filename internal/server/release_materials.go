package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func releaseIDs(c *gin.Context) (d.Command, uint64, uint64, bool) {
	cmd, ok := deliveryCommand(c)
	if !ok {
		return cmd, 0, 0, false
	}
	rid, ok := collaborationID(c, "rid")
	if !ok {
		return cmd, 0, 0, false
	}
	var id uint64
	if c.Param("mid") != "" {
		id, ok = collaborationID(c, "mid")
	}
	return cmd, rid, id, ok
}
func registerReleaseMaterials(base *gin.RouterGroup, o Options, s *d.Service, finish deliveryResponse) {
	group := base.Group("/releases/:rid")
	for _, p := range []string{"/removed-items", "/items/:mid/revisions"} {
		group.GET(p, func(c *gin.Context) {
			cmd, rid, id, ok := releaseIDs(c)
			if !ok {
				return
			}
			out, a, e := s.MaterialHistory(c.Request.Context(), rawSession(c), cmd, rid, id)
			finish(c, out, a, e, 200)
		})
	}
	group.GET("/items", func(c *gin.Context) {
		cmd, rid, _, ok := releaseIDs(c)
		if !ok {
			return
		}
		out, a, e := s.Materials(c.Request.Context(), rawSession(c), cmd, rid)
		finish(c, out, a, e, 200)
	})
	save := func(c *gin.Context) {
		cmd, rid, id, ok := releaseIDs(c)
		if !ok {
			return
		}
		ctx := c.Request.Context()
		raw := rawSession(c)
		if _, e := s.MaterialAccess(ctx, raw, cmd, rid); e != nil {
			httpx.Write(c, e)
			return
		}
		root, e := os.OpenRoot(o.Runtime.DataDir)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		defer func() { _ = root.Close() }()
		uploadID := cryptox.ID()
		releaseLease := leaseReleaseUpload(uploadID)
		defer releaseLease()
		w, upload, n, h, e := materialParts(c, root, uploadID)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		out, a, e := s.SaveMaterial(ctx, raw, cmd, rid, id, w, root, upload, n, h)
		status := 200
		if id == 0 {
			status = 201
		}
		finish(c, out, a, e, status)
	}
	group.POST("/items", save)
	group.PATCH("/items/:mid", save)
	group.DELETE("/items/:mid", func(c *gin.Context) {
		cmd, rid, id, ok := releaseIDs(c)
		if !ok {
			return
		}
		out, a, e := s.ChangeMaterials(c.Request.Context(), rawSession(c), cmd, rid, id, nil)
		finish(c, out, a, e, 200)
	})
	group.PUT("/sql-order", func(c *gin.Context) {
		cmd, rid, _, ok := releaseIDs(c)
		if !ok {
			return
		}
		var w struct {
			IDs []string `json:"item_ids"`
		}
		if !collaborationBody(c, &w) {
			return
		}
		ids := make([]uint64, len(w.IDs))
		for n, v := range w.IDs {
			var e error
			ids[n], e = dID(v)
			if e != nil {
				httpx.Write(c, e)
				return
			}
		}
		out, a, e := s.ChangeMaterials(c.Request.Context(), rawSession(c), cmd, rid, 0, ids)
		finish(c, out, a, e, 200)
	})
	group.GET("/items/:mid/revisions/:rev/file", func(c *gin.Context) {
		cmd, rid, id, ok := releaseIDs(c)
		if !ok {
			return
		}
		m, a, e := s.DownloadMaterial(c.Request.Context(), rawSession(c), cmd, rid, id, c.Param("rev"))
		if !collaborationFinish(c, o, a, e) {
			return
		}
		root, e := os.OpenRoot(o.Runtime.DataDir)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		defer func() { _ = root.Close() }()
		f, e := root.Open(m.StorageKey)
		if e != nil {
			httpx.Write(c, e)
			return
		}
		defer func() { _ = f.Close() }()
		info, e := f.Stat()
		if e != nil || !info.Mode().IsRegular() || info.Size() != m.Size {
			httpx.Write(c, httpx.E(500, "FILE_INTEGRITY", "文件不完整"))
			return
		}
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": m.Filename}))
		c.Header("Content-Type", "application/octet-stream")
		c.Header("X-Content-Type-Options", "nosniff")
		http.ServeContent(c.Writer, c.Request, m.Filename, info.ModTime(), f)
	})
}
func materialParts(c *gin.Context, root *os.Root, uploadID string) (m d.MaterialInfo, upload string, n int64, hash string, err error) {
	const metaLimit = 128 << 10
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, d.MaterialLimit+metaLimit+65536)
	reader, e := c.Request.MultipartReader()
	if e != nil {
		err = httpx.Invalid("body", "multipart_required")
		return
	}
	hasMeta := false
	for {
		part, e := reader.NextPart()
		if errors.Is(e, io.EOF) {
			break
		}
		if e != nil {
			err = httpx.Invalid("file", "invalid_upload")
			return
		}
		switch part.FormName() {
		case "metadata":
			if hasMeta {
				err = httpx.Invalid("metadata", "duplicate")
				return
			}
			hasMeta = true
			var b []byte
			b, e = io.ReadAll(io.LimitReader(part, metaLimit+1))
			if e != nil || len(b) > metaLimit {
				err = httpx.Invalid("metadata", "too_large")
				return
			}
			dec := json.NewDecoder(bytes.NewReader(b))
			dec.DisallowUnknownFields()
			if dec.Decode(&m) != nil || dec.Decode(&struct{}{}) != io.EOF {
				err = httpx.Invalid("metadata", "invalid_json")
				return
			}
		case "file":
			if upload != "" {
				err = httpx.Invalid("file", "duplicate")
				return
			}
			upload = uploadID
			n, hash, err = d.StageMaterial(root, upload, part)
			if err != nil {
				return
			}
		default:
			err = httpx.Invalid(strings.TrimSpace(part.FormName()), "unexpected_field")
			return
		}
	}
	if !hasMeta {
		err = httpx.Invalid("metadata", "required")
	}
	return
}
