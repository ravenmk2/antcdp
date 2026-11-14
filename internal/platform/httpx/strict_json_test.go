package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStrictJSONRejectsAmbiguousAndOversizedRequests(t *testing.T) {
	for _, tc := range []struct {
		name   string
		body   string
		limit  int64
		status int
	}{
		{"valid", `{"config":{"key":1,"list":[{"key":2}]}}`, 1024, 204},
		{"duplicate", `{"config":{},"config":{"key":1}}`, 1024, 400},
		{"nested duplicate", `{"config":{"key":1,"key":2}}`, 1024, 400},
		{"escaped duplicate", `{"config":{"key":1,"\u006bey":2}}`, 1024, 400},
		{"array duplicate", `{"config":{"list":[{"key":1,"key":2}]}}`, 1024, 400},
		{"not object", `[]`, 1024, 400},
		{"null", `null`, 1024, 400},
		{"trailing", `{"config":{}} {}`, 1024, 400},
		{"unknown", `{"unsupported":true}`, 1024, 422},
		{"depth", `{"config":` + strings.Repeat("[", 65) + `0` + strings.Repeat("]", 65) + `}`, 1024, 400},
		{"size", `{"config":{"key":"long value"}}`, 16, 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			var value struct {
				Config map[string]any `json:"config"`
			}
			if DecodeStrict(c, &value, tc.limit) {
				c.Status(204)
				c.Writer.WriteHeaderNow()
			}
			if response.Code != tc.status {
				t.Fatalf("got status %d, want %d", response.Code, tc.status)
			}
		})
	}
}
