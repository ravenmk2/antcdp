package opensandbox

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestBackgroundOutputPagesDoNotSkipUnreadBytes(t *testing.T) {
	text := "中文abcdef"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/endpoints/"):
			jsonReply(t, w, sdk.Endpoint{Endpoint: server.URL + "/data"})
		case strings.HasPrefix(r.URL.Path, "/v1/"):
			jsonReply(t, w, testInfo())
		case strings.HasSuffix(r.URL.Path, "/logs"):
			cursor, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
			if cursor > len(text) {
				cursor = len(text)
			}
			w.Header().Set("EXECD-COMMANDS-TAIL-CURSOR", strconv.Itoa(len(text)))
			_, _ = io.WriteString(w, text[cursor:])
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	p := providerFor(t, server, "direct")
	handle := sandboxcore.ExecutionHandle{Resource: testRef(), ID: "exec-1"}
	one, err := p.ReadExecutionOutput(context.Background(), handle, 0, 4)
	if err != nil || one.Text != "中" || one.Cursor != 3 || !one.Truncated {
		t.Fatalf("first %+v %v", one, err)
	}
	two, err := p.ReadExecutionOutput(context.Background(), handle, one.Cursor, 100)
	if err != nil || two.Text != "文abcdef" || two.Cursor != int64(len(text)) || two.Truncated {
		t.Fatalf("second %+v %v", two, err)
	}
	end, err := p.ReadExecutionOutput(context.Background(), handle, 10000, 100)
	if err != nil || end.Cursor != int64(len(text)) || end.Text != "" {
		t.Fatalf("end %+v %v", end, err)
	}
}
