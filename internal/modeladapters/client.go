package modeladapters

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// Config contains execution-only connection material. Never persist or log it.
type Config struct {
	Provider       modelcore.ProviderType
	Protocol       modelcore.Protocol
	BaseURL        string
	APIKey         string
	CustomCAPEM    string
	ConnectTimeout time.Duration
	RequestTimeout time.Duration
}

type Client struct {
	config   Config
	http     *http.Client
	endpoint string
}

// RemoteError deliberately excludes URL, headers, body and provider exception text.
type RemoteError struct {
	Status int
	Kind   string
}

func (e *RemoteError) Error() string {
	if e.Status == 0 {
		if e.Kind == "timeout" {
			return "model transport timed out"
		}
		return "model transport failed"
	}
	return fmt.Sprintf("model endpoint returned HTTP %d", e.Status)
}

func (e *RemoteError) Unwrap() error {
	switch {
	case e.Status == http.StatusTooManyRequests:
		return modelcore.ErrRateLimited
	case e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden:
		return modelcore.ErrAuthenticationFailed
	case e.Status >= 500 && e.Status <= 599:
		return modelcore.ErrRemoteService
	case e.Status >= 300 && e.Status <= 499:
		// Redirects are rejected locally rather than forwarding credentials.
		return modelcore.ErrRequestRejected
	case e.Status == 0 && e.Kind == "timeout":
		return modelcore.ErrTransportTimeout
	case e.Status == 0:
		return modelcore.ErrTransport
	}
	return nil
}

func transportError(err error) error {
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return &RemoteError{Kind: "timeout"}
	}
	return &RemoteError{Kind: "transport"}
}

// NewClient clones an injected client before enforcing redirect rejection. An
// injected transport owns its TLS configuration; production callers normally pass nil.
func NewClient(config Config, client *http.Client) (*Client, error) {
	if !NewRegistry().Supports(config.Provider, config.Protocol) {
		return nil, modelcore.ErrUnsupported
	}
	u, err := url.Parse(config.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(config.BaseURL) > 2048 {
		return nil, fmt.Errorf("%w: base URL", modelcore.ErrInvalidRequest)
	}
	if len(config.APIKey) > 8192 || strings.ContainsAny(config.APIKey, "\r\n\x00") || (config.APIKey == "" && config.Provider != modelcore.Ollama) {
		return nil, fmt.Errorf("%w: authentication", modelcore.ErrInvalidRequest)
	}
	if config.ConnectTimeout == 0 {
		config.ConnectTimeout = 10 * time.Second
	}
	if config.RequestTimeout == 0 {
		config.RequestTimeout = 120 * time.Second
	}
	if config.ConnectTimeout < time.Second || config.ConnectTimeout > 30*time.Second || config.RequestTimeout < time.Second || config.RequestTimeout > 600*time.Second {
		return nil, fmt.Errorf("%w: timeout", modelcore.ErrInvalidRequest)
	}
	if client == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.DialContext = (&net.Dialer{Timeout: config.ConnectTimeout, KeepAlive: 30 * time.Second}).DialContext
		transport.TLSHandshakeTimeout = config.ConnectTimeout
		if config.CustomCAPEM != "" {
			if len(config.CustomCAPEM) > 16<<10 {
				return nil, fmt.Errorf("%w: CA", modelcore.ErrInvalidRequest)
			}
			roots, rootErr := x509.SystemCertPool()
			if rootErr != nil {
				roots = x509.NewCertPool()
			}
			if !roots.AppendCertsFromPEM([]byte(config.CustomCAPEM)) {
				return nil, fmt.Errorf("%w: CA", modelcore.ErrInvalidRequest)
			}
			transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}
		}
		client = &http.Client{Transport: transport}
	} else if config.CustomCAPEM != "" {
		return nil, fmt.Errorf("%w: injected transport with CA", modelcore.ErrInvalidRequest)
	}
	copyClient := *client
	copyClient.Timeout = config.RequestTimeout
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	u.Path = endpointPath(config.Provider, config.Protocol, u.Path)
	u.RawPath = ""
	return &Client{config: config, http: &copyClient, endpoint: u.String()}, nil
}

func endpointPath(provider modelcore.ProviderType, protocol modelcore.Protocol, path string) string {
	path = strings.TrimRight(path, "/")
	if protocol == modelcore.AnthropicMessages {
		if (provider == modelcore.DeepSeek || provider == modelcore.MiniMax) && (path == "" || path == "/v1") {
			path = "/anthropic"
		}
		if !strings.HasSuffix(path, "/v1") {
			path += "/v1"
		}
		return path + "/messages"
	}
	if path == "" {
		switch provider {
		case modelcore.DeepSeek:
		case modelcore.GLM:
			path = "/api/paas/v4"
		default:
			path = "/v1"
		}
	}
	return path + "/chat/completions"
}

func (c *Client) Generate(ctx context.Context, input modelcore.Request, emit modelcore.Emit) (modelcore.Response, error) {
	if input.Protocol != c.config.Protocol {
		return modelcore.Response{}, modelcore.ErrUnsupported
	}
	body, err := encodeRequest(c.config.Provider, input)
	if err != nil {
		return modelcore.Response{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return modelcore.Response{}, modelcore.ErrInvalidRequest
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if c.config.Protocol == modelcore.AnthropicMessages {
		req.Header.Set("x-api-key", c.config.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return modelcore.Response{}, ctx.Err()
		}
		return modelcore.Response{}, transportError(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return modelcore.Response{}, &RemoteError{Status: resp.StatusCode}
	}
	if !strings.HasPrefix(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		return modelcore.Response{}, modelcore.ErrUnsupported
	}
	if emit == nil {
		emit = func(modelcore.Delta) error { return nil }
	}
	if input.Protocol == modelcore.ChatCompletions {
		return decodeChat(ctx, resp.Body, emit)
	}
	return decodeMessages(ctx, resp.Body, emit)
}

type DiscoveredModel struct {
	RemoteModelID string  `json:"model_id"`
	DisplayName   *string `json:"display_name"`
}
type Discovery struct {
	Models    []DiscoveredModel `json:"models"`
	Truncated bool              `json:"truncated"`
}

func (c *Client) Discover(ctx context.Context) (Discovery, error) {
	if c.config.Protocol != modelcore.ChatCompletions || c.config.Provider == modelcore.MiniMax || c.config.Provider == modelcore.GLM {
		return Discovery{}, modelcore.ErrUnsupported
	}
	endpoint := strings.TrimSuffix(c.endpoint, "/chat/completions") + "/models"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Discovery{}, modelcore.ErrInvalidRequest
	}
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return Discovery{}, ctx.Err()
		}
		return Discovery{}, transportError(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return Discovery{}, &RemoteError{Status: resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return Discovery{}, modelcore.ErrInvalidResponse
	}
	var envelope struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.Data == nil {
		return Discovery{}, modelcore.ErrInvalidResponse
	}
	result := Discovery{Models: make([]DiscoveredModel, 0, len(envelope.Data))}
	seen := make(map[string]bool)
	for _, entry := range envelope.Data {
		if entry.ID == "" || len(entry.ID) > 255 || strings.ContainsAny(entry.ID, "\r\n\x00") {
			return Discovery{}, modelcore.ErrInvalidResponse
		}
		if seen[entry.ID] {
			continue
		}
		seen[entry.ID] = true
		if len(result.Models) == 1000 {
			result.Truncated = true
			break
		}
		result.Models = append(result.Models, DiscoveredModel{RemoteModelID: entry.ID})
	}
	return result, nil
}
