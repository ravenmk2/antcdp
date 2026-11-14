package server

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func agentFinish(c *gin.Context, o Options, result *agents.Result, err error) {
	if err != nil {
		httpx.Write(c, err)
		return
	}
	if result == nil {
		httpx.Write(c, httpx.E(500, "INTERNAL_ERROR", "智能体结果不可用"))
		return
	}
	setSession(c, o, rawSession(c), result.Auth)
	if result.Tag != "" {
		c.Header("ETag", result.Tag)
	}
	if result.Location != "" {
		c.Header("Location", result.Location)
	}
	if result.Replayed {
		c.Header("Idempotency-Replayed", "true")
	}
	status := result.Status
	if status == 0 {
		status = 200
	}
	if status == 202 {
		c.Header("Retry-After", "2")
	}
	if status == 204 {
		c.Status(status)
	} else if result.Pagination != nil {
		c.JSON(status, gin.H{"data": result.Data, "pagination": result.Pagination})
	} else {
		httpx.Data(c, status, result.Data)
	}
}
func agentID(c *gin.Context, name string) (uint64, bool) { return collaborationID(c, name) }
func agentPaging(c *gin.Context, values url.Values) (int, int, bool) {
	page, size := 1, 20
	for _, field := range []struct {
		name  string
		value *int
		max   int
	}{{"page", &page, 1000000}, {"page_size", &size, 100}} {
		if value, ok := values[field.name]; ok {
			n, e := strconv.Atoi(value[0])
			if e != nil || n < 1 || n > field.max {
				httpx.Write(c, httpx.Invalid(field.name, "out_of_range"))
				return 0, 0, false
			}
			*field.value = n
		}
	}
	return page, size, true
}
func agentQueryID(c *gin.Context, values url.Values, name string) (uint64, bool) {
	raw, ok := values[name]
	if !ok {
		return 0, true
	}
	n, e := strconv.ParseUint(raw[0], 10, 64)
	if e != nil || n == 0 || strconv.FormatUint(n, 10) != raw[0] {
		httpx.Write(c, httpx.Invalid(name, "invalid_format"))
		return 0, false
	}
	return n, true
}
func agentQuery(c *gin.Context, extra ...string) (agents.Query, bool) {
	values, ok := modelQuery(c, append([]string{"page", "page_size", "q"}, extra...)...)
	if !ok {
		return agents.Query{}, false
	}
	page, size, ok := agentPaging(c, values)
	if !ok {
		return agents.Query{}, false
	}
	q := agents.Query{Page: page, PageSize: size, Q: strings.TrimSpace(values.Get("q")), Mode: values.Get("agent_type"), ScopeKind: values.Get("scope_kind")}
	if raw, exists := values["enabled"]; exists {
		if raw[0] != "true" && raw[0] != "false" {
			httpx.Write(c, httpx.Invalid("enabled", "invalid_boolean"))
			return q, false
		}
		value := raw[0] == "true"
		q.Enabled = &value
	}
	q.ProjectID, ok = agentQueryID(c, values, "project_id")
	return q, ok
}
func agentObservationQuery(c *gin.Context, extra ...string) (agents.ObservationQuery, bool) {
	values, ok := modelQuery(c, append([]string{"page", "page_size"}, extra...)...)
	if !ok {
		return agents.ObservationQuery{}, false
	}
	page, size, ok := agentPaging(c, values)
	return agents.ObservationQuery{Page: page, PageSize: size, Status: values.Get("status"), Kind: values.Get("kind")}, ok
}
func agentRead(o Options, call func(*gin.Context) (*agents.Result, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !modelEmptyBody(c) {
			return
		}
		result, err := call(c)
		if c.IsAborted() {
			return
		}
		agentFinish(c, o, result, err)
	}
}
func agentJSON[T any](o Options, maxBytes int64, call func(*gin.Context, T) (*agents.Result, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body T
		if !modelNoQuery(c) || !httpx.DecodeStrict(c, &body, maxBytes) {
			return
		}
		result, err := call(c, body)
		if c.IsAborted() {
			return
		}
		agentFinish(c, o, result, err)
	}
}

