package agents

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type ThinkingOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Hash  string `json:"model_selection_hash,omitempty"`
}
type ModelOption struct {
	DefaultThinking string            `json:"default_thinking_option_key,omitempty"`
	Hash            string            `json:"model_selection_hash,omitempty"`
	BindingID       uint64            `json:"binding_id,string"`
	ModelID         uint64            `json:"model_id,string"`
	Name            string            `json:"display_name"`
	ProviderLabel   string            `json:"provider_label"`
	Protocol        string            `json:"protocol"`
	ImageInput      modelcore.Support `json:"image_input"`
	Thinking        []ThinkingOption  `json:"thinking_options"`
}
type CatalogAgent struct {
	Favorited       bool          `json:"favorited"`
	ID              uint64        `json:"id,string"`
	Name            string        `json:"name"`
	Description     string        `json:"description"`
	Models          []ModelOption `json:"model_options"`
	DefaultModelID  *uint64       `json:"default_model_binding_id,string"`
	DefaultThinking *string       `json:"default_thinking_option_key"`
	SandboxRequired bool          `json:"sandbox_required"`
	Availability    Availability  `json:"availability"`
	ScopeKind       string        `json:"scope_kind"`
}
type StartOptions struct {
	AgentID         uint64        `json:"agent_id,string"`
	Models          []ModelOption `json:"model_options"`
	DefaultModelID  *uint64       `json:"default_model_binding_id,string"`
	DefaultThinking *string       `json:"default_thinking_option_key"`
	ScopeKind       string        `json:"scope_kind"`
}
type EffectiveSelection struct {
	BindingID     uint64            `json:"model_binding_id,string"`
	ModelID       uint64            `json:"model_definition_id,string"`
	ProviderLabel string            `json:"provider_label"`
	Name          string            `json:"model_name"`
	RemoteModelID string            `json:"model_id"`
	Protocol      string            `json:"protocol"`
	ImageInput    modelcore.Support `json:"image_input,omitempty"`
	Thinking      string            `json:"thinking_option_key"`
	ThinkingLabel string            `json:"thinking_label"`
	Parameters    json.RawMessage   `json:"effective_parameters"`
	Hash          string            `json:"model_selection_hash"`
	Locked        bool              `json:"locked"`
	Availability  Availability      `json:"availability"`
}

func thinkingAllowed(allowed []string, key string) bool {
	if key == "" {
		return len(allowed) == 0
	}
	return slices.Contains(allowed, key)
}

