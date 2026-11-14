// Package webaccessadapters implements registered web retrieval capabilities.
package webaccessadapters

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/netguard"
	"github.com/ravenmk2/antcdp/internal/webaccess"
)

type Config struct {
	Provider       string
	BaseURL        string
	APIKey         string
	Timeout        time.Duration
	ProtectedHosts []string
}

type Remote struct {
	config Config
	client *http.Client
	policy netguard.Policy
}

func NewRemote(config Config, client *http.Client) (*Remote, error) {
	u, err := netguard.ParseURL(config.BaseURL)
	if err != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || len(config.BaseURL) > 2048 || (config.Provider != "deepseek" && config.Provider != "glm") || config.APIKey == "" || strings.ContainsAny(config.APIKey, "\r\n\x00") || config.Timeout < time.Second || config.Timeout > 60*time.Second {
		return nil, webaccess.Fail("WEB_ACCESS_INVALID_CONFIGURATION")
	}
	if client == nil {
		client = &http.Client{Transport: &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: config.Timeout, MaxResponseHeaderBytes: 32 << 10}}
	}
	copyClient := *client
	copyClient.Timeout = config.Timeout
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Remote{config: config, client: &copyClient, policy: netguard.Policy{ProtectedHosts: config.ProtectedHosts}}, nil
}

func (r *Remote) endpoint(operation webaccess.Operation) string {
	base := strings.TrimRight(r.config.BaseURL, "/")
	if r.config.Provider == "deepseek" {
		base = strings.TrimSuffix(base, "/v1")
		return base + "/v1/tools/" + string(operation)
	}
	if strings.HasSuffix(base, "/api/paas/v4") {
		return base + "/web_search"
	}
	return base + "/api/paas/v4/web_search"
}

func (r *Remote) post(ctx context.Context, operation webaccess.Operation, payload any, limit int64, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return webaccess.Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.endpoint(operation), bytes.NewReader(body))
	if err != nil {
		return webaccess.Fail("WEB_ACCESS_INVALID_CONFIGURATION")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+r.config.APIKey)
	response, err := r.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &webaccess.Failure{Code: "WEB_ACCESS_REMOTE_OUTCOME_UNKNOWN", Unknown: true}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		code, fallback := "WEB_ACCESS_REMOTE_REJECTED", false
		switch response.StatusCode {
		case 401:
			code = "WEB_ACCESS_AUTHENTICATION_REJECTED"
			fallback = true
		case 402:
			code = "WEB_ACCESS_BILLING_UNAVAILABLE"
			fallback = true
		case 403:
			code = "WEB_ACCESS_TARGET_NOT_ALLOWED"
		case 404:
			code = "WEB_ACCESS_CONTENT_UNAVAILABLE"
			fallback = true
		case 429:
			code = "WEB_ACCESS_RATE_LIMITED"
			fallback = true
		default:
			if response.StatusCode >= 500 {
				code = "WEB_ACCESS_REMOTE_UNAVAILABLE"
				fallback = true
			}
		}
		return &webaccess.Failure{Code: code, Fallback: fallback}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &webaccess.Failure{Code: "WEB_ACCESS_REMOTE_OUTCOME_UNKNOWN", Unknown: true}
	}
	if int64(len(data)) > limit {
		return webaccess.Fail("WEB_ACCESS_RESPONSE_TOO_LARGE")
	}
	if !utf8.Valid(data) || json.Unmarshal(data, target) != nil {
		return webaccess.Fail("WEB_ACCESS_INVALID_RESPONSE")
	}
	return nil
}

