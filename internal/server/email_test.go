package server

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/email"
)

func TestEmailJSONBudget(t *testing.T) {
	for _, tc := range []struct {
		size int
		ok   bool
	}{{96 << 10, true}, {513 << 10, false}} {
		body, _ := json.Marshal(map[string]string{"body_template": strings.Repeat("x", tc.size)})
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		var tpl email.Template
		if got := decodeEmail(c, &tpl); got != tc.ok {
			t.Fatalf("source bytes %d: accepted=%v", tc.size, got)
		}
	}
}

func TestEmailMultipartMemoryOnly(t *testing.T) {
	for _, fileFirst := range []bool{false, true} {
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		file := func() {
			part, err := w.CreateFormFile("attachments", "说明.txt")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = part.Write([]byte("fixture")); err != nil {
				t.Fatal(err)
			}
		}
		if fileFirst {
			file()
		}
		if err := w.WriteField("payload", `{"recipient":"test@example.com","content":{"subject":"test","body_format":"text","body":"test"}}`); err != nil {
			t.Fatal(err)
		}
		if !fileFirst {
			file()
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/", &body)
		c.Request.Header.Set("Content-Type", w.FormDataContentType())
		var input email.TestInput
		if !emailMultipart(c, &input) || len(input.Attachments) != 1 || string(input.Attachments[0].Data) != "fixture" || input.Recipient != "test@example.com" {
			t.Fatal("multipart order lost payload or attachment")
		}
		// MultipartReader sets an empty sentinel form; it must not populate file metadata.
		if c.Request.MultipartForm != nil && (len(c.Request.MultipartForm.File) != 0 || len(c.Request.MultipartForm.Value) != 0) {
			t.Fatal("unexpected buffered multipart form")
		}
	}
}
