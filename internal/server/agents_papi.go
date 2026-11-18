package server

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func registerAgentPAPI(group *gin.RouterGroup, o Options, s *agents.Service) {
	const path = "/definitions/:id/papi-grants"
	group.GET(path, agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		values, ok := modelQuery(c, "page", "page_size", "q", "granted")
		if !ok {
			return nil, nil
		}
		page, size, ok := agentPaging(c, values)
		if !ok {
			return nil, nil
		}
		q := agents.Query{Page: page, PageSize: size, Q: strings.TrimSpace(values.Get("q"))}
		if raw := values["granted"]; len(raw) != 0 {
			if raw[0] != "true" && raw[0] != "false" {
				return nil, httpx.Invalid("granted", "invalid_boolean")
			}
			granted := raw[0] == "true"
			q.Enabled = &granted
		}
		return s.GetPAPIGrants(c.Request.Context(), rawSession(c), id, q)
	}))
	group.PUT(path+"/:api_code", agentJSON[agents.PAPIGrantWrite](o, 2*papi.MaxSchemaBytes, func(c *gin.Context, input agents.PAPIGrantWrite) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok {
			return nil, nil
		}
		return s.PutPAPIGrant(c.Request.Context(), rawSession(c), id, c.Param("api_code"), c.GetHeader("If-Match"), input)
	}))
	group.DELETE(path+"/:api_code", agentRead(o, func(c *gin.Context) (*agents.Result, error) {
		id, ok := agentID(c, "id")
		if !ok || !modelNoQuery(c) {
			return nil, nil
		}
		return s.DeletePAPIGrant(c.Request.Context(), rawSession(c), id, c.Param("api_code"), c.GetHeader("If-Match"))
	}))
}
