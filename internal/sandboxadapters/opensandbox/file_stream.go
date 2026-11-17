package opensandbox

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// StreamFile retains the native response metadata that the SDK's DownloadFile
// discards. Only file headers are returned; credentials stay inside the adapter.
func (p *Provider) StreamFile(ctx context.Context, ref sandboxcore.ResourceRef, f sandboxcore.FileRequest, byteRange string) (*sandboxcore.FileStream, error) {
	if err := validateFile(f); err != nil {
		return nil, err
	}
	if err := validateRef(ref); err != nil {
		return nil, err
	}
	if !sandboxcore.ValidFileRange(byteRange) || f.Offset != 0 || f.Length != 0 || f.UID != nil {
		return nil, failure("SANDBOX_FILE_REQUEST_INVALID", false)
	}
	ctx, cancel := context.WithTimeout(ctx, p.connection.OperationTimeout)
	stream, err := p.openDownload(ctx, ref, func(endpoint *sdk.Endpoint) (*sandboxcore.FileStream, error) {
		request, e := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint.Endpoint, "/")+"/files/download?"+url.Values{"path": {f.Path}}.Encode(), nil)
		if e != nil {
			return nil, e
		}
		for key, value := range endpoint.Headers {
			request.Header.Set(key, value)
		}
		request.Header.Set("Accept-Encoding", "identity")
		if byteRange != "" {
			request.Header.Set("Range", byteRange)
		}
		response, e := p.http.Do(request)
		if e != nil {
			return nil, e
		}
		if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent && response.StatusCode != http.StatusRequestedRangeNotSatisfiable {
			_ = response.Body.Close()
			return nil, &sdk.APIError{StatusCode: response.StatusCode}
		}
		contentRange := response.Header.Get("Content-Range")
		length, valid := downloadResponseLength(response.StatusCode, response.ContentLength, contentRange, f.MaxBytes)
		if !valid || response.StatusCode == http.StatusPartialContent && byteRange == "" || response.Header.Get("Content-Encoding") != "" && response.Header.Get("Content-Encoding") != "identity" {
			_ = response.Body.Close()
			return nil, failure("SANDBOX_FILE_RESPONSE_INVALID", false)
		}
		return &sandboxcore.FileStream{Reader: response.Body, ContentLength: length, ContentRange: contentRange, StatusCode: response.StatusCode}, nil
	})
	if err != nil {
		cancel()
		return nil, err
	}
	stream.Reader = &limitedReadCloser{Reader: &boundedReader{source: stream.Reader, remaining: f.MaxBytes}, closer: stream.Reader, cancel: cancel}
	return stream, nil
}

func downloadResponseLength(status int, length int64, contentRange string, limit int64) (int64, bool) {
	if length < -1 || length > limit {
		return 0, false
	}
	if status == http.StatusOK {
		return length, contentRange == ""
	}
	if len(contentRange) > 128 || !strings.HasPrefix(contentRange, "bytes ") {
		return 0, false
	}
	span, total, ok := strings.Cut(strings.TrimPrefix(contentRange, "bytes "), "/")
	if !ok {
		return 0, false
	}
	size, err := strconv.ParseInt(total, 10, 64)
	if err != nil || size < 0 {
		return 0, false
	}
	if status == http.StatusRequestedRangeNotSatisfiable {
		return length, span == "*"
	}
	if size > limit || !sandboxcore.ValidFileRange("bytes="+span) {
		return 0, false
	}
	start, end, ok := strings.Cut(span, "-")
	if !ok || start == "" || end == "" {
		return 0, false
	}
	first, e1 := strconv.ParseInt(start, 10, 64)
	last, e2 := strconv.ParseInt(end, 10, 64)
	// A chunked partial response still has an exact size. Forward it so the HTTP
	// handler detects a premature EOF even when the upstream ends cleanly.
	return last - first + 1, e1 == nil && e2 == nil && first <= last && last < size && (length == -1 || length == last-first+1)
}
