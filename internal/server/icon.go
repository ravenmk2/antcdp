package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerIcons(b *gin.RouterGroup, o Options, s *c.Service) {
	limit := newLimiter(20, time.Minute)
	b.POST("/icon-uploads", func(ctx *gin.Context) {
		if e := o.Identity.UploadAccess(ctx.Request.Context(), rawSession(ctx)); e != nil {
			httpx.Write(ctx, e)
			return
		}
		if !limit.Allow(ctx.ClientIP()) {
			ctx.Header("Retry-After", "60")
			httpx.Write(ctx, httpx.E(429, "RATE_LIMITED", "上传过于频繁，请稍后重试"))
			return
		}
		input, e := avatarInput(ctx)
		if e != nil {
			httpx.Write(ctx, e)
			return
		}
		f, e := o.Icons.Write(ctx.Request.Context(), input)
		if e != nil {
			httpx.Write(ctx, e)
			return
		}
		defer o.Icons.Release(f.Key)
		v, a, e := s.StageIcon(ctx.Request.Context(), rawSession(ctx), f)
		if !collaborationFinish(ctx, o, a, e) {
			return
		}
		id := strconv.FormatUint(v.ID, 10)
		httpx.Data(ctx, 201, gin.H{"id": id, "preview_url": "/api/v1/icons/" + id, "expires_at": timestamp(*v.ExpiresAt)})
	})
	b.DELETE("/icon-uploads/:id", func(ctx *gin.Context) {
		id, ok := parseID(ctx)
		if !ok {
			return
		}
		key, a, e := s.DeleteIconDraft(ctx.Request.Context(), rawSession(ctx), id)
		if !collaborationFinish(ctx, o, a, e) {
			return
		}
		_ = o.Icons.Remove(key)
		ctx.Status(204)
	})
	b.GET("/icons/:id", func(ctx *gin.Context) {
		id, ok := parseID(ctx)
		if !ok {
			return
		}
		v, a, e := s.ReadIcon(ctx.Request.Context(), rawSession(ctx), id)
		if !collaborationFinish(ctx, o, a, e) {
			return
		}
		data, e := o.Icons.Read(v.Key)
		hash := sha256.Sum256(data)
		if e != nil || !bytes.Equal(hash[:], v.Hash) {
			httpx.Write(ctx, httpx.E(503, "MEDIA_UNAVAILABLE", "图标暂时无法读取"))
			return
		}
		tag := `"` + hex.EncodeToString(v.Hash) + `"`
		ctx.Header("Cache-Control", "private, no-cache")
		ctx.Header("ETag", tag)
		for _, candidate := range strings.Split(ctx.GetHeader("If-None-Match"), ",") {
			candidate = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(candidate), "W/"))
			if candidate == tag || candidate == "*" {
				ctx.Status(304)
				return
			}
		}
		ctx.Data(200, "image/png", data)
	})
}