func (r *Remote) Search(ctx context.Context, input webaccess.SearchRequest) (webaccess.SearchResult, error) {
	result := webaccess.SearchResult{Results: []webaccess.SearchEntry{}}
	if !utf8.ValidString(input.Query) || strings.TrimSpace(input.Query) == "" || utf8.RuneCountInString(input.Query) > 128 || input.MaxResults < 1 || input.MaxResults > 20 {
		return result, webaccess.Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	type rawEntry struct {
		Title     string  `json:"title"`
		URL       string  `json:"url"`
		Link      string  `json:"link"`
		Summary   string  `json:"summary"`
		Snippet   string  `json:"snippet"`
		Content   string  `json:"content"`
		Date      *string `json:"date"`
		Published *string `json:"publish_date"`
	}
	var body struct {
		Results      []rawEntry `json:"results"`
		SearchResult []rawEntry `json:"search_result"`
	}
	request := map[string]any{"query": input.Query, "count": input.MaxResults, "need_content": false}
	if r.config.Provider == "glm" {
		request = map[string]any{"search_engine": "search_pro", "search_query": input.Query, "count": input.MaxResults, "content_size": "medium"}
	}
	if err := r.post(ctx, webaccess.Search, request, 4<<20, &body); err != nil {
		return result, err
	}
	items := body.Results
	if r.config.Provider == "glm" {
		items = body.SearchResult
	}
	if items == nil {
		return result, webaccess.Fail("WEB_ACCESS_INVALID_RESPONSE")
	}
	bytesUsed := 0
	for _, item := range items {
		if len(result.Results) >= input.MaxResults {
			result.Truncated = true
			break
		}
		rawURL, summary, date := item.URL, item.Summary, item.Date
		if r.config.Provider == "glm" {
			rawURL, summary, date = item.Link, item.Content, item.Published
		} else if summary == "" {
			summary = item.Snippet
		}
		if _, err := netguard.ParseURL(rawURL); err != nil {
			result.Truncated = true
			continue
		}
		title, titleCut := bounded(item.Title, 1024)
		summary, summaryCut := bounded(summary, 8192)
		entry := webaccess.SearchEntry{Title: title, URL: rawURL, Summary: summary, PublishedAt: publication(date), Truncated: titleCut || summaryCut}
		encoded, _ := json.Marshal(entry)
		if bytesUsed+len(encoded) > 128<<10 {
			result.Truncated = true
			break
		}
		bytesUsed += len(encoded)
		result.Results = append(result.Results, entry)
		result.Truncated = result.Truncated || entry.Truncated
	}
	return result, nil
}

func (r *Remote) Fetch(ctx context.Context, input webaccess.FetchRequest) (webaccess.FetchResult, error) {
	result := webaccess.FetchResult{RequestedURL: input.URL, MediaType: "text/markdown"}
	if r.config.Provider != "deepseek" {
		return result, webaccess.Fail("WEB_ACCESS_CAPABILITY_UNSUPPORTED")
	}
	if input.MaxBytes < 64<<10 || input.MaxBytes > 10<<20 {
		return result, webaccess.Fail("WEB_ACCESS_INVALID_REQUEST")
	}
	// No internal-host exception is passed to the third-party adapter.
	internal, err := r.policy.Classify(ctx, input.URL)
	if err != nil || internal {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, webaccess.Fail("WEB_ACCESS_TARGET_NOT_ALLOWED")
	}
	var body struct {
		Title   string  `json:"title"`
		Content *string `json:"content"`
	}
	if err = r.post(ctx, webaccess.Fetch, map[string]string{"url": input.URL}, input.MaxBytes*6+(64<<10), &body); err != nil {
		return result, err
	}
	if body.Content == nil {
		return result, webaccess.Fail("WEB_ACCESS_INVALID_RESPONSE")
	}
	result.Title, _ = bounded(body.Title, 1024)
	result.Content, result.Truncated = bounded(*body.Content, int(input.MaxBytes))
	// The provider does not return a verified final URL. Leave it unknown.
	return result, nil
}

func publication(value *string) *string {
	if value == nil || len(*value) > 64 {
		return nil
	}
	if _, err := time.Parse(time.RFC3339, *value); err == nil {
		return value
	}
	if _, err := time.Parse("2006-01-02", *value); err == nil {
		return value
	}
	return nil
}

func bounded(value string, limit int) (string, bool) {
	if len(value) <= limit {
		return value, false
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value, true
}

// SafeReason strips transport details even if a caller supplied a custom client.
func SafeReason(err error) string {
	var failure *webaccess.Failure
	if errors.As(err, &failure) {
		return failure.Code
	}
	if errors.Is(err, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "WEB_ACCESS_TIMEOUT"
	}
	var urlError *url.Error
	if errors.As(err, &urlError) {
		return "WEB_ACCESS_REMOTE_OUTCOME_UNKNOWN"
	}
	return "WEB_ACCESS_FAILED"
}
