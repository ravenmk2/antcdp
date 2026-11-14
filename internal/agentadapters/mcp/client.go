package mcp

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/ravenmk2/antcdp/internal/platform/netguard"
)

type Error struct {
	Code       string
	HTTPStatus int
	Dispatched bool
}

func (e *Error) Error() string { return e.Code }

type Config struct {
	URL                       string
	AuthMethod                string
	HeaderName                string
	Secret                    string `json:"-"`
	Timeout                   time.Duration
	RequestedProtocolVersions []string
}
type ProtocolSupport struct {
	Version          string `json:"version"`
	Lifecycle        string `json:"lifecycle"`
	ContractVerified bool   `json:"contract_verified"`
}

func Protocols() []ProtocolSupport {
	return []ProtocolSupport{{"2026-07-28", "stateless", true}, {"2025-11-25", "initialize", true}, {"2025-06-18", "initialize", true}, {"2025-03-26", "initialize", true}}
}

type Tool struct {
	RemoteName   string          `json:"name"`
	Title        string          `json:"title"`
	Description  string          `json:"description"`
	InputSchema  json.RawMessage `json:"input_schema"`
	OutputSchema json.RawMessage `json:"output_schema"`
	Annotations  json.RawMessage `json:"annotations"`
	Fingerprint  string          `json:"definition_fingerprint"`
}
type Discovery struct {
	ProtocolVersion string
	Tools           []Tool
}
type CallRequest struct {
	RemoteName, Fingerprint string
	Arguments               json.RawMessage
	ResultLimit             int
}
type CallResult struct {
	ProtocolVersion    string
	Content            string
	StructuredContent  json.RawMessage
	IsError, Truncated bool
	Executed           *bool
	Reason             string
}
type Client struct {
	config Config
	http   *http.Client
}

// ModelToolName namespaces remote names by server and stays below 64 bytes.
// Discovery must still reject hash collisions.
func ModelToolName(serverID uint64, remoteName string) string {
	hash := sha256.Sum256([]byte(remoteName))
	return fmt.Sprintf("mcp_%d_%x", serverID, hash[:19])
}

func ValidateConfig(config Config) error {
	u, err := url.Parse(config.URL)
	if err != nil || len(config.URL) > 2048 || u.Hostname() == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || u.Opaque != "" {
		return &Error{Code: "MCP_CONFIG_INVALID"}
	}
	if config.Timeout < time.Second || config.Timeout > 300*time.Second || len(config.RequestedProtocolVersions) > 8 {
		return &Error{Code: "MCP_CONFIG_INVALID"}
	}
	seen := map[string]bool{}
	for _, version := range config.RequestedProtocolVersions {
		if seen[version] || !supportedVersion(version) {
			return &Error{Code: "MCP_PROTOCOL_UNSUPPORTED"}
		}
		seen[version] = true
	}
	if len(config.Secret) > 8192 || strings.ContainsAny(config.Secret, "\r\n\x00") {
		return &Error{Code: "MCP_AUTH_INVALID"}
	}
	switch config.AuthMethod {
	case "none":
		if config.Secret != "" || config.HeaderName != "" {
			return &Error{Code: "MCP_AUTH_INVALID"}
		}
	case "bearer":
		if config.Secret == "" || config.HeaderName != "" {
			return &Error{Code: "MCP_AUTH_INVALID"}
		}
	case "custom_header":
		if config.Secret == "" || !validHeader(config.HeaderName) {
			return &Error{Code: "MCP_AUTH_INVALID"}
		}
	default:
		return &Error{Code: "MCP_AUTH_INVALID"}
	}
	for key, value := range u.Query() {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "api_key") || lower == "authorization" {
			return &Error{Code: "MCP_AUTH_INVALID"}
		}
		for _, v := range value {
			if config.Secret != "" && strings.Contains(v, config.Secret) {
				return &Error{Code: "MCP_AUTH_INVALID"}
			}
		}
	}
	return nil
}
func supportedVersion(version string) bool {
	for _, v := range Protocols() {
		if v.Version == version {
			return true
		}
	}
	return false
}
func validHeader(name string) bool {
	if len(name) < 1 || len(name) > 64 {
		return false
	}
	for _, r := range name {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'*+-.^_`|~", r) {
			return false
		}
	}
	lower := strings.ToLower(name)
	if strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "mcp-") || strings.HasPrefix(lower, "sec-") {
		return false
	}
	switch lower {
	case "host", "cookie", "set-cookie", "content-length", "content-type", "connection", "transfer-encoding", "accept", "accept-encoding", "trailer", "upgrade", "te", "origin":
		return false
	}
	return true
}

