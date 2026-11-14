package server

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
)

func TestAttachmentMultipartValidatesEndingBeforeSuccess(t *testing.T) {
	for _, tc := range []struct {
		name             string
		extra, truncated bool
		filename         string
	}{
		{name: "complete", filename: "report.txt"},
		{name: "extra", filename: "report.txt", extra: true},
		{name: "truncated", filename: "report.txt", truncated: true},
		{name: "path", filename: "../report.txt"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			part, e := form.CreateFormFile("file", tc.filename)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = io.WriteString(part, "complete bytes"); e != nil {
				t.Fatal(e)
			}
			if tc.extra {
				if e = form.WriteField("unexpected", "value"); e != nil {
					t.Fatal(e)
				}
			}
			if e = form.Close(); e != nil {
				t.Fatal(e)
			}
			wire := body.Bytes()
			if tc.truncated {
				wire = wire[:len(wire)-12]
			}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/", bytes.NewReader(wire))
			c.Request.Header.Set("Content-Type", form.FormDataContentType())
			source, _, e := agentAttachmentSource(c)
			if e == nil {
				_, e = io.ReadAll(source)
			}
			if (e == nil) != (tc.name == "complete") {
				t.Fatalf("error=%v", e)
			}
		})
	}
}

type fileTestReader struct{ *strings.Reader }

func (fileTestReader) Close() error { return nil }

func TestAgentFileRangeAndPreviewPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, ranges      string
		preview           bool
		status            int
		body, disposition string
	}{
		{"full", "", true, 200, "0123456789", "inline"},
		{"single", "bytes=2-4", true, 206, "234", "inline"},
		{"multiple", "bytes=0-1,4-5", true, 416, "", "inline"},
		{"invalid", "nonsense", true, 416, "", "inline"},
		{"out_of_range", "bytes=20-30", true, 416, "", "inline"},
		{"unsafe_inline", "", false, 200, "0123456789", "attachment"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest("GET", "/", nil)
			if tc.ranges != "" {
				c.Request.Header.Set("Range", tc.ranges)
			}
			serveAgentFile(c, &agents.FileContent{Reader: fileTestReader{strings.NewReader("0123456789")}, Filename: "报告.html", MediaType: "text/plain", Size: 10, Preview: tc.preview}, "inline")
			if w.Code != tc.status {
				t.Fatalf("status %d", w.Code)
			}
			if tc.status != 416 && w.Body.String() != tc.body {
				t.Fatalf("body=%q", w.Body.String())
			}
			if !strings.HasPrefix(w.Header().Get("Content-Disposition"), tc.disposition+";") {
				t.Fatal("unsafe disposition")
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("missing safe download headers")
			}
		})
	}
}
