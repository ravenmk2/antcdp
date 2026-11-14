package webaccessadapters

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"

	"github.com/ravenmk2/antcdp/internal/platform/netguard"
	"github.com/ravenmk2/antcdp/internal/webaccess"
)

type Reader struct{ ProtectedHosts []string }

func (r Reader) Search(context.Context, webaccess.SearchRequest) (webaccess.SearchResult, error) {
	return webaccess.SearchResult{}, webaccess.Fail("WEB_ACCESS_CAPABILITY_UNSUPPORTED")
}

func (r Reader) Fetch(ctx context.Context, input webaccess.FetchRequest) (webaccess.FetchResult, error) {
	result := webaccess.FetchResult{RequestedURL: input.URL}
	if input.MaxBytes < 64<<10 || input.MaxBytes > 10<<20 || input.MaxRedirects < 0 || input.MaxRedirects > 5 {
		return result, webaccess.Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	policy := netguard.Policy{AllowedInternalHosts: input.AllowedInternalHosts, ProtectedHosts: r.ProtectedHosts}
	if _, err := policy.Classify(ctx, input.URL); err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, webaccess.Fail("WEB_ACCESS_TARGET_NOT_ALLOWED")
	}
	transport := policy.Transport()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 60 * time.Second, CheckRedirect: func(next *http.Request, via []*http.Request) error {
		if len(via) > input.MaxRedirects {
			return webaccess.Fail("WEB_ACCESS_REDIRECT_LIMIT")
		}
		if _, err := policy.Classify(next.Context(), next.URL.String()); err != nil {
			return webaccess.Fail("WEB_ACCESS_TARGET_NOT_ALLOWED")
		}
		return nil
	}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, input.URL, nil)
	if err != nil {
		return result, webaccess.Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	request.Header.Set("User-Agent", "AntCDP-WebReader/1.0")
	request.Header.Set("Accept", "text/html, text/plain, text/markdown, application/json;q=0.8")
	response, err := client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		var failure *webaccess.Failure
		if errors.As(err, &failure) {
			return result, failure
		}
		if errors.Is(err, netguard.ErrTarget) {
			return result, webaccess.Fail("WEB_ACCESS_TARGET_NOT_ALLOWED")
		}
		var networkError net.Error
		if errors.As(err, &networkError) && networkError.Timeout() {
			return result, webaccess.Fail("WEB_ACCESS_TIMEOUT")
		}
		return result, &webaccess.Failure{Code: "WEB_ACCESS_FETCH_FAILED", Fallback: true}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return result, &webaccess.Failure{Code: "WEB_ACCESS_CONTENT_UNAVAILABLE", Fallback: true}
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil {
		return result, webaccess.Fail("WEB_ACCESS_CONTENT_TYPE_UNSUPPORTED")
	}
	switch mediaType {
	case "text/html", "text/plain", "text/markdown", "application/json":
	default:
		return result, webaccess.Fail("WEB_ACCESS_CONTENT_TYPE_UNSUPPORTED")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, input.MaxBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, webaccess.Fail("WEB_ACCESS_FETCH_FAILED")
	}
	truncated := int64(len(data)) > input.MaxBytes
	if truncated {
		data = data[:input.MaxBytes]
	}
	decoded, err := charset.NewReader(bytes.NewReader(data), response.Header.Get("Content-Type"))
	if err != nil {
		return result, webaccess.Fail("WEB_ACCESS_CONTENT_ENCODING_UNSUPPORTED")
	}
	text, err := io.ReadAll(io.LimitReader(decoded, input.MaxBytes+1))
	if err != nil {
		return result, webaccess.Fail("WEB_ACCESS_CONTENT_ENCODING_UNSUPPORTED")
	}
	value := string(text)
	if !utf8.ValidString(value) {
		value = strings.ToValidUTF8(value, "")
	}
	value, cut := bounded(value, int(input.MaxBytes))
	truncated = truncated || cut
	if mediaType == "text/html" {
		result.Title, value = plainHTML(value)
		mediaType = "text/plain"
	}
	result.Content, result.Truncated = bounded(value, int(input.MaxBytes))
	result.Truncated = result.Truncated || truncated
	final := response.Request.URL.String()
	result.FinalURL = &final
	result.MediaType = mediaType
	return result, nil
}

func plainHTML(source string) (string, string) {
	tokenizer := html.NewTokenizer(strings.NewReader(source))
	parts := []string{}
	title := ""
	skipDepth := 0
	inTitle := false
	for {
		switch tokenizer.Next() {
		case html.ErrorToken:
			return title, strings.Join(parts, " ")
		case html.StartTagToken:
			name, _ := tokenizer.TagName()
			tag := string(name)
			if tag == "script" || tag == "style" || tag == "noscript" || tag == "template" {
				skipDepth++
			}
			if tag == "title" {
				inTitle = true
			}
		case html.EndTagToken:
			name, _ := tokenizer.TagName()
			tag := string(name)
			if skipDepth > 0 && (tag == "script" || tag == "style" || tag == "noscript" || tag == "template") {
				skipDepth--
			}
			if tag == "title" {
				inTitle = false
			}
		case html.TextToken:
			if skipDepth > 0 {
				continue
			}
			value := strings.Join(strings.Fields(string(tokenizer.Text())), " ")
			if inTitle {
				title, _ = bounded(title+value, 1024)
			} else if value != "" {
				parts = append(parts, value)
			}
		}
	}
}