func (s *Service) resolveModel(view *models.RuntimeModel, b ModelBinding, thinking string) (agentcore.LockedModel, EffectiveSelection, error) {
	if !thinkingAllowed(b.ThinkingOptions, thinking) {
		return agentcore.LockedModel{}, EffectiveSelection{}, httpx.Invalid("thinking_option_key", "not_allowed")
	}
	parameters, e := s.validateModelBinding(view, modelWrites([]ModelBinding{b})[0])
	if e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	label := thinking
	for _, opt := range view.Thinking {
		if opt.Key == thinking {
			label = opt.Label
			values, e := objectJSON(opt.Parameters, "thinking.parameters")
			if e != nil {
				return agentcore.LockedModel{}, EffectiveSelection{}, e
			}
			for k, v := range values {
				parameters[k] = v
			}
		}
	}
	connection, e := json.Marshal(view.Route())
	if e != nil {
		return agentcore.LockedModel{}, EffectiveSelection{}, e
	}
	m := agentcore.LockedModel{SchemaVersion: 1, ProviderID: agentcore.ID(view.ProviderID), DefinitionID: agentcore.ID(view.DefinitionID), BindingID: agentcore.ID(b.ID), ProviderType: modelcore.ProviderType(view.ProviderType), Protocol: modelcore.Protocol(view.Protocol), RemoteModelID: view.RemoteModelID, ThinkingKey: thinking, Parameters: parameters, Connection: connection, Capabilities: modelcore.Capabilities{TextInput: modelcore.Support(view.Capabilities.Text), ImageInput: modelcore.Support(view.Capabilities.Image), ToolCalling: modelcore.Support(view.Capabilities.Tools), StructuredOutput: modelcore.Support(view.Capabilities.StructuredOutput), Streaming: modelcore.Support(view.Capabilities.Streaming), Thinking: modelcore.Support(view.Capabilities.Thinking)}, ContextWindow: view.ContextWindow, MaxOutputTokens: view.MaxOutput}
	hash, e := agentcore.ContentHash(m)
	if e != nil {
		return m, EffectiveSelection{}, e
	}
	m.SelectionHash = hash
	raw, e := json.Marshal(parameters)
	if e != nil {
		return m, EffectiveSelection{}, e
	}
	selection := EffectiveSelection{BindingID: b.ID, ModelID: b.ModelID, ProviderLabel: view.ProviderName, Name: view.Name, RemoteModelID: view.RemoteModelID, Protocol: view.Protocol, Thinking: thinking, ThinkingLabel: label, Parameters: raw, Hash: hash, Availability: Availability{Available: view.Available && supportsReplyFormat(view, parameters)}}
	if !selection.Availability.Available {
		reason := "MODEL_UNAVAILABLE"
		selection.Availability.Reason = &reason
	}
	return m, selection, nil
}
func (s *Service) catalogAgent(tx identity.Tx, r Repository, v *Definition, hashes bool) (CatalogAgent, error) {
	if e := s.definition(v); e != nil {
		return CatalogAgent{}, e
	}
	if s.Models == nil {
		return CatalogAgent{}, unavailable()
	}
	rows, e := r.ModelBindings(v.ID, false)
	if e != nil {
		return CatalogAgent{}, e
	}
	if e = decodeModels(rows); e != nil {
		return CatalogAgent{}, e
	}
	ids := []uint64{}
	for _, row := range rows {
		ids = append(ids, row.ModelID)
	}
	views, e := s.Models.ReadRuntimeModels(tx, ids)
	if e != nil {
		return CatalogAgent{}, e
	}
	out := CatalogAgent{ID: v.ID, Name: v.Name, Description: v.Description, Models: []ModelOption{}, DefaultModelID: v.DefaultModelBindingID, ScopeKind: v.ScopeKind}
bindings:
	for _, b := range rows {
		view := views[b.ModelID]
		if !view.Available {
			continue
		}
		option := ModelOption{DefaultThinking: b.DefaultThinking, BindingID: b.ID, ModelID: b.ModelID, Name: view.Name, ProviderLabel: view.ProviderName, Protocol: view.Protocol, ImageInput: modelcore.Support(view.Capabilities.Image), Thinking: []ThinkingOption{}}
		levels := b.ThinkingOptions
		if len(levels) == 0 {
			levels = []string{""}
		}
		for _, key := range levels {
			_, selection, e := s.resolveModel(view, b, key)
			if e != nil {
				return out, e
			}
			if !selection.Availability.Available {
				continue bindings
			}
			thinking := ThinkingOption{Key: key, Label: selection.ThinkingLabel}
			if hashes {
				thinking.Hash = selection.Hash
				if key == b.DefaultThinking {
					option.Hash = selection.Hash
				}
			}
			if key != "" {
				option.Thinking = append(option.Thinking, thinking)
			}
		}
		out.Models = append(out.Models, option)
		if v.DefaultModelBindingID != nil && b.ID == *v.DefaultModelBindingID {
			key := b.DefaultThinking
			out.Availability.Available = v.Enabled
			if key != "" {
				out.DefaultThinking = &key
			}
		}
	}
	if !out.Availability.Available {
		reason := "AGENT_UNAVAILABLE"
		out.Availability.Reason = &reason
	}
	return out, nil
}
func (s *Service) ListCatalog(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		enabled := true
		q.Mode = "chat"
		q.Enabled = &enabled
		q.CatalogUserID = a.User.ID
		q.CatalogAdmin = a.User.Role == "admin"
		rows, total, e := r.Definitions(q)
		if e != nil {
			return e
		}
		ids := make([]uint64, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
		}
		favorites, e := r.FavoriteAgents(a.User.ID, ids)
		if e != nil {
			return e
		}
		items := []CatalogAgent{}
		for i := range rows {
			item, e := s.catalogAgent(tx, r, &rows[i], false)
			if e != nil {
				return e
			}
			item.Favorited = favorites[item.ID]
			items = append(items, item)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetCatalog(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		v, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		if v == nil || v.Mode != "chat" || !v.Enabled {
			return missing()
		}
		allowed, e := r.CanUseAgent(v.ID, a.User.ID, a.User.Role == "admin")
		if e != nil {
			return e
		}
		if !allowed {
			return missing()
		}
		value, e := s.catalogAgent(tx, r, v, false)
		if e != nil {
			return e
		}
		if !value.Availability.Available {
			return missing()
		}
		favorites, e := r.FavoriteAgents(a.User.ID, []uint64{id})
		if e != nil {
			return e
		}
		value.Favorited = favorites[id]
		out.Data = value
		return nil
	})
}
func (s *Service) StartOptions(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		v, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		value, e := s.catalogAgent(tx, r, v, true)
		if e != nil {
			return e
		}
		allowed, e := r.CanUseAgent(v.ID, a.User.ID, a.User.Role == "admin")
		if e != nil {
			return e
		}
		if !allowed {
			return missing()
		}
		out.Data = StartOptions{AgentID: id, Models: value.Models, DefaultModelID: value.DefaultModelID, DefaultThinking: value.DefaultThinking, ScopeKind: v.ScopeKind}
		return nil
	})
}
