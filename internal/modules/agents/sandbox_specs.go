package agents

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/cloudcomputers"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/sandboxes"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type SandboxSpec sandboxes.Spec
type SpecWrite struct {
	Name string `json:"name"`
	CloudEnvironment
}
type BindingWrite struct {
	SpecID Field[string] `json:"spec_id"`
}
type SpecBinding struct {
	ID         uint64       `db:"id" json:"-"`
	AgentID    *uint64      `db:"agent_id" json:"agent_id,string"`
	SpecID     *uint64      `db:"spec_id" json:"spec_id,string"`
	RowVersion uint64       `db:"row_version" json:"-"`
	Spec       *SandboxSpec `json:"spec"`
	Version    string       `json:"version"`
}
type SpecReference struct {
	AgentID *uint64 `db:"agent_id" json:"agent_id,string"`
	Name    string  `db:"name" json:"name"`
}

func (v *SandboxSpec) snapshot() (cloudcomputers.Environment, error) {
	var policy sandboxcore.NetworkPolicy
	if json.Unmarshal(v.Network, &policy) != nil {
		return cloudcomputers.Environment{}, integrity()
	}
	network, err := sandboxcore.SnapshotPolicy(policy)
	if err != nil {
		return cloudcomputers.Environment{}, sandboxFailure(err)
	}
	return cloudcomputers.Environment{Image: v.Image, CPU: v.CPU, Memory: v.Memory, Network: network}, nil
}
func (s *CloudService) specTag(v *SandboxSpec) string {
	tag := s.Host.tag("sandbox-spec", v.ID, v.RowVersion)
	v.Version = strings.Trim(tag, "\"")
	return tag
}
func (s *CloudService) ListSpecs(ctx context.Context, raw string) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		rows, err := cr.SandboxSpecs()
		if err != nil {
			return err
		}
		for i := range rows {
			s.specTag(&rows[i])
		}
		out.Data = rows
		return nil
	})
}
func requireSpec(cr CloudRepository, id uint64, lock bool) (*SandboxSpec, error) {
	v, e := cr.SandboxSpec(id, lock)
	if e == nil && v == nil {
		return nil, missing()
	}
	return v, e
}
func (s *CloudService) GetSpec(ctx context.Context, raw string, id uint64, references bool) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		v, e := requireSpec(cr, id, false)
		if e != nil {
			return e
		}
		if references {
			out.Data, e = cr.SpecReferences(id)
			return e
		}
		out.Tag = s.specTag(v)
		out.Data = v
		return nil
	})
}
func (s *CloudService) SaveSpec(ctx context.Context, raw, tag, key string, id uint64, w SpecWrite) (*Result, error) {
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" || utf8.RuneCountInString(w.Name) > 128 {
		return nil, httpx.Invalid("name", "invalid_length")
	}
	if e := normalizeCloudEnvironment(&w.CloudEnvironment); e != nil {
		return nil, e
	}
	command, scope := "sandbox_spec.create", "sandbox_spec"
	if id != 0 {
		command, scope = "sandbox_spec.update", "sandbox_spec:"+idString(id)
	}
	return s.cloudCommand(ctx, raw, key, command, scope, w, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, out *Result, receipt *Receipt) error {
		network, e := json.Marshal(w.Network)
		if e != nil {
			return e
		}
		v := &SandboxSpec{Name: w.Name, Image: w.Image, CPU: w.CPU, Memory: w.Memory, Network: network, ConfigVersion: 1, RowVersion: 1}
		if id == 0 {
			if e = cr.InsertSandboxSpec(v, a.User.ID); e != nil {
				return e
			}
			out.Status = 201
		} else {
			old, e := requireSpec(cr, id, true)
			if e != nil {
				return e
			}
			if e = checkTag(tag, s.specTag(old)); e != nil {
				return e
			}
			var stored NetworkPolicy
			if json.Unmarshal(old.Network, &stored) != nil {
				return integrity()
			}
			runtimeChanged := old.Image != v.Image || old.CPU != v.CPU || old.Memory != v.Memory || !reflect.DeepEqual(stored, w.Network)
			v.ID, v.ConfigVersion, v.RowVersion = id, old.ConfigVersion, old.RowVersion
			if runtimeChanged {
				v.ConfigVersion++
			}
			if runtimeChanged || v.Name != old.Name {
				v.RowVersion++
				if e = cr.UpdateSandboxSpec(v, a.User.ID); e != nil {
					return e
				}
			}
		}
		receipt.TargetID = &v.ID
		out.Tag = s.specTag(v)
		out.Data = v
		return nil
	})
}
func (s *CloudService) DeleteSpec(ctx context.Context, raw, tag, key string, id uint64) (*Result, error) {
	return s.cloudCommand(ctx, raw, key, "sandbox_spec.delete", "sandbox_spec:"+idString(id), struct{}{}, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result, receipt *Receipt) error {
		v, e := requireSpec(cr, id, true)
		if e != nil {
			return e
		}
		if e = checkTag(tag, s.specTag(v)); e != nil {
			return e
		}
		refs, e := cr.SpecReferences(id)
		if e != nil {
			return e
		}
		if len(refs) > 0 {
			err := httpx.E(409, "RESOURCE_IN_USE", "请先解除此规格的引用")
			err.Details = []httpx.Detail{{Field: "spec_id", Code: "in_use", Context: map[string]any{"references": refs}}}
			return err
		}
		if e = cr.DeleteSandboxSpec(id); e != nil {
			return e
		}
		receipt.TargetID = &id
		out.Status = 204
		return nil
	})
}
func serviceDefinition(r Repository, agent *uint64, lock bool) (*Definition, error) {
	if agent == nil {
		return nil, nil
	}
	v, e := r.Definition(*agent, lock)
	if e != nil {
		return nil, e
	}
	if v == nil || v.DeletedAt != nil || v.Mode != "service" {
		return nil, missing()
	}
	return v, nil
}
func (s *CloudService) bindingResult(out *Result, b *SpecBinding) {
	out.Tag = s.Host.tag("cloud-spec-binding", b.ID, b.RowVersion)
	b.Version = strings.Trim(out.Tag, "\"")
	out.Data = b
}
func (s *CloudService) GetBinding(ctx context.Context, raw string, agent *uint64) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, r Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		if _, e := serviceDefinition(r, agent, false); e != nil {
			return e
		}
		b, e := cr.SpecBinding(agent, false)
		if e != nil {
			return e
		}
		if b == nil {
			return missing()
		}
		if b.SpecID != nil {
			b.Spec, e = requireSpec(cr, *b.SpecID, false)
			if e != nil {
				return e
			}
			s.specTag(b.Spec)
		}
		s.bindingResult(out, b)
		return nil
	})
}
func (s *CloudService) SaveBinding(ctx context.Context, raw, tag, key string, agent *uint64, w BindingWrite) (*Result, error) {
	if !w.SpecID.Set {
		return nil, httpx.Invalid("spec_id", "required")
	}
	var selection *uint64
	if !w.SpecID.Null {
		id, err := idValue(w.SpecID.Value, "spec_id")
		if err != nil {
			return nil, err
		}
		selection = &id
	}
	scope := "cloud_spec_binding"
	if agent != nil {
		scope += ":" + idString(*agent)
	}
	return s.cloudCommand(ctx, raw, key, "cloud_spec_binding.update", scope, w, func(_ identity.Tx, r Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, out *Result, _ *Receipt) error {
		definition, e := serviceDefinition(r, agent, true)
		if e != nil {
			return e
		}
		var spec *SandboxSpec
		if selection != nil {
			spec, e = requireSpec(cr, *selection, true)
			if e != nil {
				return e
			}
			s.specTag(spec)
		}
		b, e := cr.SpecBinding(agent, true)
		if e != nil {
			return e
		}
		if b == nil {
			return missing()
		}
		if e = checkTag(tag, s.Host.tag("cloud-spec-binding", b.ID, b.RowVersion)); e != nil {
			return e
		}
		if !reflect.DeepEqual(b.SpecID, selection) {
			b.SpecID = selection
			b.RowVersion++
			if e = cr.UpdateSpecBinding(b, a.User.ID); e != nil {
				return e
			}
			if definition != nil {
				definition.ConfigVersion++
				definition.RowVersion++
				definition.UpdatedAt = time.Now().UTC()
				if e = r.SaveDefinition(definition); e != nil {
					return e
				}
			}
		}
		b.Spec = spec
		s.bindingResult(out, b)
		return nil
	})
}
func insertServiceSpecBinding(tx identity.Tx, agent *Definition, spec *uint64) error {
	if agent.Mode != "service" {
		if spec != nil {
			return httpx.Invalid("sandbox_spec_id", "service_agent_required")
		}
		return nil
	}
	cr, e := CloudStateFor(tx)
	if e != nil {
		return e
	}
	if spec != nil {
		if _, e = requireSpec(cr, *spec, true); e != nil {
			return e
		}
	}
	return cr.InsertSpecBinding(&agent.ID, spec, agent.Creator)
}
