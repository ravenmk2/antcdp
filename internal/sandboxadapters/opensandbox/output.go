package opensandbox

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func (p *Provider) ReadExecutionOutput(ctx context.Context, h sandboxcore.ExecutionHandle, cursor int64, maxBytes int) (sandboxcore.ExecutionOutput, error) {
	out := sandboxcore.ExecutionOutput{Cursor: cursor}
	if !validRemoteID(h.ID) || cursor < 0 || maxBytes < 4 || maxBytes > 1<<20 {
		return out, failure("SANDBOX_COMMAND_INVALID", false)
	}
	ctx, cancel := context.WithTimeout(ctx, p.connection.OperationTimeout)
	defer cancel()
	endpoint, err := p.dataEndpoint(ctx, h.Resource)
	if err != nil {
		return out, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.Endpoint+"/command/"+url.PathEscape(h.ID)+"/logs?cursor="+strconv.FormatInt(cursor, 10), nil)
	if err != nil {
		return out, failure("SANDBOX_REQUEST_INVALID", false)
	}
	for key, value := range endpoint.Headers {
		request.Header.Set(key, value)
	}
	request.Header.Set("Accept", "text/plain")
	response, err := p.http.Do(request)
	if err != nil {
		return out, remoteError(err, false)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return out, failure("SANDBOX_OUTPUT_UNAVAILABLE", false)
	}
	remoteCursor, err := strconv.ParseInt(response.Header.Get("EXECD-COMMANDS-TAIL-CURSOR"), 10, 64)
	if err != nil || remoteCursor < 0 {
		return out, failure("SANDBOX_RESPONSE_INVALID", false)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, int64(maxBytes)+1))
	if err != nil {
		return out, remoteError(err, false)
	}
	if len(data) > maxBytes {
		data = data[:maxBytes]
		// Leave only an incomplete trailing rune for the next byte-cursor
		// page. Invalid bytes inside the log are replaced in the text view.
		start := len(data) - 1
		for start > 0 && len(data)-start < utf8.UTFMax && !utf8.RuneStart(data[start]) {
			start--
		}
		if !utf8.FullRune(data[start:]) {
			data = data[:start]
		}
		out.Truncated = true
		if remoteCursor < cursor+int64(len(data)) {
			return out, failure("SANDBOX_RESPONSE_INVALID", false)
		}
		out.Cursor = cursor + int64(len(data))
	} else {
		// The remote API clamps an overlarge cursor to EOF. Otherwise its
		// returned cursor must equal exactly the bytes actually received.
		if len(data) > 0 && remoteCursor != cursor+int64(len(data)) || len(data) == 0 && remoteCursor > cursor {
			return out, failure("SANDBOX_RESPONSE_INVALID", false)
		}
		out.Cursor = remoteCursor
	}
	// Logs can contain binary bytes; UI text is an explicit lossy projection,
	// while the cursor still counts original bytes, never replacement runes.
	out.Text = strings.ToValidUTF8(string(data), "\uFFFD")
	return out, nil
}
