package agentcore

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type PromptConfig struct {
	Platform      string
	Administrator string
}

// BuildPreparedStep implements the ordinary, universally supported route:
// current system head and current complete tool declarations. Unverified
// provider-specific in-history update semantics are deliberately not inferred.
// Clearing Administrator removes that entire contribution, including older
// versions; the model's locked route and generation parameters never change.
func BuildPreparedStep(ref ExecutionRef, step uint32, locked LockedModel, prompt PromptConfig, manifest SurfaceManifest, messages []modelcore.Message, tools []ToolSpec, parallel int) (PreparedStep, error) {
	if step == 0 || locked.RemoteModelID == "" || locked.Protocol != modelcore.ChatCompletions && locked.Protocol != modelcore.AnthropicMessages || parallel < 1 || parallel > 16 {
		return PreparedStep{}, invalid("prepared_step")
	}
	request := modelcore.Request{Model: locked.RemoteModelID, Protocol: locked.Protocol, Parameters: map[string]json.RawMessage{}, Messages: []modelcore.Message{}, Tools: []modelcore.Tool{}}
	for k, v := range locked.Parameters {
		request.Parameters[k] = append(json.RawMessage(nil), v...)
	}
	system := prompt.Platform
	if prompt.Administrator != "" {
		if system != "" {
			system += "\n\n"
		}
		system += prompt.Administrator
	}
	if system != "" {
		request.Messages = append(request.Messages, modelcore.Message{Role: "system", Content: system})
	}
	for _, message := range messages {
		if message.Role == "system" {
			return PreparedStep{}, reject("SURFACE_SYSTEM_UPDATE_UNSUPPORTED")
		}
		if len(message.Images) > 0 && (message.Role != "user" && message.Role != "tool" || locked.Capabilities.ImageInput != modelcore.Supported) {
			return PreparedStep{}, reject("MODEL_CAPABILITY_UNSUPPORTED")
		}
		if message.Role == "tool" && len(message.Images) > 0 {
			for _, image := range message.Images {
				if message.ToolCallID == "" || image.Origin != "tool_image" {
					return PreparedStep{}, reject("TOOL_IMAGE_INVALID")
				}
			}
		}
		request.Messages = append(request.Messages, cloneMessage(message))
	}
	selected := []ToolSpec{}
	for _, tool := range tools {
		if tool.Policy != "deny" {
			selected = append(selected, tool)
		}
	}
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].Key != selected[j].Key {
			return selected[i].Key < selected[j].Key
		}
		return selected[i].Definition.Name < selected[j].Definition.Name
	})
	if len(selected) > 128 {
		return PreparedStep{}, invalid("tools")
	}
	seen := map[string]bool{}
	for n, spec := range selected {
		name := spec.Definition.Name
		if strings.TrimSpace(name) == "" || seen[name] || len(name) > 64 || len(spec.Definition.InputSchema) > 32<<10 {
			return PreparedStep{}, invalid("tools")
		}
		seen[name] = true
		var schema map[string]json.RawMessage
		if json.Unmarshal(spec.Definition.InputSchema, &schema) != nil || schema == nil {
			return PreparedStep{}, invalid("tool_schema")
		}
		canonical, err := CanonicalJSON(spec.Definition.InputSchema)
		if err != nil {
			return PreparedStep{}, err
		}
		spec.Definition.InputSchema = canonical
		selected[n] = spec
		request.Tools = append(request.Tools, spec.Definition)
	}
	return PreparedStep{Ref: ref, Step: step, Request: request, Manifest: manifest, Tools: selected, MaxParallelTools: parallel}, nil
}
