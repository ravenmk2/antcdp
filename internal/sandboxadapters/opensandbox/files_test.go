package opensandbox

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestNativeFilesystemWireAuthenticationRangeAndUnknownMutation(t *testing.T) {
	for _, mode := range []string{"direct", "server_proxy"} {
		t.Run(mode, func(t *testing.T) {
			var deletes atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "/endpoints/") {
					endpoint := "/data"
					if mode == "server_proxy" {
						endpoint = "/v1/sandboxes/sandbox-1/proxy/44772"
					}
					jsonReply(t, w, sdk.Endpoint{Endpoint: endpoint})
					return
				}
				if r.URL.Path == "/v1/sandboxes/sandbox-1" {
					jsonReply(t, w, testInfo())
					return
				}
				if r.Header.Get("X-EXECD-ACCESS-TOKEN") != testControlToken(t) {
					t.Error("scoped credential missing")
				}
				if (r.Header.Get("OPEN-SANDBOX-API-KEY") != "") != (mode == "server_proxy") {
					t.Error("server credential crossed data boundary")
				}
				if r.Header.Get("X-EXECD-UID") != "" || r.Header.Get("X-EXECD-GID") != "" {
					t.Error("default operation forced identity")
				}
				switch {
				case strings.HasSuffix(r.URL.Path, "/files/download"):
					if r.URL.Query().Get("path") != "/data/中文.txt" || r.Header.Get("Range") != "bytes=2-4" {
						t.Error("range/path lost")
					}
					w.WriteHeader(http.StatusPartialContent)
					_, _ = io.WriteString(w, "abc")
				case r.Method == http.MethodDelete:
					deletes.Add(1)
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = io.WriteString(w, "private remote error must not escape")
				case strings.HasSuffix(r.URL.Path, "/files/info"):
					w.WriteHeader(http.StatusNotFound)
				default:
					t.Errorf("unexpected native API %s %s", r.Method, r.URL.Path)
					w.WriteHeader(400)
				}
			}))
			defer server.Close()
			p := providerFor(t, server, mode).(sandboxcore.Filesystem)
			reader, err := p.OpenFile(context.Background(), testRef(), sandboxcore.FileRequest{Path: "/data/中文.txt", Offset: 2, Length: 3, MaxBytes: 3})
			if err != nil {
				t.Fatal(err)
			}
			b, err := io.ReadAll(reader)
			closeErr := reader.Close()
			if err != nil || closeErr != nil || string(b) != "abc" {
				t.Fatal(string(b), err, closeErr)
			}
			_, err = p.StatFile(context.Background(), testRef(), "/data/missing")
			var remote *sandboxcore.Error
			if !errors.As(err, &remote) || remote.Unknown {
				t.Fatal("missing file uncertain", err)
			}
			err = p.RemoveFile(context.Background(), testRef(), "/data/file", false)
			if !errors.As(err, &remote) || !remote.Unknown || deletes.Load() != 1 || strings.Contains(err.Error(), "private") {
				t.Fatal("mutation replayed or error leaked", err, deletes.Load())
			}
		})
	}
}
