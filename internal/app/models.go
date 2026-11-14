package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type modelProtocolCatalog struct {
	ThinkingOptions []modelcore.ThinkingOption `json:"thinking_options"`
	Protocol        modelcore.Protocol         `json:"protocol"`
	Available       bool                       `json:"available"`
	Reason          *string                    `json:"reason"`
	Parameters      json.RawMessage            `json:"parameter_schema"`
}

type modelProviderCatalog struct {
	DefaultBaseURL     string                 `json:"default_base_url"`
	DefaultIconKey     string                 `json:"default_icon_key"`
	Type               modelcore.ProviderType `json:"provider_type"`
	Name               string                 `json:"name"`
	Protocols          []modelProtocolCatalog `json:"protocols"`
	AuthMethods        []string               `json:"auth_methods"`
	DiscoverySupported bool                   `json:"discovery_supported"`
}

func newModelService(installer *install.Service, accounts *identity.Service) *models.Service {
	registry := modeladapters.NewRegistry()
	return &models.Service{
		Identity: accounts, Cipher: installer.ModelSecret, ETag: installer.ModelETag,
		Store: func() (identity.Store, error) {
			if store, ok := installer.Backend().(identity.Store); ok {
				return store, nil
			}
			return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
		},
		Types: func() any { return map[string]any{"items": modelProviderTypes(registry), "icons": models.Icons()} },
		ValidateParameters: func(provider, protocol string, raw json.RawMessage) error {
			var parameters map[string]json.RawMessage
			if json.Unmarshal(raw, &parameters) != nil || parameters == nil {
				return httpx.Invalid("parameters", "invalid_object")
			}
			if err := registry.ValidateParameters(modelcore.ProviderType(provider), modelcore.Protocol(protocol), parameters); err != nil {
				return httpx.E(422, "MODEL_PARAMETER_UNSUPPORTED", "当前模型协议不支持这些参数")
			}
			return nil
		},
		ThinkingCatalog: func(kind, protocol string) []models.ThinkingOption {
			return registry.ThinkingOptions(modelcore.ProviderType(kind), modelcore.Protocol(protocol))
		},
		Probe: probeModelConnection,
	}
}

func modelProviderTypes(registry *modeladapters.Registry) []modelProviderCatalog {
	items := make([]modelProviderCatalog, 0, len(registry.Types()))
	for _, provider := range registry.Types() {
		item := modelProviderCatalog{DefaultBaseURL: models.DefaultBaseURL(string(provider.Type)), DefaultIconKey: models.DefaultIcon(string(provider.Type)), Type: provider.Type, Name: provider.Name, AuthMethods: provider.AuthMethods, DiscoverySupported: provider.DiscoverySupported, Protocols: []modelProtocolCatalog{}}
		for _, protocol := range provider.Protocols {
			schema, err := registry.ParameterSchema(provider.Type, protocol.Protocol)
			entry := modelProtocolCatalog{ThinkingOptions: registry.ThinkingOptions(provider.Type, protocol.Protocol), Protocol: protocol.Protocol, Available: protocol.Implemented && err == nil, Parameters: schema}
			if !entry.Available {
				reason := "ADAPTER_UNAVAILABLE"
				entry.Reason = &reason
			}
			item.Protocols = append(item.Protocols, entry)
		}
		items = append(items, item)
	}
	return items
}

func probeModelConnection(ctx context.Context, request models.ProbeRequest) (json.RawMessage, error) {
	config := modeladapters.Config{
		Provider: modelcore.ProviderType(request.Provider.Type), Protocol: modelcore.ChatCompletions,
		BaseURL: request.Provider.Config.BaseURL, APIKey: request.Secret,
		ConnectTimeout: time.Duration(request.Provider.Config.ConnectTimeout) * time.Second,
		RequestTimeout: time.Duration(request.Provider.Config.RequestTimeout) * time.Second,
	}
	if request.Provider.Config.CustomCA != nil {
		config.CustomCAPEM = *request.Provider.Config.CustomCA
	}
	probe := modeladapters.ProbeRequest{Kind: request.Kind, Levels: request.Levels, Parameters: map[string]json.RawMessage{}}
	if request.Model != nil {
		config.Protocol = modelcore.Protocol(request.Model.Protocol)
		probe.Model = request.Model.RemoteModelID
		if err := json.Unmarshal(request.Model.Parameters, &probe.Parameters); err != nil {
			return nil, modelcore.ErrInvalidRequest
		}
		if len(request.Model.Thinking) > 0 {
			choice := request.Model.Thinking[0]
			for _, level := range request.Levels {
				if level != "thinking" {
					continue
				}
				for _, option := range request.Model.Thinking {
					if diagnosticThinkingEnabled(option.Parameters) {
						choice = option
						break
					}
				}
			}
			var values map[string]json.RawMessage
			if err := json.Unmarshal(choice.Parameters, &values); err != nil {
				return nil, modelcore.ErrInvalidRequest
			}
			for key, value := range values {
				probe.Parameters[key] = value
			}
		}
		// Diagnostics have fixed short prompts and a bounded output allowance.
		limit := min(request.Model.MaxOutput, uint64(2048))
		output, err := json.Marshal(limit)
		if err != nil {
			return nil, err
		}
		probe.Parameters["max_output_tokens"] = output
	}
	result, err := modeladapters.Probe(ctx, config, probe)
	if err != nil {
		return nil, err
	}
	if request.Kind == "model_discovery" {
		if result.Models == nil {
			result.Models = []modeladapters.DiscoveredModel{}
		}
		return json.Marshal(struct {
			Models    []modeladapters.DiscoveredModel `json:"models"`
			Truncated bool                            `json:"truncated"`
		}{result.Models, result.Truncated})
	}
	return json.Marshal(struct {
		Diagnostic *modeladapters.Diagnostic `json:"diagnostic"`
	}{result.Diagnostic})
}

func diagnosticThinkingEnabled(parameters json.RawMessage) bool {
	var values struct {
		Thinking struct {
			Type string `json:"type"`
		} `json:"thinking"`
		Effort string `json:"reasoning_effort"`
		Output struct {
			Effort string `json:"effort"`
		} `json:"output_config"`
	}
	if json.Unmarshal(parameters, &values) != nil || values.Thinking.Type == "disabled" || values.Effort == "none" || values.Output.Effort == "none" {
		return false
	}
	return values.Thinking.Type == "enabled" || values.Thinking.Type == "adaptive" || values.Effort != "" || values.Output.Effort != ""
}
