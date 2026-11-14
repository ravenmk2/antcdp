package agentresources

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

func skillNames(title, description string) error {
	if strings.TrimSpace(title) == "" || !utf8.ValidString(title) || utf8.RuneCountInString(title) > 100 {
		return httpx.Invalid("title", "invalid_length")
	}
	if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 1024 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}

func (s *Service) skill(v *Skill) error {
	if v == nil {
		return missing()
	}
	if !skillpackage.ValidName(v.Name) {
		return integrity()
	}
	v.Version = strings.Trim(s.tag("skill", v.ID, v.RowVersion), `"`)
	return nil
}
func (s *Service) skillVersion(v *SkillVersion) error {
	if v == nil {
		return missing()
	}
	if v.SchemaVersion != 1 || len(v.ContentHash) != 32 || len(v.ArchiveHash) != 32 || json.Unmarshal(v.ManifestJSON, &v.Manifest) != nil || json.Unmarshal(v.FrontmatterJSON, &v.Frontmatter) != nil || !skillpackage.ValidName(v.Frontmatter.Name) || v.Manifest.FileCount != v.FileCount || v.Manifest.TotalBytes != v.ExpandedSize {
		return integrity()
	}
	manifest, e := json.Marshal(v.Manifest)
	if e != nil {
		return integrity()
	}
	hash := sha256.Sum256(manifest)
	if !bytes.Equal(hash[:], v.ContentHash) || len(v.Manifest.Entries) != v.Manifest.FileCount {
		return integrity()
	}
	v.ContentSHA = hex.EncodeToString(v.ContentHash)
	v.ArchiveSHA = hex.EncodeToString(v.ArchiveHash)
	v.Version = strings.Trim(s.tag("skill_version", v.ID, v.RowVersion), `"`)
	return nil
}
func (s *Service) ListSkills(ctx context.Context, raw string, q Query) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		rows, total, e := r.Skills(q)
		if e != nil {
			return e
		}
		items := []SkillSummary{}
		for i := range rows {
			v := &rows[i]
			if e = s.skill(v); e != nil {
				return e
			}
			items = append(items, SkillSummary{*v, v.LatestVersionID, v.LatestVersionLabel})
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetSkill(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.Skill(id, false)
		if e != nil {
			return e
		}
		if e = s.skill(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("skill", id, v.RowVersion)
		return nil
	})
}
func (s *Service) CreateSkill(ctx context.Context, raw, key string, input SkillCreate) (*Result, error) {
	return s.command(ctx, raw, key, "skill.create", "skills", input, func(tx identity.Tx, a *identity.Auth, out *Result, _ uint64) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		if !skillpackage.ValidName(input.Name) {
			return httpx.Invalid("name", "invalid_format")
		}
		input.Title = strings.TrimSpace(input.Title)
		if e = skillNames(input.Title, input.Description); e != nil {
			return e
		}
		if input.Enabled.Null {
			return httpx.Invalid("enabled", "null_not_allowed")
		}
		v := &Skill{Name: input.Name, Title: input.Title, Description: input.Description, Enabled: true, RowVersion: 1, Creator: a.User.ID}
		if input.Enabled.Set {
			v.Enabled = input.Enabled.Value
		}
		if e = r.InsertSkill(v); e != nil {
			return e
		}
		if e = s.skill(v); e != nil {
			return e
		}
		out.Data = v
		out.Status = 201
		out.Tag = s.tag("skill", v.ID, v.RowVersion)
		out.Location = fmt.Sprintf("/api/v1/admin/agents/skills/%d", v.ID)
		out.TargetKind = "skill"
		out.TargetID = v.ID
		return nil
	})
}
func (s *Service) PatchSkill(ctx context.Context, raw string, id uint64, tag string, input SkillPatch) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.Skill(id, true)
		if e != nil {
			return e
		}
		if e = s.skill(v); e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("skill", id, v.RowVersion)); e != nil {
			return e
		}
		if !input.Title.Set && !input.Description.Set && !input.Enabled.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		if input.Title.Null || input.Description.Null || input.Enabled.Null {
			return httpx.Invalid("body", "null_not_allowed")
		}
		old := *v
		if input.Title.Set {
			v.Title = strings.TrimSpace(input.Title.Value)
		}
		if input.Description.Set {
			v.Description = input.Description.Value
		}
		if input.Enabled.Set {
			v.Enabled = input.Enabled.Value
		}
		if e = skillNames(v.Title, v.Description); e != nil {
			return e
		}
		if old.Title != v.Title || old.Description != v.Description || old.Enabled != v.Enabled {
			v.RowVersion++
			if e = r.SaveSkill(v); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "skill.update", "skill", id); e != nil {
				return e
			}
		}
		if e = s.skill(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("skill", id, v.RowVersion)
		return nil
	})
}
func (s *Service) DeleteSkill(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.command(ctx, raw, key, "skill.delete", fmt.Sprintf("skill:%d", id), struct{}{}, func(tx identity.Tx, _ *identity.Auth, out *Result, _ uint64) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.Skill(id, true)
		if e != nil {
			return e
		}
		if e = s.skill(v); e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("skill", id, v.RowVersion)); e != nil {
			return e
		}
		used, e := r.SkillReferenced(id)
		if e != nil {
			return e
		}
		if used {
			return inUse()
		}
		if e = r.DeleteSkill(id); e != nil {
			return e
		}
		out.Status = 204
		out.Data = nil
		return nil
	})
}
func (s *Service) ListSkillVersions(ctx context.Context, raw string, id uint64, q Query) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.Skill(id, false)
		if e != nil {
			return e
		}
		if e = s.skill(v); e != nil {
			return e
		}
		rows, total, e := r.SkillVersions(id, q)
		if e != nil {
			return e
		}
		items := []SkillVersionSummary{}
		for i := range rows {
			v := &rows[i]
			if e = s.skillVersion(v); e != nil {
				return e
			}
			items = append(items, SkillVersionSummary{v.ID, v.SkillID, v.Label, v.ChangeNote, v.ContentSHA, v.State, v.Version, v.Creator, v.CreatedAt, v.DeletedAt})
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetSkillVersion(ctx context.Context, raw string, skillID, versionID uint64) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.SkillVersion(versionID, false)
		if e != nil {
			return e
		}
		if v == nil || v.SkillID != skillID {
			return missing()
		}
		if e = s.skillVersion(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("skill_version", versionID, v.RowVersion)
		return nil
	})
}
func (s *Service) ListSkillEntries(ctx context.Context, raw string, skillID, versionID uint64, directory string, q Query) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		if e := validateQuery(&q); e != nil {
			return e
		}
		directory, e := skillpackage.NormalizePath(directory, true)
		if e != nil {
			return httpx.Invalid("path", "invalid_format")
		}
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.SkillVersion(versionID, false)
		if e != nil {
			return e
		}
		if v == nil || v.SkillID != skillID {
			return missing()
		}
		if e = s.skillVersion(v); e != nil {
			return e
		}
		prefix := ""
		if directory != "" {
			prefix = directory + "/"
		}
		byPath := map[string]SkillEntry{}
		for _, entry := range v.Manifest.Entries {
			if !strings.HasPrefix(entry.Path, prefix) {
				continue
			}
			rest := strings.TrimPrefix(entry.Path, prefix)
			name, _, hasChild := strings.Cut(rest, "/")
			if hasChild {
				p := prefix + name
				byPath[p] = SkillEntry{Path: p, Kind: "directory"}
			} else {
				item := entry
				byPath[item.Path] = SkillEntry{Path: item.Path, Kind: "file", Size: &item.Size, SHA256: &item.SHA256, MediaType: &item.MediaType}
			}
		}
		if directory != "" && len(byPath) == 0 {
			return missing()
		}
		items := []SkillEntry{}
		for _, entry := range byPath {
			items = append(items, entry)
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].Kind != items[j].Kind {
				return items[i].Kind == "directory"
			}
			return items[i].Path < items[j].Path
		})
		total := len(items)
		start := min((q.Page-1)*q.PageSize, total)
		end := min(start+q.PageSize, total)
		out.Data = items[start:end]
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) DeleteSkillVersion(ctx context.Context, raw string, skillID, versionID uint64, tag, key string) (*Result, error) {
	return s.command(ctx, raw, key, "skill_version.delete", fmt.Sprintf("skill_version:%d", versionID), struct {
		SkillID uint64 `json:"skill_id,string"`
	}{skillID}, func(tx identity.Tx, a *identity.Auth, out *Result, _ uint64) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		skill, e := r.Skill(skillID, true)
		if e != nil {
			return e
		}
		if e = s.skill(skill); e != nil {
			return e
		}
		v, e := r.SkillVersion(versionID, true)
		if e != nil {
			return e
		}
		if v == nil || v.SkillID != skillID {
			return missing()
		}
		if e = s.skillVersion(v); e != nil {
			return e
		}
		if e = checkTag(tag, s.tag("skill_version", versionID, v.RowVersion)); e != nil {
			return e
		}
		used, e := r.VersionReferenced(versionID, v.ArchiveFileID)
		if e != nil {
			return e
		}
		if used {
			return inUse()
		}
		if v.State != "deleted" {
			now := time.Now().UTC()
			v.State = "deleted"
			v.DeletedAt = &now
			v.DeletedBy = &a.User.ID
			v.RowVersion++
			v.ReportJSON = json.RawMessage(`{"cleanup_state":"pending"}`)
			if e = r.SaveSkillVersion(v); e != nil {
				return e
			}
			skill.RowVersion++
			if e = r.SaveSkill(skill); e != nil {
				return e
			}
		}
		out.Status = 204
		out.Data = nil
		out.TargetKind = "skill_version"
		out.TargetID = versionID
		return nil
	})
}