// New constructs a production client. Explicit administrator endpoints may be
// private, but deployment-protected/metadata addresses remain denied. Redirects
// are always rejected before credentials can reach a second target.
func New(config Config, protectedHosts []string) (*Client, error) {
	if config.Timeout == 0 {
		config.Timeout = 60 * time.Second
	}
	if err := ValidateConfig(config); err != nil {
		return nil, err
	}
	u, _ := url.Parse(config.URL)
	allowed := []string{u.Hostname()}
	transport := (netguard.Policy{AllowedInternalHosts: allowed, ProtectedHosts: protectedHosts}).Transport()
	return newClient(config, &http.Client{Transport: transport}), nil
}
func newClient(config Config, httpClient *http.Client) *Client {
	config.RequestedProtocolVersions = append([]string(nil), config.RequestedProtocolVersions...)
	copy := *httpClient
	copy.Timeout = config.Timeout
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{config: config, http: &copy}
}

func (c *Client) connect(ctx context.Context) (*sdk.ClientSession, *guardTransport, error) {
	guard := &guardTransport{base: c.http.Transport, config: c.config}
	if guard.base == nil {
		guard.base = http.DefaultTransport
	}
	clientHTTP := *c.http
	clientHTTP.Transport = guard
	client := sdk.NewClient(&sdk.Implementation{Name: "antcdp", Version: "1"}, &sdk.ClientOptions{Capabilities: &sdk.ClientCapabilities{}, MultiRoundTrip: &sdk.MultiRoundTripOptions{Disabled: true}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	client.AddSendingMiddleware(func(next sdk.MethodHandler) sdk.MethodHandler {
		return func(ctx context.Context, method string, request sdk.Request) (sdk.Result, error) {
			result, err := next(ctx, method, request)
			if err != nil {
				return nil, err
			}
			if method == "tools/list" {
				list, ok := result.(*sdk.ListToolsResult)
				if !ok {
					return nil, &Error{Code: "MCP_RESPONSE_INVALID"}
				}
				for _, tool := range list.Tools {
					if _, err := projectTool(tool); err != nil {
						return nil, err
					}
				}
			}
			return result, nil
		}
	})
	version := "2026-07-28"
	if len(c.config.RequestedProtocolVersions) > 0 {
		version = c.config.RequestedProtocolVersions[0]
	}
	session, err := client.Connect(ctx, &sdk.StreamableClientTransport{Endpoint: c.config.URL, HTTPClient: &clientHTTP, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: 1 << 20}, &sdk.ClientSessionOptions{ProtocolVersion: version})
	if err != nil {
		return nil, guard, publicError(err, guard)
	}
	negotiated := session.InitializeResult().ProtocolVersion
	if !supportedVersion(negotiated) || len(c.config.RequestedProtocolVersions) > 0 && !slices.Contains(c.config.RequestedProtocolVersions, negotiated) {
		_ = session.Close()
		return nil, guard, &Error{Code: "MCP_PROTOCOL_UNSUPPORTED"}
	}
	return session, guard, nil
}

// Session owns one SDK connection; operations are serialized and never replayed.
type Session struct {
	client  *Client
	session *sdk.ClientSession
	guard   *guardTransport
	mu      sync.Mutex
}

func (c *Client) Open(ctx context.Context) (*Session, error) {
	ctx, cancel := context.WithTimeout(ctx, c.config.Timeout)
	defer cancel()
	session, guard, err := c.connect(ctx)
	if err != nil {
		return nil, err
	}
	return &Session{client: c, session: session, guard: guard}, nil
}
func (s *Session) Close() error { return s.session.Close() }
func (s *Session) Discover(ctx context.Context) (Discovery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.guard.reset()
	ctx, cancel := context.WithTimeout(ctx, s.client.config.Timeout)
	defer cancel()
	return s.client.discover(ctx, s.session, s.guard)
}
func (s *Session) Call(ctx context.Context, r CallRequest) (CallResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.guard.reset()
	ctx, cancel := context.WithTimeout(ctx, s.client.config.Timeout)
	defer cancel()
	return s.client.call(ctx, s.session, s.guard, r)
}
func (c *Client) Discover(ctx context.Context) (Discovery, error) {
	ctx, cancel := context.WithTimeout(ctx, c.config.Timeout)
	defer cancel()
	session, guard, err := c.connect(ctx)
	if err != nil {
		return Discovery{}, err
	}
	defer func() { _ = session.Close() }()
	return c.discover(ctx, session, guard)
}
func (c *Client) discover(ctx context.Context, session *sdk.ClientSession, guard *guardTransport) (Discovery, error) {
	tools, err := listTools(ctx, session)
	if err != nil {
		return Discovery{}, publicError(err, guard)
	}
	if c.config.Secret != "" {
		raw, _ := json.Marshal(tools)
		if containsSecret(raw, c.config.Secret) {
			return Discovery{}, &Error{Code: "MCP_SECRET_IN_RESPONSE"}
		}
	}
	return Discovery{ProtocolVersion: session.InitializeResult().ProtocolVersion, Tools: tools}, nil
}

func listTools(ctx context.Context, session *sdk.ClientSession) ([]Tool, error) {
	tools := []Tool{}
	cursor := ""
	cursors := map[string]bool{}
	names := map[string]bool{}
	totalBytes := 0
	for page := 0; page < 100; page++ {
		result, err := session.ListTools(ctx, &sdk.ListToolsParams{Cursor: cursor})
		if err != nil {
			return nil, err
		}
		for _, remote := range result.Tools {
			tool, err := projectTool(remote)
			if err != nil {
				return nil, err
			}
			if names[tool.RemoteName] || len(tools) >= 1000 {
				return nil, &Error{Code: "MCP_DIRECTORY_LIMIT"}
			}
			raw, _ := json.Marshal(tool)
			totalBytes += len(raw)
			if totalBytes > 1<<20 {
				return nil, &Error{Code: "MCP_DIRECTORY_LIMIT"}
			}
			names[tool.RemoteName] = true
			tools = append(tools, tool)
		}
		if result.NextCursor == "" {
			return tools, nil
		}
		if cursors[result.NextCursor] {
			return nil, &Error{Code: "MCP_CURSOR_INVALID"}
		}
		cursors[result.NextCursor] = true
		cursor = result.NextCursor
	}
	return nil, &Error{Code: "MCP_DIRECTORY_LIMIT"}
}
func projectTool(tool *sdk.Tool) (Tool, error) {
	if tool == nil || tool.Name == "" || len(tool.Name) > 255 || !utf8.ValidString(tool.Name) || len(tool.Description) > 16<<10 || len(tool.Title) > 1024 {
		return Tool{}, &Error{Code: "MCP_TOOL_INVALID"}
	}
	input, err := json.Marshal(tool.InputSchema)
	if err != nil {
		return Tool{}, &Error{Code: "MCP_SCHEMA_INVALID"}
	}
	if _, err = ValidateSchema(input); err != nil {
		return Tool{}, err
	}
	var output json.RawMessage
	if tool.OutputSchema != nil {
		output, err = json.Marshal(tool.OutputSchema)
		if err != nil {
			return Tool{}, &Error{Code: "MCP_SCHEMA_INVALID"}
		}
		if _, err = ValidateSchema(output); err != nil {
			return Tool{}, err
		}
	}
	annotations := json.RawMessage(`{}`)
	if tool.Annotations != nil {
		annotations, err = json.Marshal(tool.Annotations)
		if err != nil {
			return Tool{}, &Error{Code: "MCP_SCHEMA_INVALID"}
		}
	}
	hash, err := fingerprint(input, output, annotations)
	if err != nil {
		return Tool{}, err
	}
	metadata, _ := json.Marshal([]string{hash, tool.Name, tool.Title, tool.Description})
	digest := sha256.Sum256(metadata)
	hash = fmt.Sprintf("%x", digest[:])
	return Tool{RemoteName: tool.Name, Title: tool.Title, Description: tool.Description, InputSchema: input, OutputSchema: output, Annotations: annotations, Fingerprint: hash}, nil
}

func (c *Client) Call(ctx context.Context, request CallRequest) (CallResult, error) {
	no := false
	result := CallResult{Executed: &no}
	if request.RemoteName == "" || len(request.Fingerprint) != 64 || request.ResultLimit < 1024 || request.ResultLimit > 64<<10 {
		return result, &Error{Code: "MCP_ARGUMENTS_INVALID"}
	}
	ctx, cancel := context.WithTimeout(ctx, c.config.Timeout)
	defer cancel()
	session, guard, err := c.connect(ctx)
	if err != nil {
		return result, err
	}
	defer func() { _ = session.Close() }()
	return c.call(ctx, session, guard, request)
}
func (c *Client) call(ctx context.Context, session *sdk.ClientSession, guard *guardTransport, request CallRequest) (CallResult, error) {
	no := false
	result := CallResult{Executed: &no}
	if request.RemoteName == "" || len(request.Fingerprint) != 64 || request.ResultLimit < 1024 || request.ResultLimit > 64<<10 {
		return result, &Error{Code: "MCP_ARGUMENTS_INVALID"}
	}
	result.ProtocolVersion = session.InitializeResult().ProtocolVersion
	tools, err := listTools(ctx, session)
	if err != nil {
		return result, publicError(err, guard)
	}
	var selected *Tool
	for n := range tools {
		if tools[n].RemoteName == request.RemoteName {
			selected = &tools[n]
			break
		}
	}
	if selected == nil {
		return result, &Error{Code: "MCP_TOOL_UNAVAILABLE"}
	}
	if selected.Fingerprint != request.Fingerprint {
		return result, &Error{Code: "MCP_SCHEMA_CHANGED"}
	}
	if err = ValidateArguments(selected.InputSchema, request.Arguments); err != nil {
		return result, err
	}
	remote, err := session.CallTool(ctx, &sdk.CallToolParams{Name: request.RemoteName, Arguments: request.Arguments})
	if err != nil {
		if guard.sent() {
			result.Executed = nil
		}
		return result, publicError(err, guard)
	}
	yes := true
	result.Executed = &yes
	if len(remote.InputRequests) > 0 {
		return result, &Error{Code: "MCP_INTERACTION_UNSUPPORTED", Dispatched: true}
	}
	result.IsError = remote.IsError
	if len(selected.OutputSchema) > 0 && remote.StructuredContent == nil && !remote.IsError {
		result.StructuredContent = nil
		return result, &Error{Code: "MCP_OUTPUT_SCHEMA_INVALID", Dispatched: true}
	}
	if c.config.Secret != "" {
		raw, e := json.Marshal(remote)
		if e != nil {
			return result, &Error{Code: "MCP_RESPONSE_INVALID", Dispatched: true}
		}
		if containsSecret(raw, c.config.Secret) {
			return result, &Error{Code: "MCP_SECRET_IN_RESPONSE", Dispatched: true}
		}
	}
	if remote.StructuredContent != nil {
		result.StructuredContent, err = json.Marshal(remote.StructuredContent)
		if err != nil {
			return result, &Error{Code: "MCP_RESPONSE_INVALID", Dispatched: true}
		}
		if len(selected.OutputSchema) > 0 {
			schema, e := ValidateSchema(selected.OutputSchema)
			if e != nil || schema.Validate(remote.StructuredContent) != nil {
				return result, &Error{Code: "MCP_OUTPUT_SCHEMA_INVALID", Dispatched: true}
			}
		}
	}
	parts := []string{}
	for _, block := range remote.Content {
		switch v := block.(type) {
		case *sdk.TextContent:
			parts = append(parts, v.Text)
		case *sdk.EmbeddedResource:
			if v.Resource != nil && v.Resource.Text != "" {
				parts = append(parts, v.Resource.Text)
			} else {
				parts = append(parts, "[MCP binary resource not imported]")
				result.Truncated = true
			}
		case *sdk.ResourceLink:
			parts = append(parts, "[MCP resource reference: "+v.Name+"]")
		default:
			parts = append(parts, "[MCP non-text content not imported]")
			result.Truncated = true
		}
	}
	if len(result.StructuredContent) > 0 {
		parts = append(parts, string(result.StructuredContent))
	}
	result.Content = strings.Join(parts, "\n")
	if len(result.Content) > request.ResultLimit {
		cut := request.ResultLimit
		for cut > 0 && !utf8.RuneStart(result.Content[cut]) {
			cut--
		}
		result.Content = result.Content[:cut]
		result.Truncated = true
	}
	if len(result.Content)+len(result.StructuredContent) > request.ResultLimit {
		result.StructuredContent = nil
		result.Truncated = true
	}
	return result, nil
}

func containsSecret(raw []byte, secret string) bool {
	encoded, _ := json.Marshal(secret)
	return strings.Contains(string(raw), secret) || len(encoded) >= 2 && strings.Contains(string(raw), string(encoded[1:len(encoded)-1]))
}

func publicError(err error, guard *guardTransport) error {
	var own *Error
	if errors.As(err, &own) {
		return &Error{Code: own.Code, HTTPStatus: own.HTTPStatus, Dispatched: own.Dispatched || guard.sent()}
	}
	code := "MCP_REMOTE_FAILED"
	if errors.Is(err, context.DeadlineExceeded) {
		code = "MCP_TIMEOUT"
	}
	if errors.Is(err, context.Canceled) {
		code = "MCP_CANCELLED"
	}
	return &Error{Code: code, Dispatched: guard.sent()}
}
