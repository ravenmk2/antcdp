package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

type SkillBinding struct {
	ID        uint64    `db:"id" json:"id,string"`
	AgentID   uint64    `db:"agent_id" json:"agent_id,string"`
	SkillID   uint64    `db:"skill_id" json:"skill_id,string"`
	VersionID uint64    `db:"skill_version_id" json:"skill_version_id,string"`
	Enabled   bool      `db:"enabled" json:"enabled"`
	SortOrder int       `db:"sort_order" json:"sort_order"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}
type SkillBindingWrite struct {
	SkillID   string `json:"skill_id"`
	VersionID string `json:"skill_version_id"`
	Enabled   bool   `json:"enabled"`
}
type SkillBindingsWrite struct {
	Items []SkillBindingWrite `json:"items"`
}

// SkillSnapshot is captured once for a root. It carries no user credentials or
// mutable latest-version pointer, and survives later catalog disablement.
type SkillSnapshot struct {
	SkillID     uint64                `json:"skill_id,string"`
	VersionID   uint64                `json:"skill_version_id,string"`
	FileID      uint64                `json:"file_id,string"`
	Name        string                `json:"name"`
	Description string                `json:"description"`
	ContentSHA  string                `json:"content_sha256"`
	ArchiveSHA  string                `json:"archive_sha256"`
	Manifest    skillpackage.Manifest `json:"manifest"`
	Available   bool                  `json:"available"`
}

func (s *Service) GetSkillBindings(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		v, err := s.bindingDefinition(r, id, "skill-bindings", "")
		if err != nil {
			return err
		}
		rows, err := r.SkillBindings(id)
		if err != nil {
			return err
		}
		s.bindingResult(out, v, "skill-bindings", rows)
		return nil
	})
}
func (s *Service) PutSkillBindings(ctx context.Context, raw string, id uint64, tag string, w SkillBindingsWrite) (*Result, error) {
	if len(w.Items) > 32 {
		return nil, httpx.Invalid("items", "too_many")
	}
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, actor *identity.Auth, out *Result) error {
		if tag == "" {
			return checkTag(tag, "")
		}
		v, err := s.bindingDefinition(r, id, "skill-bindings", tag)
		if err != nil {
			return err
		}
		rows := []SkillBinding{}
		seen := map[uint64]bool{}
		for i, item := range w.Items {
			skill, err := idValue(item.SkillID, "items.skill_id")
			if err != nil {
				return err
			}
			version, err := idValue(item.VersionID, "items.skill_version_id")
			if err != nil {
				return err
			}
			if seen[skill] {
				return httpx.Invalid("items.skill_id", "duplicate")
			}
			seen[skill] = true
			if s.Catalog.Skill == nil {
				return unavailable()
			}
			spec, err := s.Catalog.Skill(tx, skill, version)
			if err != nil {
				return err
			}
			if spec == nil {
				return httpx.Invalid("items.skill_version_id", "unavailable")
			}
			rows = append(rows, SkillBinding{AgentID: id, SkillID: skill, VersionID: version, Enabled: item.Enabled, SortOrder: i})
		}
		old, err := r.SkillBindings(id)
		if err != nil {
			return err
		}
		if !same(skillBindingWrites(old), skillBindingWrites(rows)) {
			if err = r.SaveSkillBindings(id, rows, time.Now().UTC().Truncate(time.Millisecond)); err != nil {
				return err
			}
			if err = s.saveBindingChange(ctx, tx, r, actor, v, "skill-bindings"); err != nil {
				return err
			}
			rows, err = r.SkillBindings(id)
			if err != nil {
				return err
			}
		} else {
			rows = old
		}
		s.bindingResult(out, v, "skill-bindings", rows)
		return nil
	})
}
func skillBindingWrites(rows []SkillBinding) []SkillBindingWrite {
	out := []SkillBindingWrite{}
	for _, row := range rows {
		out = append(out, SkillBindingWrite{idString(row.SkillID), idString(row.VersionID), row.Enabled})
	}
	return out
}
func (s *Service) freezeSkills(tx identity.Tx, r Repository, agent uint64) ([]SkillSnapshot, error) {
	bindings, err := r.SkillBindings(agent)
	if err != nil {
		return nil, err
	}
	out := []SkillSnapshot{}
	var total uint64
	fileCount := 0
	for _, b := range bindings {
		if !b.Enabled {
			continue
		}
		if s.Catalog.Skill == nil {
			return nil, unavailable()
		}
		v, err := s.Catalog.Skill(tx, b.SkillID, b.VersionID)
		if err != nil {
			return nil, err
		}
		if v == nil {
			return nil, httpx.E(409, "SKILL_VERSION_UNAVAILABLE", "绑定的技能版本不可用")
		}
		if !v.Available {
			continue
		}
		total += v.Manifest.TotalBytes
		fileCount += v.Manifest.FileCount
		if total > 256<<20 || fileCount > 10000 {
			return nil, httpx.E(422, "SKILL_SET_TOO_LARGE", "技能集合解压后不能超过 256 MiB")
		}
		out = append(out, *v)
	}
	return out, nil
}
func skillSetHash(skills []SkillSnapshot) (string, error) {
	// Include the immutable package identity; descriptions are also frozen.
	return agentcore.ContentHash(skills)
}
func frozenSkills(row *RunContextRow) ([]SkillSnapshot, error) {
	out := []SkillSnapshot{}
	if json.Unmarshal(row.SkillManifest, &out) != nil {
		return nil, integrity()
	}
	return out, nil
}
