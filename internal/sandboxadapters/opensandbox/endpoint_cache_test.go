package opensandbox

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestDownloadEndpointReuseRefreshAndIsolation(t *testing.T) {
	for _, mode := range []string{"read", "stream"} {
		t.Run(mode, func(t *testing.T) { testDownloadEndpointCache(t, mode == "stream") })
	}
}

func testDownloadEndpointCache(t *testing.T, streaming bool) {
	var requests, downloadStatus, route atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch {
		case r.URL.Path == "/v1/sandboxes/sandbox-1":
			jsonReply(t, w, testInfo())
		case strings.Contains(r.URL.Path, "/endpoints/"):
			endpoint := "/v1/sandboxes/sandbox-1/proxy/44772"
			if route.Load() != 0 {
				endpoint += "/new"
			}
			jsonReply(t, w, sdk.Endpoint{Endpoint: endpoint})
		case strings.HasSuffix(r.URL.Path, "/files/download"):
			if r.Header.Get("X-EXECD-ACCESS-TOKEN") != testControlToken(t) || r.Header.Get("OPEN-SANDBOX-API-KEY") == "" {
				t.Error("download lost scoped or proxy credential")
			}
			if r.URL.Query().Get("path") != "/data/home/test.py" {
				t.Error("download path lost")
			}
			if route.Load() != 0 && !strings.Contains(r.URL.Path, "/new/") {
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			if status := downloadStatus.Load(); status != 0 {
				w.WriteHeader(int(status))
				return
			}
			_, _ = io.WriteString(w, "print('hello')")
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	factory := NewFactory()
	connection := sandboxcore.Connection{Endpoint: server.URL, AccessMode: "server_proxy", APIKey: "test-key", ControlKey: []byte(strings.Repeat("k", 32))}
	ref := testRef()
	download := func(wantRequests int32, wantError bool) {
		t.Helper()
		requests.Store(0)
		// A new provider is opened for every host request in production.
		provider, err := factory.Open(context.Background(), connection)
		if err != nil {
			t.Fatal(err)
		}
		var reader io.ReadCloser
		request := sandboxcore.FileRequest{Path: "/data/home/test.py", MaxBytes: 100}
		if streaming {
			var stream *sandboxcore.FileStream
			stream, err = provider.(sandboxcore.FileStreamer).StreamFile(context.Background(), ref, request, "")
			if stream != nil {
				reader = stream.Reader
			}
		} else {
			reader, err = provider.OpenFile(context.Background(), ref, request)
		}
		if (err != nil) != wantError {
			t.Fatalf("download error = %v, want error %v", err, wantError)
		}
		if reader != nil {
			body, readErr := io.ReadAll(reader)
			closeErr := reader.Close()
			if readErr != nil || closeErr != nil || string(body) != "print('hello')" {
				t.Fatal(string(body), readErr, closeErr)
			}
		}
		if requests.Load() != wantRequests {
			t.Fatalf("requests = %d, want %d", requests.Load(), wantRequests)
		}
	}
	download(3, false) // cold: inspect, endpoint, download
	download(1, false) // warm: download only, even with a new Provider
	route.Store(1)
	download(4, false) // stale route: failed download, inspect, endpoint, download
	download(1, false)
	for _, status := range []int32{400, 401, 403, 404, 429, 500} {
		downloadStatus.Store(status)
		download(1, true)
	}
	downloadStatus.Store(502)
	download(4, true) // never loop if the refreshed address also fails
	downloadStatus.Store(0)
	download(3, false) // failed refreshed route was evicted
	ref.BackendGeneration++
	download(3, false)
	download(1, false)
	connection.APIKey = "rotated-key"
	download(3, false)
	download(1, false)
	ref.Ownership.CreationToken = strings.Repeat("c", 32)
	download(1, true) // fresh ownership check rejects a mismatched instance before download
}
