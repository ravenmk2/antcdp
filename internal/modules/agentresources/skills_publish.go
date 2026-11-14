package agentresources

import (
	"context"
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

func (s *Service) commandReplay(ctx context.Context, raw, key, command, scope string, input any) (*Result, bool, error) {
	found := false
	out, e := s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		if !keyPattern.MatchString(key) {
			return httpx.Invalid("Idempotency-Key", "invalid_format")
		}
		r, e := agents.RepositoryFor(tx)
		if e != nil {
			return e
		}
		kind, id := splitScope(scope)
		v, e := r.Receipt(strconv.FormatUint(a.User.ID, 10), kind, id, command, key)
		if e != nil || v == nil {
			return e
		}
		hash, e := s.requestHash(input)
		if e != nil {
			return e
		}
		if !hmac.Equal(v.Hash, hash) {
			return httpx.E(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求")
		}
		var saved savedResult
		if json.Unmarshal(v.Result, &saved) != nil {
			return integrity()
		}
		out.Data = saved.Data
		out.Tag = saved.Tag
		out.Location = saved.Location
		out.Status = v.ResponseStatus
		out.Replayed = true
		found = true
		return nil
	})
	return out, found, e
}
func validateSkillPublish(input SkillPublish) error {
	if len(input.Label) < 1 || len(input.Label) > 64 {
		return httpx.Invalid("version_label", "invalid_length")
	}
	for _, r := range input.Label {
		if r < 33 || r > 126 {
			return httpx.Invalid("version_label", "invalid_format")
		}
	}
	if !utf8.ValidString(input.ChangeNote) || utf8.RuneCountInString(input.ChangeNote) > 2000 {
		return httpx.Invalid("change_note", "invalid_length")
	}
	return nil
}
func checkPublishUpload(op *agents.PublicOperationRow, actor, skillID uint64, name string) (SkillValidation, error) {
	var report SkillValidation
	if op == nil || op.Kind != "skill_validate" || op.ContentDomain != "management" || op.ActorUserID != actor {
		return report, missing()
	}
	if op.PublishedSkillVersionID != nil {
		return report, inUse()
	}
	if op.ExpiresAt == nil || !time.Now().Before(*op.ExpiresAt) {
		return report, httpx.E(409, "SKILL_UPLOAD_EXPIRED", "技能暂存包已过期")
	}
	if op.Status != "succeeded" || op.StagedFileID == nil {
		return report, httpx.E(409, "SKILL_UPLOAD_NOT_READY", "技能包尚未通过校验")
	}
	if op.SubjectKind == "skill" && (op.SubjectID == nil || *op.SubjectID != skillID) {
		return report, missing()
	}
	if json.Unmarshal(op.Result, &report) != nil || report.Name == nil || report.Frontmatter == nil || report.Manifest == nil || report.ContentSHA == nil {
		return report, integrity()
	}
	if *report.Name != name || report.Frontmatter.Name != name {
		return report, httpx.E(422, "SKILL_NAME_MISMATCH", "技能包名称与目标技能不一致")
	}
	return report, nil
}
func (s *Service) PublishSkill(ctx context.Context, raw string, skillID uint64, tag, key string, input SkillPublish) (*Result, error) {
	return s.publishSkill(ctx, raw, skillID, tag, key, input, nil)
}

func (s *Service) CreateSkillFromUpload(ctx context.Context, raw, key string, input SkillCreateFromUpload) (*Result, error) {
	if input.Label == "" {
		input.Label = "0.1.0"
	}
	return s.publishSkill(ctx, raw, 0, "", key, SkillPublish{UploadID: input.UploadID, Label: input.Label, ChangeNote: input.ChangeNote}, &input)
}

func (s *Service) publicationTarget(tx identity.Tx, actor uint64, skillID uint64, tag string, uploadID uint64, create *SkillCreateFromUpload) (*Skill, error) {
	r, err := skillsRepository(tx)
	if err != nil {
		return nil, err
	}
	if create == nil {
		skill, err := r.Skill(skillID, true)
		if err != nil {
			return nil, err
		}
		if err = s.skill(skill); err != nil {
			return nil, err
		}
		if err = checkTag(tag, s.tag("skill", skillID, skill.RowVersion)); err != nil {
			return nil, err
		}
		return skill, nil
	}
	state, err := agents.StateFor(tx)
	if err != nil {
		return nil, err
	}
	op, err := state.PublicOperation(uploadID, true)
	if err != nil {
		return nil, err
	}
	if op == nil || op.Kind != "skill_validate" || op.ActorUserID != actor || op.SubjectKind == "skill" {
		return nil, missing()
	}
	var report SkillValidation
	if json.Unmarshal(op.Result, &report) != nil || report.Frontmatter == nil {
		return nil, httpx.E(409, "SKILL_UPLOAD_NOT_READY", "技能包尚未通过校验")
	}
	if _, err = checkPublishUpload(op, actor, 0, report.Frontmatter.Name); err != nil {
		return nil, err
	}
	skill := &Skill{Name: report.Frontmatter.Name, Title: report.Frontmatter.Name, Description: report.Frontmatter.Description, Enabled: true, RowVersion: 1, Creator: actor}
	if create.Title != nil {
		skill.Title = strings.TrimSpace(*create.Title)
	}
	if create.Description != nil {
		skill.Description = *create.Description
	}
	if err = skillNames(skill.Title, skill.Description); err != nil {
		return nil, err
	}
	return skill, nil
}

