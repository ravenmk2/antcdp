package server

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestModelRoutesRequireSessionAndCSRF(t *testing.T) {
	h := testHandler(t)
	for _, path := range []string{
		"/admin/models/provider-types", "/admin/models/providers", "/admin/models/providers/1",
		"/admin/models/definitions", "/admin/models/definitions/1",
	} {
		t.Run(path, func(t *testing.T) {
			w := request(h, "GET", "/api/v1"+path, "", "", nil, "")
			assertError(t, w, 401, "UNAUTHENTICATED")
		})
	}
	w := request(h, "POST", "/api/v1/admin/models/providers", `{}`, "", nil, "http://antcdp.test")
	assertError(t, w, 403, "CSRF_INVALID")
}

func TestModelStrictWriteBoundary(t *testing.T) {
	h := testHandler(t)
	csrf, cookies := csrfState(t, h)
	for _, tc := range []struct {
		body, code string
		status     int
	}{
		{`{"name":"a","name":"b"}`, "BAD_REQUEST", 400},
		{`{"config":{"base_url":"https://example.test","base_url":"https://other.test"}}`, "BAD_REQUEST", 400},
		{`{"owner_id":"1"}`, "VALIDATION_FAILED", 422},
		{`null`, "BAD_REQUEST", 400},
		{`{} {}`, "BAD_REQUEST", 400},
	} {
		w := request(h, "POST", "/api/v1/admin/models/providers", tc.body, csrf, cookies, "http://antcdp.test")
		assertError(t, w, tc.status, tc.code)
	}
}

func TestModelQueriesRejectAmbiguousAndCrossCollectionFilters(t *testing.T) {
	for _, tc := range []struct {
		query              string
		definitions, valid bool
	}{
		{"?page=2&page_size=10&q=%E6%A8%A1%E5%9E%8B&enabled=false", false, true},
		{"?provider_id=12&protocol=chat_completions", true, true},
		{"?provider_id=12", false, false},
		{"?provider_type=deepseek", true, false},
		{"?page=1&page=2", false, false},
		{"?enabled=0", false, false},
		{"?provider_id=01", true, false},
		{"?provider_id=18446744073709551616", true, false},
		{"?q=" + strings.Repeat("x", 65), false, false},
		{"?page_size=101", false, false},
		{"?unknown=secret", false, false},
		{"?q=%zz", false, false},
	} {
		t.Run(tc.query, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/models"+tc.query, nil)
			q, valid := modelListQuery(c, tc.definitions)
			if valid != tc.valid {
				t.Fatalf("accepted=%v query=%+v", valid, q)
			}
			if valid && strings.Contains(tc.query, "enabled=false") && (q.Enabled == nil || *q.Enabled) {
				t.Fatal("explicit false filter lost")
			}
		})
	}
}
