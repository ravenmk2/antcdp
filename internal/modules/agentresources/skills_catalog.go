package agentresources

import (
	"encoding/hex"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func (s *Service) ReadSkillSnapshot(tx identity.Tx, skillID, versionID uint64) (*agents.SkillSnapshot, error) {
	r, err := skillsRepository(tx)
	if err != nil {
		return nil, err
	}
	skill, err := r.Skill(skillID, true)
	if err != nil || skill == nil {
		return nil, err
	}
	version, err := r.SkillVersion(versionID, true)
	if err != nil {
		return nil, err
	}
	if version == nil || version.SkillID != skillID || version.State != "ready" {
		return nil, nil
	}
	if err = s.skillVersion(version); err != nil {
		return nil, err
	}
	return &agents.SkillSnapshot{SkillID: skillID, VersionID: version.ID, FileID: version.ArchiveFileID, Name: skill.Name, Description: version.Frontmatter.Description, ContentSHA: hex.EncodeToString(version.ContentHash), ArchiveSHA: hex.EncodeToString(version.ArchiveHash), Manifest: version.Manifest, Available: skill.Enabled}, nil
}