func registerAgents(api *gin.RouterGroup, o Options) {
	u := api.Group("/agents")
	a := api.Group("/admin/agents")
	for _, group := range []*gin.RouterGroup{u, a} {
		group.Use(func(c *gin.Context) {
			if o.Agents == nil {
				httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "智能体服务尚未就绪"))
				return
			}
			c.Request = c.Request.WithContext(agents.WithMetadata(c.Request.Context(), metadata(c)))
			c.Next()
		})
	}
	s := o.Agents
	u.GET("/capabilities", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.Capabilities(c.Request.Context(), rawSession(c), agents.ImplementedFeatures{Chat: o.AgentHub != nil, Child: o.AgentHub != nil, Skills: o.AgentResources != nil && o.AgentResources.Files != nil, MCP: o.AgentResources != nil && o.AgentResources.MCPFactory != nil, Sandbox: o.Sandboxes != nil && o.Sandboxes.Factory != nil})
	}))
	registerAgentStream(u, o)
	u.GET("/catalog", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := agentQuery(c)
		if !ok {
			return nil, nil
		}
		return s.ListCatalog(c.Request.Context(), rawSession(c), q)
	}))
	u.GET("/catalog/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetCatalog(c.Request.Context(), rawSession(c), id)
	}))
	a.GET("/definitions", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := agentQuery(c, "agent_type", "enabled", "scope_kind", "project_id")
		if !ok {
			return nil, nil
		}
		return s.ListDefinitions(c.Request.Context(), rawSession(c), q)
	}))
	a.POST("/definitions", agentJSON[agents.DefinitionCreate](o, 256<<10, func(c *gin.Context, w agents.DefinitionCreate) (*agents.Result, error) {
		return s.CreateDefinition(c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), w)
	}))
	a.GET("/definitions/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetDefinition(c.Request.Context(), rawSession(c), id)
	}))
	a.GET("/definitions/:id/activation-check", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.CheckActivation(c.Request.Context(), rawSession(c), id)
	}))
	a.PATCH("/definitions/:id", agentJSON[agents.DefinitionPatch](o, 256<<10, func(c *gin.Context, w agents.DefinitionPatch) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PatchDefinition(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	a.DELETE("/definitions/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.DeleteDefinition(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"))
	}))
	a.GET("/definitions/:id/start-options", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.StartOptions(c.Request.Context(), rawSession(c), id)
	}))
	a.POST("/definitions/:id/debug-runs", agentJSON[agents.DebugStart](o, 64<<10, func(c *gin.Context, w agents.DebugStart) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.DebugRun(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
	for _, kind := range []string{"model-bindings", "tool-bindings", "mcp-bindings", "skill-bindings"} {
		a.GET("/definitions/:id/"+kind, agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok || !modelNoQuery(c) {
				return nil, nil
			}
			ctx, raw := c.Request.Context(), rawSession(c)
			switch kind {
			case "model-bindings":
				return s.GetModelBindings(ctx, raw, id)
			case "tool-bindings":
				return s.GetToolBindings(ctx, raw, id)
			case "skill-bindings":
				return s.GetSkillBindings(ctx, raw, id)
			default:
				return s.GetMCPBindings(ctx, raw, id)
			}
		}))
	}
	a.PUT("/definitions/:id/skill-bindings", agentJSON[agents.SkillBindingsWrite](o, 64<<10, func(c *gin.Context, w agents.SkillBindingsWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PutSkillBindings(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	a.PUT("/definitions/:id/model-bindings", agentJSON[agents.ModelBindingsWrite](o, 64<<10, func(c *gin.Context, w agents.ModelBindingsWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PutModelBindings(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	a.PUT("/definitions/:id/tool-bindings", agentJSON[agents.ToolBindingsWrite](o, 64<<10, func(c *gin.Context, w agents.ToolBindingsWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PutToolBindings(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	a.PUT("/definitions/:id/mcp-bindings", agentJSON[agents.MCPBindingsWrite](o, 64<<10, func(c *gin.Context, w agents.MCPBindingsWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PutMCPBindings(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	a.GET("/tool-catalog", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := agentQuery(c)
		if !ok {
			return nil, nil
		}
		return s.ListToolCatalog(c.Request.Context(), rawSession(c), q)
	}))
	for _, group := range []*gin.RouterGroup{u, a} {
		admin := group == a
		group.GET("/command-receipts/:key", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			values, ok := modelQuery(c, "command", "scope")
			if !ok {
				return nil, nil
			}
			if admin {
				return s.GetAdminCommandReceipt(c.Request.Context(), rawSession(c), c.Param("key"), values.Get("command"), values.Get("scope"))
			}
			return s.GetCommandReceipt(c.Request.Context(), rawSession(c), c.Param("key"), values.Get("command"), values.Get("scope"))
		}))
	}
	registerAgentSessions(u, o)
	registerAgentFiles(u, o)
	registerAgentUsage(u, a, o)
	registerAgentResources(a, o)
	registerAgentSandboxes(u, a, o)
	a.GET("/operations/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetAdminOperation(c.Request.Context(), rawSession(c), id)
	}))
	workspace := api.Group("/workspace")
	workspace.Use(func(c *gin.Context) {
		if o.Agents == nil {
			httpx.Write(c, httpx.E(503, "INSTANCE_NOT_READY", "工作台查询尚未就绪"))
			return
		}
		c.Next()
	})
	workspace.GET("/attention-summary", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		if !modelNoQuery(c) {
			return nil, nil
		}
		return s.WorkspaceAttentionSummary(c.Request.Context(), rawSession(c))
	}))
	workspace.GET("/attention", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		values, ok := modelQuery(c, "kind", "page", "page_size")
		if !ok {
			return nil, nil
		}
		page, size, ok := agentPaging(c, values)
		if !ok {
			return nil, nil
		}
		return s.WorkspaceAttention(c.Request.Context(), rawSession(c), values.Get("kind"), agents.ObservationQuery{Page: page, PageSize: size})
	}))
}
func registerAgentSessions(u *gin.RouterGroup, o Options) {
	s := o.Agents
	u.GET("/operations/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetOperation(c.Request.Context(), rawSession(c), id)
	}))
	u.POST("/sessions/:id/compact", agentJSON[struct{}](o, 64<<10, func(c *gin.Context, _ struct{}) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.CompactSession(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"))
	}))
	u.GET("/sessions", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		values, ok := modelQuery(c, "page", "page_size", "q", "agent_id", "agent_type", "archived", "attention")
		if !ok {
			return nil, nil
		}
		page, size, ok := agentPaging(c, values)
		if !ok {
			return nil, nil
		}
		id, ok := agentQueryID(c, values, "agent_id")
		if !ok {
			return nil, nil
		}
		return s.ListSessions(c.Request.Context(), rawSession(c), agents.SessionQuery{Page: page, PageSize: size, Q: values.Get("q"), AgentID: id, Mode: values.Get("agent_type"), Archived: values.Get("archived"), Attention: values.Get("attention")})
	}))
	u.POST("/sessions", agentJSON[agents.SessionCreate](o, 64<<10, func(c *gin.Context, w agents.SessionCreate) (*agents.Result, error) {
		return s.CreateSession(c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), w)
	}))
	for _, name := range []string{"", "/configuration", "/preference"} {
		u.GET("/sessions/:id"+name, agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok || !modelNoQuery(c) {
				return nil, nil
			}
			switch name {
			case "/configuration":
				return s.GetSessionConfiguration(c.Request.Context(), rawSession(c), id)
			case "/preference":
				return s.GetPreference(c.Request.Context(), rawSession(c), id)
			default:
				return s.GetSession(c.Request.Context(), rawSession(c), id)
			}
		}))
	}
	u.PATCH("/sessions/:id/configuration", agentJSON[agents.SessionPatch](o, 64<<10, func(c *gin.Context, w agents.SessionPatch) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PatchSessionConfiguration(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	u.PATCH("/sessions/:id/preference", agentJSON[agents.PreferencePatch](o, 64<<10, func(c *gin.Context, w agents.PreferencePatch) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PatchPreference(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w)
	}))
	u.PUT("/sessions/:id/view-state", agentJSON[agents.ViewStateWrite](o, 64<<10, func(c *gin.Context, w agents.ViewStateWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.AdvanceView(c.Request.Context(), rawSession(c), id, w)
	}))
	for _, action := range []string{"archive", "restore", "queue/resume", "title/refresh"} {
		u.POST("/sessions/:id/"+action, agentJSON[struct{}](o, 64<<10, func(c *gin.Context, _ struct{}) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok {
				return nil, nil
			}
			ctx, raw, key, tag := c.Request.Context(), rawSession(c), c.GetHeader("Idempotency-Key"), c.GetHeader("If-Match")
			switch action {
			case "archive":
				return s.ArchiveSession(ctx, raw, id, tag, key)
			case "restore":
				return s.RestoreSession(ctx, raw, id, tag, key)
			case "title/refresh":
				return s.RefreshSessionTitle(ctx, raw, id, tag, key)
			default:
				return s.ResumeQueue(ctx, raw, id, key)
			}
		}))
	}
	u.GET("/sessions/:id/history", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		values, ok := modelQuery(c, "through_seq", "before_seq", "limit")
		if !ok {
			return nil, nil
		}
		q := agents.HistoryQuery{}
		for _, field := range []struct {
			name   string
			target **uint64
		}{{"through_seq", &q.Through}, {"before_seq", &q.Before}} {
			if value, present := values[field.name]; present {
				n, e := strconv.ParseUint(value[0], 10, 64)
				if e != nil || strconv.FormatUint(n, 10) != value[0] {
					return nil, httpx.Invalid(field.name, "invalid_format")
				}
				*field.target = &n
			}
		}
		if value, present := values["limit"]; present {
			n, e := strconv.Atoi(value[0])
			if e != nil || n < 1 || n > 200 {
				return nil, httpx.Invalid("limit", "out_of_range")
			}
			q.Limit = n
		}
		return s.History(c.Request.Context(), rawSession(c), id, q)
	}))
	u.POST("/sessions/:id/inputs", agentJSON[agents.InputCreate](o, 64<<10, func(c *gin.Context, w agents.InputCreate) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.SubmitInput(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"), w)
	}))
	u.GET("/sessions/:id/inputs", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		values, ok := modelQuery(c, "page", "page_size", "state")
		if !ok {
			return nil, nil
		}
		page, size, ok := agentPaging(c, values)
		if !ok {
			return nil, nil
		}
		return s.ListInputs(c.Request.Context(), rawSession(c), id, agents.InputQuery{Page: page, PageSize: size, State: values.Get("state")})
	}))
	for _, method := range []string{"GET", "DELETE"} {
		u.Handle(method, "/sessions/:id/inputs/:input_id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
			id, ok := agentID(c, "id")
			if !ok || !modelNoQuery(c) {
				return nil, nil
			}
			input, ok := agentID(c, "input_id")
			if !ok {
				return nil, nil
			}
			if method == "GET" {
				return s.GetInput(c.Request.Context(), rawSession(c), id, input)
			}
			return s.RemoveInput(c.Request.Context(), rawSession(c), id, input, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"))
		}))
	}
	u.PATCH("/sessions/:id/inputs/:input_id", agentJSON[agents.InputEdit](o, 64<<10, func(c *gin.Context, w agents.InputEdit) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		input, ok := agentID(c, "input_id")
		if !ok {
			return nil, nil
		}
		return s.EditInput(c.Request.Context(), rawSession(c), id, input, c.GetHeader("If-Match"), w)
	}))
	u.GET("/sessions/:id/runs", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := agentObservationQuery(c, "status")
		if !ok {
			return nil, nil
		}
		return s.ListRuns(c.Request.Context(), rawSession(c), id, q)
	}))
	u.GET("/sessions/:id/interactions", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := agentObservationQuery(c, "status", "kind")
		if !ok {
			return nil, nil
		}
		return s.ListInteractions(c.Request.Context(), rawSession(c), id, q)
	}))
	u.GET("/interactions/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetInteraction(c.Request.Context(), rawSession(c), id)
	}))
	u.GET("/runs/:id", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.GetRun(c.Request.Context(), rawSession(c), id)
	}))
	u.GET("/runs/:id/children", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := agentObservationQuery(c)
		if !ok {
			return nil, nil
		}
		return s.ListChildren(c.Request.Context(), rawSession(c), id, q)
	}))
	u.GET("/runs/:id/tool-calls", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := agentObservationQuery(c, "status")
		if !ok {
			return nil, nil
		}
		return s.ListToolCalls(c.Request.Context(), rawSession(c), id, q)
	}))
	u.POST("/runs/:id/stop", agentJSON[agents.StopRunWrite](o, 64<<10, func(c *gin.Context, w agents.StopRunWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.StopRun(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"), w)
	}))
	u.POST("/runs/:id/retry", agentJSON[agents.RetryRunWrite](o, 64<<10, func(c *gin.Context, w agents.RetryRunWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.RetryRun(c.Request.Context(), rawSession(c), id, c.GetHeader("Idempotency-Key"), w)
	}))
	u.POST("/interactions/:id/answers", agentJSON[agentcore.QuestionAnswer](o, 64<<10, func(c *gin.Context, w agentcore.QuestionAnswer) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.AnswerInteraction(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
	u.POST("/interactions/:id/decisions", agentJSON[agents.DecisionWrite](o, 64<<10, func(c *gin.Context, w agents.DecisionWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.DecideInteraction(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), c.GetHeader("Idempotency-Key"), w)
	}))
}