func (s *Service) publishSkill(ctx context.Context, raw string, skillID uint64, tag, key string, input SkillPublish, create *SkillCreateFromUpload) (*Result, error) {
	scope := fmt.Sprintf("skill:%d", skillID)
	command := "skill_version.publish"
	var request any = input
	if create != nil {
		scope, command, request = "skills", "skill.create_from_upload", *create
	}
	if result, found, e := s.commandReplay(ctx, raw, key, command, scope, request); e != nil || found {
		return result, e
	}
	if s.Files == nil {
		return nil, unavailable()
	}
	if e := validateSkillPublish(input); e != nil {
		return nil, e
	}
	uploadID, e := validID(input.UploadID)
	if e != nil {
		return nil, e
	}
	var file *agents.FileRow
	var upload *agents.PublicOperationRow
	var lease *agents.ResourceReferenceRow
	var report SkillValidation
	_, e = s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, _ *Result) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		skill, e := s.publicationTarget(tx, a.User.ID, skillID, tag, uploadID, create)
		if e != nil {
			return e
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		upload, e = state.PublicOperation(uploadID, true)
		if e != nil {
			return e
		}
		report, e = checkPublishUpload(upload, a.User.ID, skillID, skill.Name)
		if e != nil {
			return e
		}
		busy, e := r.UploadBeingPublished(uploadID)
		if e != nil {
			return e
		}
		if busy {
			return httpx.E(409, "OPERATION_IN_PROGRESS", "技能包正在发布")
		}
		file, e = state.File(*upload.StagedFileID, true)
		if e != nil {
			return e
		}
		if file == nil || file.State != "staged" || file.IntegrityState != "verified" {
			return integrity()
		}
		lease, e = s.newSkillLease(state, "file", file.ID, "skill_publish")
		return e
	})
	if e != nil {
		return nil, e
	}
	defer func() { _ = s.releaseSkillLease(ctx, lease.ID) }()
	ioCtx, cancel := context.WithTimeout(ctx, skillpackage.ParseTimeout)
	defer cancel()
	pkg, e := s.validateSkillBytes(ioCtx, file, upload)
	if e != nil {
		return nil, httpx.E(409, "SKILL_INTEGRITY_FAILED", "技能包完整性验证失败")
	}
	if pkg.ContentSHA256 != *report.ContentSHA || !same(pkg.Manifest, *report.Manifest) {
		return nil, integrity()
	}
	result, e := s.command(ctx, raw, key, command, scope, request, func(tx identity.Tx, a *identity.Auth, out *Result, _ uint64) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		skill, e := s.publicationTarget(tx, a.User.ID, skillID, tag, uploadID, create)
		if e != nil {
			return e
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(uploadID, true)
		if e != nil {
			return e
		}
		currentReport, e := checkPublishUpload(op, a.User.ID, skillID, skill.Name)
		if e != nil {
			return e
		}
		if op.FenceVersion != upload.FenceVersion || *currentReport.ContentSHA != pkg.ContentSHA256 {
			return integrity()
		}
		current, e := state.File(file.ID, true)
		if e != nil {
			return e
		}
		if current == nil || current.State != "staged" || current.UploadOperationID == nil || *current.UploadOperationID != uploadID {
			return integrity()
		}
		held, e := state.ResourceReference(lease.ID, true)
		if e != nil {
			return e
		}
		if held == nil || held.State != "active" || held.ExecutorEpoch != s.Epoch {
			return integrity()
		}
		if create != nil {
			if e = r.InsertSkill(skill); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "skill.create", "skill", skill.ID); e != nil {
				return e
			}
		}
		targetID := skill.ID
		manifest, e := json.Marshal(pkg.Manifest)
		if e != nil {
			return e
		}
		frontmatter, e := json.Marshal(pkg.Frontmatter)
		if e != nil {
			return e
		}
		contentHash, e := hex.DecodeString(pkg.ContentSHA256)
		if e != nil {
			return e
		}
		archiveHash, e := hex.DecodeString(pkg.ArchiveSHA256)
		if e != nil {
			return e
		}
		version := &SkillVersion{SkillID: targetID, Label: input.Label, ChangeNote: input.ChangeNote, State: "ready", UploadOperationID: uploadID, ArchiveFileID: file.ID, ArchiveHash: archiveHash, ContentHash: contentHash, ExpandedSize: pkg.Manifest.TotalBytes, FileCount: pkg.Manifest.FileCount, SchemaVersion: 1, ManifestJSON: manifest, FrontmatterJSON: frontmatter, ReportJSON: json.RawMessage(`{"validation_status":"passed"}`), RowVersion: 1, Creator: a.User.ID}
		if e = r.InsertSkillVersion(version); e != nil {
			return e
		}
		now := time.Now().UTC()
		op.PublishedSkillVersionID = &version.ID
		op.SubjectKind = "skill"
		op.SubjectID = &targetID
		op.UpdatedAt = now
		if e = state.SavePublicOperation(op); e != nil {
			return e
		}
		current.State = "bound"
		current.BoundAt = &now
		current.ExpiresAt = nil
		current.UpdatedAt = now
		if e = state.SaveFile(current); e != nil {
			return e
		}
		skill.RowVersion++
		if e = r.SaveSkill(skill); e != nil {
			return e
		}
		if e = s.skillVersion(version); e != nil {
			return e
		}
		out.Data = version
		out.Status = 201
		out.Location = fmt.Sprintf("/api/v1/admin/agents/skills/%d/versions/%d", targetID, version.ID)
		out.Tag = s.tag("skill_version", version.ID, version.RowVersion)
		out.TargetKind = "skill_version"
		out.TargetID = version.ID
		return nil
	})
	return result, e
}
