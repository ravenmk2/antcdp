package modeladapters

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type ProbeRequest struct {
	Kind       string
	Model      string
	Parameters map[string]json.RawMessage
	Levels     []string
}
type Check struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Reason *string `json:"reason"`
}
type Diagnostic struct {
	Kind         string                 `json:"kind"`
	Status       string                 `json:"status"`
	StartedAt    time.Time              `json:"started_at"`
	FinishedAt   time.Time              `json:"finished_at"`
	Checks       []Check                `json:"checks"`
	Capabilities modelcore.Capabilities `json:"capabilities"`
	Usage        modelcore.Usage        `json:"usage"`
}
type ProbeResult struct {
	Diagnostic *Diagnostic       `json:"diagnostic,omitempty"`
	Models     []DiscoveredModel `json:"models,omitempty"`
	Truncated  bool              `json:"truncated,omitempty"`
}

// Probe performs only fixed, bounded inputs. It neither executes tools nor
// accepts arbitrary prompt/URL/headers. The host adds its operation ID/version.
func Probe(ctx context.Context, config Config, input ProbeRequest) (ProbeResult, error) {
	client, err := NewClient(config, nil)
	if err != nil {
		return ProbeResult{}, err
	}
	if input.Kind == "model_discovery" {
		result, err := client.Discover(ctx)
		return ProbeResult{Models: result.Models, Truncated: result.Truncated}, err
	}
	if input.Kind != "provider_probe" && input.Kind != "model_probe" {
		return ProbeResult{}, modelcore.ErrInvalidRequest
	}
	d := &Diagnostic{Kind: input.Kind, Status: "succeeded", StartedAt: time.Now().UTC(), Checks: []Check{}, Capabilities: modelcore.Capabilities{TextInput: modelcore.Unknown, ImageInput: modelcore.Unknown, ToolCalling: modelcore.Unknown, Streaming: modelcore.Unknown, Thinking: modelcore.Unknown}}
	finish := func() (ProbeResult, error) { d.FinishedAt = time.Now().UTC(); return ProbeResult{Diagnostic: d}, nil }
	check := func(name, status, reason string) {
		var p *string
		if reason != "" {
			p = &reason
		}
		d.Checks = append(d.Checks, Check{Name: name, Status: status, Reason: p})
		if status == "failed" {
			d.Status = "failed"
		} else if status == "unsupported" && d.Status == "succeeded" {
			d.Status = "unsupported"
		}
	}
	if input.Kind == "provider_probe" {
		_, err = client.Discover(ctx)
		if errors.Is(err, modelcore.ErrUnsupported) {
			check("connectivity", "unsupported", "discovery_not_registered")
		} else if err != nil {
			check("connectivity", "failed", diagnosticReason(err))
		} else {
			check("connectivity", "succeeded", "")
		}
		return finish()
	}
	if input.Model == "" || len(input.Levels) == 0 {
		return ProbeResult{}, modelcore.ErrInvalidRequest
	}
	levels := map[string]bool{}
	for _, level := range input.Levels {
		if (level != "generation" && level != "tools" && level != "stream" && level != "thinking") || levels[level] {
			return ProbeResult{}, modelcore.ErrInvalidRequest
		}
		levels[level] = true
	}
	parameters := make(map[string]json.RawMessage, len(input.Parameters)+1)
	for key, value := range input.Parameters {
		parameters[key] = append(json.RawMessage(nil), value...)
	}
	if _, ok := parameters["max_output_tokens"]; !ok {
		parameters["max_output_tokens"] = json.RawMessage("256")
	}
	request := modelcore.Request{Model: input.Model, Protocol: config.Protocol, Parameters: parameters, Messages: []modelcore.Message{{Role: "user", Content: "Reply with the single word OK. If the verification_echo tool is available, call it with value OK instead."}}}
	if levels["tools"] {
		request.Tools = []modelcore.Tool{{Name: "verification_echo", Description: "Return the verification text without side effects.", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}`)}}
	}
	chunks := 0
	response, err := client.Generate(ctx, request, func(modelcore.Delta) error { chunks++; return nil })
	if err != nil {
		for _, level := range input.Levels {
			check(level, "failed", diagnosticReason(err))
		}
		return finish()
	}
	d.Usage = response.Usage
	d.Capabilities.TextInput = modelcore.Supported
	for _, level := range input.Levels {
		switch level {
		case "generation":
			check(level, "succeeded", "")
		case "stream":
			if chunks > 0 {
				d.Capabilities.Streaming = modelcore.Supported
				check(level, "succeeded", "")
			} else {
				check(level, "unsupported", "stream_output_not_observed")
			}
		case "tools":
			if len(response.Message.ToolCalls) > 0 {
				valid := true
				for _, call := range response.Message.ToolCalls {
					valid = valid && call.Name == "verification_echo" && validVerificationArguments(call.Arguments)
				}
				if valid {
					d.Capabilities.ToolCalling = modelcore.Supported
					check(level, "succeeded", "")
				} else {
					check(level, "failed", "unexpected_tool")
				}
			} else {
				check(level, "unsupported", "tool_call_not_observed")
			}
		case "thinking":
			if response.Message.Reasoning != "" {
				d.Capabilities.Thinking = modelcore.Supported
				check(level, "succeeded", "")
			} else {
				check(level, "unsupported", "thinking_not_observed")
			}
		}
	}
	return finish()
}

func validVerificationArguments(arguments string) bool {
	var value struct {
		Value string `json:"value"`
	}
	decoder := json.NewDecoder(bytes.NewBufferString(arguments))
	decoder.DisallowUnknownFields()
	return decoder.Decode(&value) == nil && value.Value == "OK"
}

func diagnosticReason(err error) string {
	var remote *RemoteError
	switch {
	case errors.As(err, &remote):
		if remote.Kind == "timeout" {
			return "transport_timed_out"
		}
		if remote.Status == 401 || remote.Status == 403 {
			return "authentication_rejected"
		}
		if remote.Status == 429 {
			return "rate_limited"
		}
		return "remote_rejected"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return "cancelled_or_timed_out"
	case errors.Is(err, modelcore.ErrOutputLimit):
		return "output_limit_exceeded"
	case errors.Is(err, modelcore.ErrIncompleteStream):
		return "stream_incomplete"
	case errors.Is(err, modelcore.ErrUnsupported):
		return "protocol_unsupported"
	default:
		return "model_call_failed"
	}
}
