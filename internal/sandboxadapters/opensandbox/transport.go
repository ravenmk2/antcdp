package opensandbox

import (
	"io"
	"net/http"
	"strings"
)

// The upstream SSE parser permits unbounded lines. Bound every wire event
// before that parser allocates a growing buffer; regular JSON/error bodies are
// bounded independently. File streams get their per-operation byte limit.
type boundedTransport struct{ base http.RoundTripper }

func (t boundedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		_ = response.Body.Close()
		return nil, failure("SANDBOX_REDIRECT_REJECTED", req.Method != http.MethodGet)
	}
	fileDownload := req.Method == http.MethodGet && strings.HasSuffix(req.URL.Path, "/files/download")
	if response.StatusCode >= 400 || !fileDownload {
		stream := req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/command") && response.StatusCode < 300
		if stream {
			response.Body = &eventBoundReader{ReadCloser: response.Body}
		} else {
			response.Body = &limitedReadCloser{Reader: &boundedReader{source: response.Body, remaining: 2 << 20}, closer: response.Body}
		}
	}
	return response, nil
}

type eventBoundReader struct {
	io.ReadCloser
	eventBytes, lineBytes int
	failed                bool
}

func (r *eventBoundReader) Read(p []byte) (int, error) {
	if r.failed {
		return 0, failure("SANDBOX_RESPONSE_TOO_LARGE", true)
	}
	n, err := r.ReadCloser.Read(p)
	for i, b := range p[:n] {
		r.eventBytes++
		if b == '\n' {
			if r.lineBytes == 0 {
				r.eventBytes = 0
			}
			r.lineBytes = 0
		} else if b != '\r' {
			r.lineBytes++
		}
		if r.eventBytes > 1<<20 {
			r.failed = true
			return i, failure("SANDBOX_RESPONSE_TOO_LARGE", true)
		}
	}
	return n, err
}

type boundedReader struct {
	source    io.Reader
	remaining int64
	exceeded  bool
}

func (r *boundedReader) Read(p []byte) (int, error) {
	if r.exceeded {
		return 0, failure("SANDBOX_RESPONSE_TOO_LARGE", false)
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.remaining == 0 {
		var probe [1]byte
		n, err := r.source.Read(probe[:])
		if n != 0 {
			r.exceeded = true
			return 0, failure("SANDBOX_RESPONSE_TOO_LARGE", false)
		}
		return 0, err
	}
	if int64(len(p)) > r.remaining {
		p = p[:int(r.remaining)]
	}
	n, err := r.source.Read(p)
	r.remaining -= int64(n)
	return n, err
}

type limitedReadCloser struct {
	io.Reader
	closer io.Closer
	cancel func()
}

func (r *limitedReadCloser) Close() error {
	err := r.closer.Close()
	if r.cancel != nil {
		r.cancel()
	}
	return err
}
