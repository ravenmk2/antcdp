package server

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAgentStreamFramesRejectCommandAndAmbiguousInputs(t *testing.T) {
	for _, raw := range []string{`{"type":"subscribe","subscription_id":"main","session_id":"18446744073709551615","history_limit":200}`, `{"type":"unsubscribe","subscription_id":"main"}`, `{"type":"resync","subscription_id":"main"}`, `{"type":"ping","nonce":"ping-1"}`} {
		if _, e := parseAgentFrame([]byte(raw)); e != nil {
			t.Fatalf("valid %s: %v", raw, e)
		}
	}
	for _, raw := range []string{`null`, `[]`, `{"type":"submit","content":"execute"}`, `{"type":"subscribe","subscription_id":"main","session_id":1}`, `{"type":"subscribe","subscription_id":"main","session_id":"01"}`, `{"type":"subscribe","subscription_id":"main","session_id":"1","history_limit":null}`, `{"type":"ping","nonce":"p","subscription_id":""}`, `{"type":"ping","nonce":"a","nonce":"b"}`, `{"type":"resync","subscription_id":"a","session_id":"2"}`, `{"type":"ping","nonce":"汉字"}`, `{"type":"subscribe","subscription_id":"main","session_id":"1","history_limit":201}`, `{"type":"ping","nonce":"a"} {}`, strings.Repeat(" ", 16<<10) + `{}`} {
		if _, e := parseAgentFrame([]byte(raw)); e == nil {
			t.Fatalf("invalid frame accepted %s", raw)
		}
	}
}
func TestAgentMultipartRejectsExtraPartsAndRawPathFilename(t *testing.T) {
	for _, tc := range []struct {
		name     string
		filename string
		extra    bool
		size     int
		valid    bool
	}{{"ok", "skill.zip", false, 8, true}, {"path", "../skill.zip", false, 8, false}, {"duplicate", "skill.zip", true, 8, false}, {"over", "skill.zip", false, 17, false}} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, e := writer.CreateFormFile("file", tc.filename)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = part.Write(bytes.Repeat([]byte{'x'}, tc.size)); e != nil {
				t.Fatal(e)
			}
			if tc.extra {
				if e = writer.WriteField("file", "duplicate"); e != nil {
					t.Fatal(e)
				}
			}
			if e = writer.Close(); e != nil {
				t.Fatal(e)
			}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/skills/uploads", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			_, _, _, e = agentMultipart(c, 16, 2048, true)
			if (e == nil) != tc.valid {
				t.Fatalf("accepted=%v error=%v", e == nil, e)
			}
		})
	}
}
func TestAgentsUnavailableDoNotClaimWorkingCapabilities(t *testing.T) {
	h := testHandler(t)
	for _, path := range []string{"/api/v1/agents/capabilities", "/api/v1/agents/stream", "/api/v1/admin/agents/definitions", "/api/v1/admin/agents/skills"} {
		w := request(h, "GET", path, "", "", nil, "")
		assertError(t, w, 503, "INSTANCE_NOT_READY")
	}
}
