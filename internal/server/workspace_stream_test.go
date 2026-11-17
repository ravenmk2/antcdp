package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestWorkspaceStreamForwardsBeforeSourceCompletes(t *testing.T) {
	source, writer := io.Pipe()
	defer func() { _ = source.Close() }()
	defer func() { _ = writer.Close() }()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, _ := gin.CreateTestContext(w)
		c.Request = r
		serveWorkspaceStream(c, &agents.WorkspaceFileContent{Filename: "sample.py", FileStream: &sandboxcore.FileStream{Reader: source, ContentLength: -1, StatusCode: 200}})
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	go func() { _, _ = io.WriteString(writer, "first") }()
	first := make([]byte, 5)
	if _, err = io.ReadFull(response.Body, first); err != nil || string(first) != "first" {
		t.Fatal("first chunk waited for EOF", string(first), err)
	}
	// Only produce the remainder after the client has received the first chunk.
	go func() { _, _ = io.WriteString(writer, "last"); _ = writer.Close() }()
	rest, err := io.ReadAll(response.Body)
	if err != nil || string(rest) != "last" {
		t.Fatal(string(rest), err)
	}
}

func TestWorkspaceStreamHeadersAndRanges(t *testing.T) {
	for _, tc := range []struct {
		status     int
		length     int64
		span, body string
	}{
		{200, 5, "", "hello"}, {206, 3, "bytes 2-4/10", "234"}, {416, 0, "bytes */10", ""},
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
		serveWorkspaceStream(c, &agents.WorkspaceFileContent{Filename: "report.html", FileStream: &sandboxcore.FileStream{Reader: io.NopCloser(strings.NewReader(tc.body)), StatusCode: tc.status, ContentLength: tc.length, ContentRange: tc.span}})
		if w.Code != tc.status || w.Body.String() != tc.body || w.Header().Get("Content-Range") != tc.span {
			t.Fatal(w.Code, w.Body.String(), w.Header())
		}
		if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
			t.Fatal("unsafe stream headers", w.Header())
		}
	}
}

type brokenWorkspaceStream struct{}

func (brokenWorkspaceStream) Read([]byte) (int, error) { return 0, errors.New("upstream disconnected") }
func (brokenWorkspaceStream) Close() error             { return nil }

func TestWorkspaceStreamAbortsOnUpstreamFailure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		stream sandboxcore.FileStream
	}{
		{"read error", sandboxcore.FileStream{Reader: brokenWorkspaceStream{}, StatusCode: 200, ContentLength: -1}},
		{"short range", sandboxcore.FileStream{Reader: io.NopCloser(strings.NewReader("23")), StatusCode: 206, ContentLength: 3, ContentRange: "bytes 2-4/10"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
			defer func() {
				if recover() != http.ErrAbortHandler {
					t.Fatal("failed stream was reported as complete")
				}
			}()
			serveWorkspaceStream(c, &agents.WorkspaceFileContent{Filename: "file.py", FileStream: &tc.stream})
		})
	}
}
