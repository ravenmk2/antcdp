package server

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
)

func TestSandboxUnavailableAndCSRFBoundary(t *testing.T) {
	h := testHandler(t)
	for _, path := range []string{"/admin/agents/sandbox-connection", "/admin/agents/cloud-computer-template", "/admin/agents/cloud-computers", "/agents/cloud-computer", "/agents/cloud-computers/1/entries"} {
		w := request(h, "GET", "/api/v1"+path, "", "", nil, "")
		assertError(t, w, 503, "INSTANCE_NOT_READY")
	}
	w := request(h, "POST", "/api/v1/admin/agents/sandbox-connection/preview", `{}`, "", nil, "http://antcdp.test")
	assertError(t, w, 403, "CSRF_INVALID")
}

func TestSandboxStrictConfigurationRejectsUntrustedDerivedFields(t *testing.T) {
	router := gin.New()
	router.Use(func(c *gin.Context) {
		id := strings.Repeat("a", 32)
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		c.Next()
	})
	api := router.Group("/api/v1")
	registerAgentSandboxes(api.Group("/agents"), api.Group("/admin/agents"), Options{Sandboxes: &agents.CloudService{}})
	for _, tc := range []struct {
		body, code string
		status     int
	}{
		{`{"name":"first","name":"second"}`, "BAD_REQUEST", 400},
		{`null`, "BAD_REQUEST", 400},
		{`{} {}`, "BAD_REQUEST", 400},
		{`{"owner_id":"1"}`, "VALIDATION_FAILED", 422},
		{`{"config":{"installation_scope":"00000000000000000000000000000000"}}`, "VALIDATION_FAILED", 422},
		{`{"config":{"mounts":[{"host_path":"/"}]}}`, "VALIDATION_FAILED", 422},
		{`{"config":{"network":{"user_default":{"resolved_presets":[]}}}}`, "VALIDATION_FAILED", 422},
		{`{"config":{"network":{"user_default":{"default_action":"allow","default_action":"deny"}}}}`, "BAD_REQUEST", 400},
	} {
		t.Run(tc.body, func(t *testing.T) {
			w := request(router, "POST", "/api/v1/admin/agents/sandbox-connection/preview", tc.body, "", nil, "")
			assertError(t, w, tc.status, tc.code)
		})
	}
}

func TestSandboxQueryRejectsDuplicateFiltersAndForeignSelectors(t *testing.T) {
	for _, tc := range []struct {
		query string
		valid bool
	}{
		{"?page=2&page_size=50&owner_user_id=12&pool_agent_id=8&state=unavailable", true},
		{"?page=1&page=2", false},
		{"?owner_id=9", false},
		{"?cloud_computer_id=1", false},
		{"?owner_user_id=01", false},
		{"?owner_user_id=18446744073709551616", false},
		{"?page_size=101", false},
		{"?state=%zz", false},
	} {
		t.Run(tc.query, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/sandboxes"+tc.query, nil)
			q, ok := cloudComputerQuery(c)
			if ok != tc.valid {
				t.Fatalf("accepted=%v, query=%+v", ok, q)
			}
		})
	}
}

func TestSandboxReadsRejectBodyAndQueryBeforeObservingResources(t *testing.T) {
	router := gin.New()
	api := router.Group("/api/v1")
	registerAgentSandboxes(api.Group("/agents"), api.Group("/admin/agents"), Options{Sandboxes: &agents.CloudService{}})
	for _, tc := range []struct{ path, body string }{
		{"/agents/cloud-computer?user_id=2", ""},
		{"/admin/agents/cloud-computers/01", ""},
		{"/agents/cloud-computers/2/entries?provider_id=1", ""},
		{"/admin/agents/cloud-computer-template", `{"default_provider_id":"1"}`},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1"+tc.path, strings.NewReader(tc.body))
		router.ServeHTTP(w, req)
		if w.Code < 400 || w.Code >= 500 {
			t.Fatalf("invalid read reached service: %d %s", w.Code, w.Body.String())
		}
	}
}
