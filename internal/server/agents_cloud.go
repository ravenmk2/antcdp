package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerAgentSandboxes(user, admin, infra *gin.RouterGroup, o Options) {
	u, a := user.Group(""), admin.Group("")
	for _, group := range []*gin.RouterGroup{u, a, infra} {
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
	for _, group := range []*gin.RouterGroup{u, a} {
		group.GET("/cloud-computers/operations/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok {
				return nil, nil
			}
			return s.GetOperation(c.Request.Context(), rawSession(c), id)
		}))
	}
	registerSandboxFiles(u, o)
	infra.GET("/network-presets", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
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
	infra.GET("/connection", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetConnection(c.Request.Context(), rawSession(c))
	}))
	infra.POST("/connection/preview", agentJSON[agents.ConnectionWrite](o, 64<<10, func(c *gin.Context, w agents.ConnectionWrite) (*agents.Result, error) {
		return s.PreviewConnection(c.Request.Context(), rawSession(c), w)
	}))
	infra.PUT("/connection", agentJSON[agents.ConnectionWrite](o, 64<<10, func(c *gin.Context, w agents.ConnectionWrite) (*agents.Result, error) {
		return s.SaveConnection(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
	registerSandboxSpecs(infra, o)
	infra.POST("/connection/health-check", agentJSON[struct{}](o, 1024, func(c *gin.Context, _ struct{}) (*agents.Result, error) {
		return s.CheckConnection(c.Request.Context(), rawSession(c))
	}))
	infra.GET("/command-receipts/:key", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		values, ok := modelQuery(c, "scope", "command")
		if !ok {
			return nil, nil
		}
		return s.GetSandboxReceipt(c.Request.Context(), rawSession(c), c.Param("key"), values.Get("command"), values.Get("scope"))
	}))
	a.GET("/cloud-computer-spec", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetBinding(c.Request.Context(), rawSession(c), nil)
	}))
	a.PUT("/cloud-computer-spec", agentJSON[agents.BindingWrite](o, 64<<10, func(c *gin.Context, w agents.BindingWrite) (*agents.Result, error) {
		return s.SaveBinding(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), nil, w)
	}))
	a.GET("/definitions/:id/cloud-computer-spec", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetBinding(c.Request.Context(), rawSession(c), &id)
	}))
	a.PUT("/definitions/:id/cloud-computer-spec", agentJSON[agents.BindingWrite](o, 64<<10, func(c *gin.Context, w agents.BindingWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.SaveBinding(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), &id, w)
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

func registerSandboxSpecs(g *gin.RouterGroup, o Options) {
	s := o.Sandboxes
	g.GET("/specs", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.ListSpecs(c.Request.Context(), rawSession(c))
	}))
	for _, path := range []string{"/specs/:id", "/specs/:id/references"} {
		g.GET(path, agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok || !modelNoQuery(c) {
				return nil, nil
			}
			return s.GetSpec(c.Request.Context(), rawSession(c), id, path == "/specs/:id/references")
		}))
	}
	for _, method := range []string{"POST", "PUT"} {
		path := "/specs"
		if method == "PUT" {
			path += "/:id"
		}
		g.Handle(method, path, agentJSON[agents.SpecWrite](o, 64<<10, func(c *gin.Context, w agents.SpecWrite) (*agents.Result, error) {
			var id uint64
			if method == "PUT" {
				var ok bool
				id, ok = agentID(c, "id")
				if !ok {
					return nil, nil
				}
			}
			return s.SaveSpec(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), id, w)
		}))
	}
	g.DELETE("/specs/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.DeleteSpec(c.Request.Context(), rawSession(c), c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), id)
	}))
}
