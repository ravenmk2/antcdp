package agents

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func decodeModels(rows []ModelBinding) error {
	for i := range rows {
		if json.Unmarshal(rows[i].ThinkingJSON, &rows[i].ThinkingOptions) != nil {
			return integrity()
		}
	}
	return nil
}
func (s *Service) bindingDefinition(r Repository, id uint64, kind, tag string) (*Definition, error) {
	v, e := r.Definition(id, true)
	if e != nil {
		return nil, e
	}
	if e = s.definition(v); e != nil {
		return nil, e
	}
	if v.DeletedAt != nil {
		return nil, missing()
	}
	if tag != "" {
		if e = checkTag(tag, s.tag(kind, id, v.RowVersion)); e != nil {
			return nil, e
		}
	}
	return v, nil
}
func (s *Service) saveBindingChange(ctx context.Context, tx identity.Tx, r Repository, a *identity.Auth, v *Definition, kind string) error {
	v.RowVersion++
	if e := encodeDefinition(v); e != nil {
		return e
	}
	if e := r.SaveDefinition(v); e != nil {
		return e
	}
	return audit(ctx, tx, a, "agent."+kind, "agent", v.ID)
}
func (s *Service) bindingResult(out *Result, v *Definition, kind string, items any) {
	tag := s.tag(kind, v.ID, v.RowVersion)
	out.Tag = tag
	out.Data = map[string]any{"items": items, "version": strings.Trim(tag, `"`)}
}
func (s *Service) GetModelBindings(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := s.bindingDefinition(r, id, "model-bindings", "")
		if e != nil {
			return e
		}
		rows, e := r.ModelBindings(id, false)
		if e != nil {
			return e
		}
		if e = decodeModels(rows); e != nil {
			return e
		}
		s.bindingResult(out, v, "model-bindings", rows)
		out.Data.(map[string]any)["default_model_binding_id"] = stringID(v.DefaultModelBindingID)
		return nil
	})
}
func stringID(v *uint64) any {
	if v == nil {
		return nil
	}
	return strconv.FormatUint(*v, 10)
}
func (s *Service) validateModelBinding(v *models.RuntimeModel, w ModelBindingWrite) (json.RawMessage, error) {
	if len(w.ThinkingOptions) == 0 || len(w.ThinkingOptions) > 32 {
		return nil, httpx.Invalid("items.thinking_options", "invalid_length")
	}
	seen := map[string]bool{}
	foundDefault := false
	for _, key := range w.ThinkingOptions {
		if seen[key] {
			return nil, httpx.Invalid("items.thinking_options", "duplicate")
		}
		seen[key] = true
		found := false
		for _, option := range v.Thinking {
			if option.Key == key {
				found = true
			}
		}
		if !found {
			return nil, httpx.Invalid("items.thinking_options", "unsupported")
		}
		foundDefault = foundDefault || key == w.DefaultThinking
	}
	if !foundDefault {
		return nil, httpx.Invalid("items.default_thinking", "not_allowed")
	}
	overrides, e := objectJSON(w.GenerationOverrides, "items.generation_overrides")
	if e != nil {
		return nil, e
	}
	base, e := objectJSON(v.Parameters, "model.default_parameters")
	if e != nil {
		return nil, e
	}
	for k, value := range overrides {
		if modelcore.IsThinkingParameter(k) {
			return nil, httpx.Invalid("items.generation_overrides", "use_thinking_options")
		}
		base[k] = value
	}
	if s.Models == nil || s.Models.ValidateParameters == nil {
		return nil, unavailable()
	}
	for _, key := range w.ThinkingOptions {
		effective := map[string]json.RawMessage{}
		for k, value := range base {
			effective[k] = value
		}
		for _, opt := range v.Thinking {
			if opt.Key == key {
				params, e := objectJSON(opt.Parameters, "thinking.parameters")
				if e != nil {
					return nil, e
				}
				for k, value := range params {
					effective[k] = value
				}
			}
		}
		b, e := json.Marshal(effective)
		if e != nil {
			return nil, e
		}
		if e = s.Models.ValidateParameters(v.ProviderType, v.Protocol, b); e != nil {
			return nil, e
		}
		for _, field := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
			if raw, ok := effective[field]; ok {
				var n uint64
				if json.Unmarshal(raw, &n) != nil || n == 0 || n > v.MaxOutput || n > v.ContextWindow {
					return nil, httpx.Invalid("items.generation_overrides."+field, "invalid_range")
				}
			}
		}
	}
	return json.Marshal(overrides)
}
func (s *Service) PutModelBindings(ctx context.Context, raw string, id uint64, tag string, w ModelBindingsWrite) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if tag == "" {
			return checkTag(tag, "")
		}
		if len(w.Items) > 32 {
			return httpx.Invalid("items", "too_many")
		}
		if s.Models == nil {
			return unavailable()
		}
		ids := []uint64{}
		seen := map[uint64]bool{}
		for _, item := range w.Items {
			n, e := idValue(item.ModelID, "items.model_definition_id")
			if e != nil {
				return e
			}
			if seen[n] {
				return httpx.Invalid("items.model_definition_id", "duplicate")
			}
			seen[n] = true
			ids = append(ids, n)
		}
		views, e := s.Models.ReadRuntimeModels(tx, ids)
		if e != nil {
			return e
		}
		rows := []ModelBinding{}
		for i, item := range w.Items {
			parameters, e := s.validateModelBinding(views[ids[i]], item)
			if e != nil {
				return e
			}
			thinking, e := json.Marshal(item.ThinkingOptions)
			if e != nil {
				return e
			}
			rows = append(rows, ModelBinding{AgentID: id, ModelID: ids[i], ThinkingOptions: item.ThinkingOptions, ThinkingJSON: thinking, DefaultThinking: item.DefaultThinking, GenerationOverrides: parameters, SortOrder: i})
		}
		v, e := s.bindingDefinition(r, id, "model-bindings", tag)
		if e != nil {
			return e
		}
		var defaultID uint64
		if len(rows) == 0 {
			if w.DefaultModelID != "" || w.DefaultThinking != "" {
				return httpx.Invalid("default_model_id", "not_allowed")
			}
			if v.Enabled {
				return httpx.Invalid("items", "default_model_required")
			}
		} else {
			defaultID, e = idValue(w.DefaultModelID, "default_model_id")
			if e != nil {
				return e
			}
			found := false
			for _, row := range rows {
				if row.ModelID == defaultID {
					found = true
					if row.DefaultThinking != w.DefaultThinking {
						return httpx.Invalid("default_thinking_option_key", "mismatch")
					}
				}
			}
			if !found {
				return httpx.Invalid("default_model_id", "not_bound")
			}
		}
		if v.Enabled {
			tools, e := r.ToolBindings(id, false)
			if e != nil {
				return e
			}
			mcpBindings, e := r.MCPBindings(id, false)
			if e != nil {
				return e
			}
			needsTools := slices.ContainsFunc(tools, func(v ToolBinding) bool { return v.Policy != "deny" }) || slices.ContainsFunc(mcpBindings, func(v MCPBinding) bool { return v.Enabled })
			for _, row := range rows {
				if !views[row.ModelID].Available {
					return httpx.E(409, "MODEL_UNAVAILABLE", "绑定模型当前不可用")
				}
				if views[row.ModelID].Capabilities.Text != "supported" || needsTools && views[row.ModelID].Capabilities.Tools != "supported" {
					return httpx.E(422, "MODEL_CAPABILITY_UNSUPPORTED", "绑定模型缺少智能体需要的能力")
				}
			}
		}
		old, e := r.ModelBindings(id, false)
		if e != nil {
			return e
		}
		if e = decodeModels(old); e != nil {
			return e
		}
		oldWrites := modelWrites(old)
		newWrites := modelWrites(rows)
		oldDefault := uint64(0)
		for _, row := range old {
			if v.DefaultModelBindingID != nil && row.ID == *v.DefaultModelBindingID {
				oldDefault = row.ModelID
			}
		}
		if !same(oldWrites, newWrites) || oldDefault != defaultID {
			if e = r.SaveModelBindings(id, rows, time.Now().UTC().Truncate(time.Millisecond)); e != nil {
				return e
			}
			rows, e = r.ModelBindings(id, false)
			if e != nil {
				return e
			}
			if e = decodeModels(rows); e != nil {
				return e
			}
			v.DefaultModelBindingID = nil
			for _, row := range rows {
				if row.ModelID == defaultID {
					n := row.ID
					v.DefaultModelBindingID = &n
				}
			}
			if e = s.saveBindingChange(ctx, tx, r, a, v, "model-bindings"); e != nil {
				return e
			}
		} else {
			rows = old
		}
		s.bindingResult(out, v, "model-bindings", rows)
		out.Data.(map[string]any)["default_model_binding_id"] = stringID(v.DefaultModelBindingID)
		return nil
	})
}
func modelWrites(rows []ModelBinding) []ModelBindingWrite {
	out := []ModelBindingWrite{}
	for _, row := range rows {
		out = append(out, ModelBindingWrite{strconv.FormatUint(row.ModelID, 10), row.ThinkingOptions, row.DefaultThinking, row.GenerationOverrides})
	}
	return out
}
func (s *Service) GetToolBindings(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, e := s.bindingDefinition(r, id, "tool-bindings", "")
		if e != nil {
			return e
		}
		rows, e := r.ToolBindings(id, false)
		if e != nil {
			return e
		}
		s.bindingResult(out, v, "tool-bindings", rows)
		return nil
	})
}
func (s *Service) PutToolBindings(ctx context.Context, raw string, id uint64, tag string, w ToolBindingsWrite) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if tag == "" {
			return checkTag(tag, "")
		}
		if len(w.Items) > 128 {
			return httpx.Invalid("items", "too_many")
		}
		if len(w.Items) > 0 && s.Catalog.Tool == nil {
			return unavailable()
		}
		// Follow the runtime lock order: model parents before the Agent. The
		// later Agent ETag check rejects any concurrent binding change.
		initial, e := r.Definition(id, false)
		if e != nil {
			return e
		}
		if e = s.definition(initial); e != nil {
			return e
		}
		if initial.Enabled && slices.ContainsFunc(w.Items, func(v ToolBindingWrite) bool { return v.Policy != "deny" }) {
			if s.Models == nil {
				return unavailable()
			}
			bindings, e := r.ModelBindings(id, false)
			if e != nil {
				return e
			}
			ids := make([]uint64, len(bindings))
			for i, binding := range bindings {
				ids[i] = binding.ModelID
			}
			views, e := s.Models.ReadRuntimeModels(tx, ids)
			if e != nil {
				return e
			}
			for _, view := range views {
				if view.Capabilities.Text != "supported" || view.Capabilities.Tools != "supported" {
					return httpx.E(422, "MODEL_CAPABILITY_UNSUPPORTED", "绑定模型缺少智能体需要的能力")
				}
			}
		}
		items := slices.Clone(w.Items)
		slices.SortFunc(items, func(a, b ToolBindingWrite) int { return strings.Compare(a.ToolKey, b.ToolKey) })
		specs := map[string]*ToolDescriptor{}
		for _, item := range items {
			if _, ok := specs[item.ToolKey]; ok {
				return httpx.Invalid("items.tool_key", "duplicate")
			}
			if len(item.ToolKey) < 1 || len(item.ToolKey) > 64 {
				return httpx.Invalid("items.tool_key", "invalid_length")
			}
			spec, e := s.Catalog.Tool(ctx, tx, item.ToolKey)
			if e != nil {
				return e
			}
			if spec == nil {
				return httpx.Invalid("items.tool_key", "unknown")
			}
			if !slices.Contains(spec.SupportedPolicies, item.Policy) {
				return httpx.E(422, "TOOL_POLICY_UNSUPPORTED", "工具不支持此执行策略")
			}
			constraints, e := objectJSON(item.Constraints, "items.parameter_constraints")
			if e != nil {
				return e
			}
			b, e := json.Marshal(constraints)
			if e != nil {
				return e
			}
			if s.Catalog.ValidateToolConstraints != nil {
				if e = s.Catalog.ValidateToolConstraints(ctx, tx, *spec, b); e != nil {
					return e
				}
			} else if len(constraints) > 0 {
				return httpx.Invalid("items.parameter_constraints", "unsupported")
			}
			specs[item.ToolKey] = spec
		}
		v, e := s.bindingDefinition(r, id, "tool-bindings", tag)
		if e != nil {
			return e
		}
		rows := []ToolBinding{}
		for i, item := range w.Items {
			if v.Mode == "service" && item.Policy == "confirm" {
				return httpx.E(422, "SERVICE_APPROVAL_UNSUPPORTED", "服务型智能体只允许预授权工具")
			}
			spec := specs[item.ToolKey]
			constraints, e := objectJSON(item.Constraints, "items.parameter_constraints")
			if e != nil {
				return e
			}
			b, e := json.Marshal(constraints)
			if e != nil {
				return e
			}
			rows = append(rows, ToolBinding{AgentID: id, ToolKey: item.ToolKey, Policy: item.Policy, Constraints: b, Kind: spec.Source.Kind, Config: json.RawMessage(`{}`), SchemaVersion: 1, SortOrder: i})
		}
		old, e := r.ToolBindings(id, false)
		if e != nil {
			return e
		}
		if !same(toolWrites(old), toolWrites(rows)) {
			if e = r.SaveToolBindings(id, rows, time.Now().UTC().Truncate(time.Millisecond)); e != nil {
				return e
			}
			if e = s.saveBindingChange(ctx, tx, r, a, v, "tool-bindings"); e != nil {
				return e
			}
			rows, e = r.ToolBindings(id, false)
			if e != nil {
				return e
			}
		} else {
			rows = old
		}
		s.bindingResult(out, v, "tool-bindings", rows)
		return nil
	})
}
func toolWrites(rows []ToolBinding) []ToolBindingWrite {
	out := []ToolBindingWrite{}
	for _, row := range rows {
		out = append(out, ToolBindingWrite{row.ToolKey, row.Policy, row.Constraints})
	}
	return out
}
func (s *Service) validateEnabled(ctx context.Context, tx identity.Tx, r Repository, id uint64) error {
	v, e := r.Definition(id, false)
	if e != nil {
		return e
	}
	if e = s.definition(v); e != nil {
		return e
	}
	if v.DefaultModelBindingID == nil {
		return httpx.Invalid("enabled", "default_model_required")
	}
	if s.Models == nil {
		return unavailable()
	}
	bindings, e := r.ModelBindings(id, false)
	if e != nil {
		return e
	}
	if e = decodeModels(bindings); e != nil {
		return e
	}
	ids := []uint64{}
	for _, b := range bindings {
		ids = append(ids, b.ModelID)
	}
	views, e := s.Models.ReadRuntimeModels(tx, ids)
	if e != nil {
		return e
	}
	found := false
	tools, e := r.ToolBindings(id, false)
	if e != nil {
		return e
	}
	mcpBindings, e := r.MCPBindings(id, false)
	if e != nil {
		return e
	}
	needsTools := false
	for _, b := range mcpBindings {
		if b.Enabled {
			needsTools = true
		}
	}
	for _, b := range tools {
		if b.Policy != "deny" {
			needsTools = true
		}
		if v.Mode == "service" && b.Policy == "confirm" {
			return httpx.E(422, "SERVICE_APPROVAL_UNSUPPORTED", "服务型智能体不支持审批")
		}
	}
	for _, b := range bindings {
		view := views[b.ModelID]
		if !view.Available {
			return httpx.E(409, "MODEL_UNAVAILABLE", "绑定模型当前不可用")
		}
		if view.Capabilities.Text != "supported" || needsTools && view.Capabilities.Tools != "supported" {
			return httpx.E(422, "MODEL_CAPABILITY_UNSUPPORTED", "绑定模型缺少智能体需要的能力")
		}
		if _, e = s.validateModelBinding(view, modelWrites([]ModelBinding{b})[0]); e != nil {
			return e
		}
		found = found || b.ID == *v.DefaultModelBindingID
	}
	if !found {
		return httpx.Invalid("enabled", "default_model_required")
	}
	if len(tools) > 0 && s.Catalog.Tool == nil {
		return unavailable()
	}
	for _, b := range tools {
		spec, e := s.Catalog.Tool(ctx, tx, b.ToolKey)
		if e != nil {
			return e
		}
		if spec == nil || !slices.Contains(spec.SupportedPolicies, b.Policy) {
			return httpx.Invalid("enabled", "tool_unavailable")
		}
	}
	locked, e := r.Definition(id, true)
	if e != nil {
		return e
	}
	if locked == nil || locked.RowVersion != v.RowVersion {
		return httpx.E(412, "VERSION_CONFLICT", "配置已变化，请重新加载")
	}
	return nil
}
func (s *Service) ListToolCatalog(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, _ Repository, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		if s.Catalog.Tools == nil {
			return unavailable()
		}
		items, total, e := s.Catalog.Tools(ctx, tx, q)
		if e != nil {
			return e
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
