package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerAgentSandboxes(user, admin *gin.RouterGroup, o Options) {
	u, a := user.Group(""), admin.Group("")
	for _, group := range []*gin.RouterGroup{u, a} {
		group.Use(func(c *gin.Context) {
			if o.Sandboxes == nil {
				httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "云电脑服务尚未就绪"))
				return
			}
			c.Request = c.Request.WithContext(agents.WithMetadata(c.Request.Context(), metadata(c)))
			c.Next()
		})
	}
	s := o.Sandboxes
	registerSandboxFiles(u, o)
	a.GET("/sandbox-network-presets", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.NetworkPresets(c.Request.Context(), rawSession(c))
	}))
	u.GET("/cloud-computers/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetContentComputer(c.Request.Context(), rawSession(c), id)
	}))
	a.GET("/sandbox-connection", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetConnection(c.Request.Context(), rawSession(c))
	}))
	a.POST("/sandbox-connection/preview", agentJSON[agents.ConnectionWrite](o, 64<<10, func(c *gin.Context, w agents.ConnectionWrite) (*agents.Result, error) {
		return s.PreviewConnection(c.Request.Context(), rawSession(c), w)
	}))
	a.PUT("/sandbox-connection", agentJSON[agents.ConnectionWrite](o, 64<<10, func(c *gin.Context, w agents.ConnectionWrite) (*agents.Result, error) {
		return s.SaveConnection(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
	a.GET("/cloud-computer-template", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetCloudTemplate(c.Request.Context(), rawSession(c), nil)
	}))
	a.PUT("/cloud-computer-template", agentJSON[agents.CloudEnvironment](o, 64<<10, func(c *gin.Context, w agents.CloudEnvironment) (*agents.Result, error) {
		return s.SaveCloudTemplate(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), nil, w)
	}))
	a.GET("/definitions/:id/cloud-computer-template", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetCloudTemplate(c.Request.Context(), rawSession(c), &id)
	}))
	a.PUT("/definitions/:id/cloud-computer-template", agentJSON[agents.CloudEnvironment](o, 64<<10, func(c *gin.Context, w agents.CloudEnvironment) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.SaveCloudTemplate(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), &id, w)
	}))
	a.GET("/cloud-computers", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := cloudComputerQuery(c)
		if !ok {
			return nil, nil
		}
		return s.ListComputers(c.Request.Context(), rawSession(c), q)
	}))
	a.GET("/cloud-computers/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetComputer(c.Request.Context(), rawSession(c), id)
	}))
	a.POST("/cloud-computers/:id/operations", agentJSON[agents.CloudMaintenanceWrite](o, 64<<10, func(c *gin.Context, w agents.CloudMaintenanceWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.MaintainComputer(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
	u.GET("/cloud-computer", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetPersonal(c.Request.Context(), rawSession(c))
	}))
	u.POST("/cloud-computer/activate", agentJSON[struct{}](o, 64<<10, func(c *gin.Context, _ struct{}) (*agents.Result, error) {
		return s.ActivatePersonal(c.Request.Context(), rawSession(c))
	}))
}

func cloudComputerQuery(c *gin.Context) (agents.CloudQuery, bool) {
	q, ok := modelQuery(c, "page", "page_size", "owner_user_id", "pool_agent_id", "state")
	if !ok {
		return agents.CloudQuery{}, false
	}
	page, size, ok := agentPaging(c, q)
	if !ok {
		return agents.CloudQuery{}, false
	}
	owner, ok := agentQueryID(c, q, "owner_user_id")
	if !ok {
		return agents.CloudQuery{}, false
	}
	pool, ok := agentQueryID(c, q, "pool_agent_id")
	if !ok {
		return agents.CloudQuery{}, false
	}
	return agents.CloudQuery{Page: page, PageSize: size, OwnerUserID: owner, PoolAgentID: pool, State: q.Get("state")}, true
}
