package server

import (
	"mime"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerReleaseFlow(base *gin.RouterGroup, o Options, s *d.Service, finish deliveryResponse) {
	r := base.Group("/releases/:rid")
	r.GET("/workflow", func(c *gin.Context) {
		cmd, rid, _, ok := releaseIDs(c)
		if !ok {
			return
		}
		out, a, e := s.Workflow(c.Request.Context(), rawSession(c), cmd, rid)
		finish(c, out, a, e, 200)
	})
	for _, action := range []string{"scope-preview", "refresh-scope", "git-identity", "baseline", "mr-options", "select-mr", "include-commit", "link-revert", "start", "review", "return", "terminate", "remove-change", "freeze-preview", "freeze", "merge", "archive", "create-revert", "reconcile"} {
		r.POST("/"+action, func(c *gin.Context) {
			cmd, rid, _, ok := releaseIDs(c)
			if !ok {
				return
			}
			var w d.FlowWrite
			if !collaborationBody(c, &w) {
				return
			}
			ctx, raw := c.Request.Context(), rawSession(c)
			switch action {
			case "scope-preview", "refresh-scope":
				out, a, e := s.ReleaseScope(ctx, raw, cmd, rid, w.Digest, action == "refresh-scope")
				finish(c, out, a, e, 200)
			case "git-identity":
				out, a, e := s.ReleaseActors(ctx, raw, cmd, rid, w.Repo)
				finish(c, out, a, e, 200)
			case "baseline", "mr-options", "select-mr", "include-commit", "link-revert":
				out, a, e := s.GitInput(ctx, raw, cmd, rid, action, w)
				finish(c, out, a, e, 200)
			case "start", "review", "return", "terminate", "remove-change":
				out, a, e := s.LocalFlow(ctx, raw, cmd, rid, action, w)
				finish(c, out, a, e, 200)
			case "freeze-preview", "freeze":
				root, e := os.OpenRoot(o.Runtime.DataDir)
				if e != nil {
					httpx.Write(c, e)
					return
				}
				defer func() { _ = root.Close() }()
				out, a, e := s.Freeze(ctx, raw, cmd, rid, w.Digest, action == "freeze", root)
				finish(c, out, a, e, 200)
			case "reconcile":
				out, a, e := s.ReconcileRelease(ctx, raw, cmd, rid, w)
				finish(c, out, a, e, 200)
			default:
				out, a, e := s.GitOperation(ctx, raw, cmd, rid, action, c.GetHeader("Idempotency-Key"), w)
				finish(c, out, a, e, 200)
			}
		})
	}
	for _, download := range []bool{false, true} {
		p := "/manifests/:manifest"
		if download {
			p += "/download"
		}
		r.GET(p, func(c *gin.Context) {
			cmd, rid, _, ok := releaseIDs(c)
			if !ok {
				return
			}
			mid, ok := collaborationID(c, "manifest")
			if !ok {
				return
			}
			data, a, e := s.ManifestData(c.Request.Context(), rawSession(c), cmd, rid, mid)
			if !collaborationFinish(c, o, a, e) {
				return
			}
			if !download {
				httpx.Data(c, 200, data)
				return
			}
			root, e := os.OpenRoot(o.Runtime.DataDir)
			if e != nil {
				httpx.Write(c, e)
				return
			}
			defer func() { _ = root.Close() }()
			c.Header("Content-Type", "application/zip")
			c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "release-" + c.Param("rid") + "-manifest-" + c.Param("manifest") + ".zip"}))
			if e = data.WriteZip(root, c.Writer); e != nil {
				if c.Writer.Written() {
					panic(http.ErrAbortHandler)
				}
				c.Header("Content-Disposition", "")
				httpx.Write(c, e)
			}
		})
	}
}
