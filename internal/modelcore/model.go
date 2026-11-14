// Package modelcore defines model contracts independent of agent lifecycles and HTTP APIs.
package modelcore

import (
	"context"
	"encoding/json"
	"errors"
)

type ProviderType string
type Protocol string
type Support string

const (
	DeepSeek              ProviderType = "deepseek"
	MiniMax               ProviderType = "minimax"
	GLM                   ProviderType = "glm"
	Ollama                ProviderType = "ollama"
	Custom                ProviderType = "custom"
	ChatCompletions       Protocol     = "chat_completions"
	AnthropicMessages     Protocol     = "anthropic_messages"
	Supported             Support      = "supported"
	Unsupported           Support      = "unsupported"
	Unknown               Support      = "unknown"
	MaxMessageBytes                    = 256 << 10
	MaxToolArgumentsBytes              = 32 << 10
	MaxImageBytes                      = 32 << 20
	MaxImages                          = 10
)

var (
	ErrInvalidRequest   = errors.New("invalid model request")
	ErrUnsupported      = errors.New("model capability unsupported")
	ErrInvalidResponse  = errors.New("invalid model response")
	ErrIncompleteStream = errors.New("incomplete model stream")
	ErrOutputLimit      = errors.New("model output limit exceeded")
	ErrTransportTimeout = errors.New("model transport timed out")
	// Remote failure classes contain no connection or provider response data.
	// Adapters wrap these without retaining the original HTTP/network error.
	ErrRateLimited          = errors.New("model rate limited")
	ErrAuthenticationFailed = errors.New("model authentication failed")
	ErrRequestRejected      = errors.New("model request rejected")
	ErrRemoteService        = errors.New("model remote service failed")
	ErrTransport            = errors.New("model transport failed")
)

type Capabilities struct {
	TextInput   Support `json:"text_input"`
	ImageInput  Support `json:"image_input"`
	ToolCalling Support `json:"tool_calling"`
	Streaming   Support `json:"streaming"`
	Thinking    Support `json:"thinking"`
}

type ProtocolSpec struct {
	Protocol    Protocol `json:"protocol"`
	Implemented bool     `json:"implemented"`
	Verified    Support  `json:"verified"`
}

type ProviderSpec struct {
	Type               ProviderType   `json:"provider_type"`
	Name               string         `json:"name"`
	Protocols          []ProtocolSpec `json:"protocols"`
	AuthMethods        []string       `json:"auth_methods"`
	DiscoverySupported bool           `json:"discovery_supported"`
}

// Native is a request-compatible message, not an HTTP response envelope. Its
// ordered content blocks and provider fields are the replay source of truth.
// Structured fields are projections for orchestration; they must not replace Native.
type Message struct {
	Role           string          `json:"role"`
	Content        string          `json:"content"`
	Reasoning      string          `json:"reasoning,omitempty"`
	ToolCalls      []ToolCall      `json:"tool_calls,omitempty"`
	ToolCallID     string          `json:"tool_call_id,omitempty"`
	NativeProtocol Protocol        `json:"native_protocol,omitempty"`
	Native         json.RawMessage `json:"native,omitempty"`
	Images         []ImagePart     `json:"images,omitempty"`
}

// ImagePart is hydrated by the authorized host from a verified platform file.
// DataBase64 is never persisted in event/request JSON. Replaying history must
// re-read the same authorized file/hash; missing bytes are an error, not text.
type ImagePart struct {
	MIME          string `json:"mime"`
	ContentSHA256 string `json:"content_sha256"`
	// Origin is set only by the host's controlled read_image transaction. It
	// distinguishes a tool-owned observation from an uploaded user image.
	Origin     string `json:"origin,omitempty"`
	DataBase64 string `json:"-"`
}

type ToolCall struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type Tool struct {
	Name        string
	Description string
	InputSchema json.RawMessage
}

type Request struct {
	Model      string
	Protocol   Protocol
	Messages   []Message
	Tools      []Tool
	Parameters map[string]json.RawMessage
}

// Missing counts remain nil; cache counters must not be added to input again.
type Usage struct {
	InputTokens          *int64 `json:"input_tokens"`
	OutputTokens         *int64 `json:"output_tokens"`
	CacheReadTokens      *int64 `json:"cache_read_tokens"`
	CacheWriteTokens     *int64 `json:"cache_write_tokens"`
	NormalizationVersion string `json:"normalization_version"`
	// Actual provider counters only; keys are protocol-specific dotted paths.
	// This never contains the provider response, credentials, prompts or headers.
	RawNumericFields map[string]int64 `json:"raw_numeric_fields"`
}

type Response struct {
	Message       Message
	Usage         Usage
	ReturnedModel string
	FinishReason  string
}

// Delta is transient display only. ArgumentsText is a fragment, never executable.
// Tool IDs are local draft identifiers until the complete response is committed.
type Delta struct {
	Kind        string
	BlockIndex  int
	DraftCallID string
	Name        string
	Text        string
}

type Emit func(Delta) error

// Client makes exactly one attempt. Retry, persistence and authorization belong
// to the caller. A non-nil error never authorizes dispatch of partial tool calls.
type Client interface {
	Generate(context.Context, Request, Emit) (Response, error)
}
