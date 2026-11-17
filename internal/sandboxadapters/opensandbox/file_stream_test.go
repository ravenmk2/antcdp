package opensandbox

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestStreamFileRangesAndLimits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/sandboxes/sandbox-1":
			jsonReply(t, w, testInfo())
		case strings.Contains(r.URL.Path, "/endpoints/"):
			jsonReply(t, w, sdk.Endpoint{Endpoint: "/data"})
		default:
			if r.Header.Get("X-EXECD-ACCESS-TOKEN") != testControlToken(t) || r.URL.Query().Get("path") != "/data/file" {
				t.Error("missing scoped authentication or path")
			}
			if r.Header.Get("Accept-Encoding") != "identity" {
				t.Error("stream allowed content transformations")
			}
			http.ServeContent(w, r, "file", time.Time{}, strings.NewReader("0123456789"))
		}
	}))
	defer server.Close()
	p := providerFor(t, server, "direct").(sandboxcore.FileStreamer)
	for _, tc := range []struct {
		span               string
		limit              int64
		status             int
		body, contentRange string
	}{
		{"", 100, 200, "0123456789", ""},
		{"bytes=2-4", 100, 206, "234", "bytes 2-4/10"},
		{"bytes=7-", 100, 206, "789", "bytes 7-9/10"},
		{"bytes=-3", 100, 206, "789", "bytes 7-9/10"},
		{"bytes=20-", 100, 416, "", "bytes */10"},
		{"bytes=0-1,3-4", 100, 0, "", ""},
		{"", 5, 0, "", ""},
		{"bytes=0-1", 5, 0, "", ""},
	} {
		stream, err := p.StreamFile(context.Background(), testRef(), sandboxcore.FileRequest{Path: "/data/file", MaxBytes: tc.limit}, tc.span)
		if tc.status == 0 {
			if err == nil {
				_ = stream.Reader.Close()
				t.Fatal("invalid/oversized response accepted", tc)
			}
			continue
		}
		if err != nil {
			t.Fatal(tc, err)
		}
		body, err := io.ReadAll(stream.Reader)
		closeErr := stream.Reader.Close()
		if err != nil || closeErr != nil || stream.StatusCode != tc.status || stream.ContentRange != tc.contentRange || tc.status != 416 && string(body) != tc.body {
			t.Fatal(tc, stream, string(body), err, closeErr)
		}
	}
}

func TestStreamFileCloseCancelsUpstreamAndBoundsUnknownLength(t *testing.T) {
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/sandboxes/sandbox-1":
			jsonReply(t, w, testInfo())
		case strings.Contains(r.URL.Path, "/endpoints/"):
			jsonReply(t, w, sdk.Endpoint{Endpoint: "/data"})
		default:
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			_, _ = io.WriteString(w, "0123456789")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			close(done)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := providerFor(t, server, "direct").(sandboxcore.FileStreamer).StreamFile(ctx, testRef(), sandboxcore.FileRequest{Path: "/data/file", MaxBytes: 5}, "")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(stream.Reader)
	if err == nil || string(body) != "01234" {
		t.Fatal("stream limit not enforced", string(body), err)
	}
	if err = stream.Reader.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("closing the stream did not cancel upstream")
	}
}

func TestStreamFileChunkedPartialResponse(t *testing.T) {
	for _, tc := range []struct {
		name, span, body string
	}{
		{"complete", "bytes=2-4", "234"},
		{"truncated", "bytes=2-4", "23"},
		{"unsolicited", "", "234"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Path == "/v1/sandboxes/sandbox-1":
					jsonReply(t, w, testInfo())
				case strings.Contains(r.URL.Path, "/endpoints/"):
					jsonReply(t, w, sdk.Endpoint{Endpoint: "/data"})
				default:
					w.Header().Set("Content-Range", "bytes 2-4/10")
					w.WriteHeader(http.StatusPartialContent)
					w.(http.Flusher).Flush()
					_, _ = io.WriteString(w, tc.body)
				}
			}))
			defer server.Close()
			stream, err := providerFor(t, server, "direct").(sandboxcore.FileStreamer).StreamFile(context.Background(), testRef(), sandboxcore.FileRequest{Path: "/data/file", MaxBytes: 100}, tc.span)
			if tc.span == "" {
				if err == nil {
					_ = stream.Reader.Close()
					t.Fatal("unsolicited partial response accepted as a full download")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = stream.Reader.Close() }()
			body, err := io.ReadAll(stream.Reader)
			if err != nil || string(body) != tc.body || stream.ContentLength != 3 {
				t.Fatal("expected range length was not retained for downstream truncation detection", stream.ContentLength, string(body), err)
			}
		})
	}
}
