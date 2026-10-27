package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerSidebar(business *gin.RouterGroup, o Options) {
	business.GET("/me/sidebar-shortcuts", func(c *gin.Context) {
		out, a, err := o.Identity.Sidebar(c.Request.Context(), rawSession(c))
		if err != nil {
			httpx.Write(c, err)
			return
		}
		setSession(c, o, rawSession(c), a)
		httpx.Data(c, 200, out)
	})
	business.PUT("/me/sidebar-shortcuts/:group", func(c *gin.Context) {
		var body struct {
			IDs []string `json:"ids"`
		}
		if !httpx.Decode(c, &body) {
			return
		}
		out, a, err := o.Identity.ReplaceShortcuts(c.Request.Context(), rawSession(c), c.Param("group"), body.IDs, c.GetHeader("If-Match"))
		if err != nil {
			httpx.Write(c, err)
			return
		}
		setSession(c, o, rawSession(c), a)
		httpx.Data(c, 200, out)
	})
}
