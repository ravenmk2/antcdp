package agents

import (
	"bytes"
	"context"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

type FrozenSkillSource struct{ Host *Service }

func (s FrozenSkillSource) Directory(ctx context.Context, x agentcore.ExecutionContext) (agentcore.SkillDirectory, error) {
	out := agentcore.SkillDirectory{Complete: true, Entries: []agentcore.SkillEntry{}}
	err := s.Host.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		current, err := s.Host.lockExecution(tx, r, st, x.Ref, true)
		if err != nil {
			return err
		}
		skills, err := frozenSkills(current.Context.Row)
		if err != nil {
			return err
		}
		for _, skill := range skills {
			out.Entries = append(out.Entries, agentcore.SkillEntry{Name: skill.Name, Description: skill.Description, Integrity: "verified", Path: skillPath(current.Context.Row.AgentID, skill.Name) + "/SKILL.md", VersionID: agentcore.ID(skill.VersionID)})
		}
		return nil
	})
	return out, err
}
func skillPath(agent uint64, name string) string {
	return "/data/agents/" + idString(agent) + "/skills/" + name
}

func (s FrozenSkillSource) Load(ctx context.Context, x agentcore.ExecutionContext, name, path string) (agentcore.SkillLoad, error) {
	if !skillpackage.ValidName(name) {
		return agentcore.SkillLoad{}, httpx.Invalid("name", "invalid_format")
	}
	if path == "" {
		path = "SKILL.md"
	}
	normalized, err := skillpackage.NormalizePath(path, false)
	if err != nil {
		return agentcore.SkillLoad{}, httpx.Invalid("path", "invalid_format")
	}
	var selected *SkillSnapshot
	var entry *skillpackage.Entry
	var file *FileRow
	err = s.Host.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		current, err := s.Host.lockExecution(tx, r, st, x.Ref, true)
		if err != nil {
			return err
		}
		skills, err := frozenSkills(current.Context.Row)
		if err != nil {
			return err
		}
		for i := range skills {
			if skills[i].Name == name {
				selected = &skills[i]
				break
			}
		}
		if selected == nil {
			return missing()
		}
		for i := range selected.Manifest.Entries {
			if selected.Manifest.Entries[i].Path == normalized {
				entry = &selected.Manifest.Entries[i]
				break
			}
		}
		if entry == nil {
			return missing()
		}
		file, err = st.File(selected.FileID, false)
		if err != nil {
			return err
		}
		if file == nil || file.State != "bound" || file.ContentDomain != "system_skill" || file.IntegrityState != "verified" || hexHash(file.SHA256) != selected.ArchiveSHA {
			return integrity()
		}
		return nil
	})
	if err != nil {
		return agentcore.SkillLoad{}, err
	}
	if entry.Size > 64<<10 || (!strings.HasPrefix(entry.MediaType, "text/") && entry.MediaType != "application/json") {
		return agentcore.SkillLoad{}, httpx.E(422, "SKILL_TEXT_LIMIT", "技能工具只支持读取不超过 64 KiB 的文本文件")
	}
	if s.Host.Files == nil {
		return agentcore.SkillLoad{}, unavailable()
	}
	reader, err := s.Host.Files.Open(file.StorageKey)
	if err != nil {
		return agentcore.SkillLoad{}, err
	}
	defer func() { _ = reader.Close() }()
	content, err := skillpackage.ReadArchive(ctx, reader, selected.ArchiveSHA, selected.Name, *entry, 64<<10)
	if err != nil {
		return agentcore.SkillLoad{}, httpx.E(409, "SKILL_INTEGRITY_FAILED", "技能文件完整性验证失败")
	}
	if !utf8.Valid(content) || bytes.ContainsRune(content, 0) {
		return agentcore.SkillLoad{}, httpx.E(422, "SKILL_TEXT_REQUIRED", "技能工具只支持文本文件")
	}
	return agentcore.SkillLoad{SkillID: agentcore.ID(selected.SkillID), VersionID: agentcore.ID(selected.VersionID), ContentSHA256: selected.ContentSHA, Text: string(content), StablePath: skillPath(uint64(x.AgentID), selected.Name), Materialized: x.Binding != nil && x.Binding.RuntimeGeneration != 0}, nil
}
