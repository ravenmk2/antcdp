package server

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func agentUsageQuery(c *gin.Context, fields ...string) (agents.UsageQuery, bool) {
	values, ok := modelQuery(c, fields...)
	if !ok {
		return agents.UsageQuery{}, false
	}
	page, size, ok := agentPaging(c, values)
	if !ok {
		return agents.UsageQuery{}, false
	}
	q := agents.UsageQuery{Page: page, PageSize: size, Mode: values.Get("agent_type"), Status: values.Get("status"), GroupBy: values.Get("group_by")}
	for _, field := range []struct {
		name   string
		target *uint64
	}{{"agent_id", &q.AgentID}, {"model_definition_id", &q.ModelID}, {"provider_id", &q.ProviderID}, {"owner_user_id", &q.OwnerID}, {"run_id", &q.RunID}} {
		id, ok := agentQueryID(c, values, field.name)
		if !ok {
			return q, false
		}
		*field.target = id
	}
	for _, field := range []struct {
		name   string
		target **time.Time
	}{{"from", &q.From}, {"to", &q.To}} {
		if value, present := values[field.name]; present {
			parsed, e := time.Parse(time.RFC3339Nano, value[0])
			if e != nil {
				httpx.Write(c, httpx.Invalid(field.name, "invalid_timestamp"))
				return q, false
			}
			parsed = parsed.UTC()
			*field.target = &parsed
		}
	}
	return q, true
}
func registerAgentUsage(u, a *gin.RouterGroup, o Options) {
	s := o.Agents
	a.GET("/usage", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := agentUsageQuery(c, "from", "to", "group_by", "agent_id", "model_definition_id", "provider_id", "agent_type", "owner_user_id")
		if !ok {
			return nil, nil
		}
		return s.UsageReport(c.Request.Context(), rawSession(c), q)
	}))
	a.GET("/runs", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := agentUsageQuery(c, "page", "page_size", "from", "to", "status", "agent_id", "model_definition_id", "provider_id", "agent_type", "owner_user_id")
		if !ok {
			return nil, nil
		}
		return s.RunMetadata(c.Request.Context(), rawSession(c), q)
	}))
	a.GET("/model-calls", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		q, ok := agentUsageQuery(c, "page", "page_size", "from", "to", "status", "run_id", "model_definition_id", "provider_id")
		if !ok {
			return nil, nil
		}
		return s.ModelCalls(c.Request.Context(), rawSession(c), q, true)
	}))
	u.GET("/runs/:id/model-calls", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		q, ok := agentUsageQuery(c, "page", "page_size")
		if !ok {
			return nil, nil
		}
		q.RunID = id
		return s.ModelCalls(c.Request.Context(), rawSession(c), q, false)
	}))
	u.GET("/sessions/:id/usage", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.SessionUsage(c.Request.Context(), rawSession(c), id)
	}))
}
