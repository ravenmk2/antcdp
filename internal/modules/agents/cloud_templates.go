package agents

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func (s *CloudService) NetworkPresets(ctx context.Context, raw string) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, _ CloudRepository, _ *identity.Auth, out *Result) error {
		out.Data = map[string]any{"items": sandboxcore.Presets(), "catalog_version": sandboxcore.PresetCatalogVersion()}
		return nil
	})
}

func normalizeCloudEnvironment(w *CloudEnvironment, allowUnconfigured bool) error {
	w.Image = strings.TrimSpace(w.Image)
	image := w.Image
	if (!allowUnconfigured || image != "") && (image == "" || len(image) > 512 || strings.ContainsAny(image, " \t\n\r\x00") || strings.HasSuffix(image, ":latest") || !strings.Contains(image, "@sha256:") && !strings.Contains(image[strings.LastIndex(image, "/")+1:], ":")) {
		return httpx.Invalid("environment.image", "fixed_version_required")
	}
	if w.CPU == 0 {
		w.CPU = 2000
	}
	if w.Memory == 0 {
		w.Memory = 4096
	}
	if w.CPU < 100 || w.CPU > 32000 || w.Memory < 128 || w.Memory > 65536 {
		return httpx.Invalid("environment", "invalid_resources")
	}
	network, e := sandboxcore.NormalizePolicy(sandboxcore.NetworkPolicy(w.Network))
	if e != nil {
		return sandboxFailure(e)
	}
	w.Network = NetworkPolicy(network)
	return nil
}
func cloudTemplateEnvironment(v *CloudTemplateRow) (CloudEnvironment, error) {
	var w CloudEnvironment
	if v == nil || v.SchemaVersion != 1 || json.Unmarshal(v.Environment, &w) != nil {
		return w, integrity()
	}
	return w, normalizeCloudEnvironment(&w, true)
}
func (s *CloudService) templateView(v *CloudTemplateRow) (CloudTemplateView, error) {
	env, e := cloudTemplateEnvironment(v)
	return CloudTemplateView{AgentID: v.AgentID, Environment: env, ConfigVersion: v.ConfigVersion, Version: strings.Trim(s.Host.tag("cloud-template", v.ID, v.RowVersion), `"`)}, e
}
func (s *CloudService) GetCloudTemplate(ctx context.Context, raw string, agentID *uint64) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, r Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		if agentID != nil {
			v, e := r.Definition(*agentID, false)
			if e != nil {
				return e
			}
			if v == nil || v.DeletedAt != nil || v.Mode != "service" {
				return missing()
			}
		}
		v, e := cr.CloudTemplate(agentID, false)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		out.Tag = s.Host.tag("cloud-template", v.ID, v.RowVersion)
		out.Data, e = s.templateView(v)
		return e
	})
}
func (s *CloudService) SaveCloudTemplate(ctx context.Context, raw, tag, key string, agentID *uint64, w CloudEnvironment) (*Result, error) {
	if e := normalizeCloudEnvironment(&w, false); e != nil {
		return nil, e
	}
	scope := "cloud_template"
	if agentID != nil {
		scope += ":" + idString(*agentID)
	}
	return s.cloudCommand(ctx, raw, key, "cloud_template.update", scope, w, func(_ identity.Tx, r Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, out *Result, _ *Receipt) error {
		var agent *Definition
		if agentID != nil {
			var e error
			agent, e = r.Definition(*agentID, true)
			if e != nil {
				return e
			}
			if agent == nil || agent.DeletedAt != nil || agent.Mode != "service" {
				return missing()
			}
		}
		v, e := cr.CloudTemplate(agentID, true)
		if e != nil {
			return e
		}
		if v == nil {
			return integrity()
		}
		if e = checkTag(tag, s.Host.tag("cloud-template", v.ID, v.RowVersion)); e != nil {
			return e
		}
		v.Environment, e = json.Marshal(w)
		if e != nil {
			return e
		}
		v.ConfigVersion++
		v.RowVersion++
		v.UpdatedByUserID = &a.User.ID
		v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
		if e = cr.SaveCloudTemplate(v); e != nil {
			return e
		}
		if agent != nil {
			agent.ConfigVersion++
			agent.RowVersion++
			agent.UpdatedAt = v.UpdatedAt
			if e = r.SaveDefinition(agent); e != nil {
				return e
			}
		}
		out.Tag = s.Host.tag("cloud-template", v.ID, v.RowVersion)
		out.Data, e = s.templateView(v)
		return e
	})
}

func insertServiceCloudTemplate(tx identity.Tx, agent *Definition, environment *CloudEnvironment) error {
	if agent.Mode != "service" {
		if environment != nil {
			return httpx.Invalid("cloud_environment", "service_agent_required")
		}
		return nil
	}
	cr, e := CloudStateFor(tx)
	if e != nil {
		return e
	}
	w := CloudEnvironment{CPU: 2000, Memory: 4096, Network: NetworkPolicy(sandboxcore.DefaultPolicy())}
	if environment != nil {
		w = *environment
	}
	if e = normalizeCloudEnvironment(&w, true); e != nil {
		return e
	}
	b, e := json.Marshal(w)
	if e != nil {
		return e
	}
	return cr.InsertCloudTemplate(&CloudTemplateRow{AgentID: &agent.ID, Environment: b, SchemaVersion: 1, ConfigVersion: 1, RowVersion: 1, UpdatedByUserID: &agent.Creator, CreatedAt: agent.CreatedAt, UpdatedAt: agent.CreatedAt})
}
