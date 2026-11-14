package agentresources

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

func validFilename(name string) bool {
	if name == "" || len(name) > 255 || !utf8.ValidString(name) || strings.ContainsAny(name, "/\\") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func (s *Service) newSkillLease(state agents.StateRepository, kind string, id uint64, holder string) (*agents.ResourceReferenceRow, error) {
	if s.Epoch == "" {
		return nil, unavailable()
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	v := &agents.ResourceReferenceRow{HolderKind: holder, HolderID: cryptox.ID(), ResourceKind: kind, ResourceID: id, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now, LastVerifiedAt: &now, ReleaseEvidence: json.RawMessage(`{}`)}
	if e := state.InsertResourceReference(v); e != nil {
		return nil, e
	}
	return v, nil
}
func (s *Service) releaseSkillLease(ctx context.Context, id uint64) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	err := s.background(ctx, func(tx identity.Tx) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		v, e := state.ResourceReference(id, true)
		if e != nil {
			return e
		}
		if v == nil || v.State == "released" {
			return nil
		}
		if v.ExecutorEpoch != s.Epoch {
			return integrity()
		}
		now := time.Now().UTC()
		reason := "LOCAL_IO_FINISHED"
		v.State = "released"
		v.ReleasedAt = &now
		v.LastVerifiedAt = &now
		v.UpdatedAt = now
		v.ReleaseReason = &reason
		v.ReleaseEvidence = json.RawMessage(`{"local_reader_closed":true}`)
		return state.SaveResourceReference(v)
	})
	s.skillReleaseMu.Lock()
	if err != nil {
		if s.pendingSkillReleases == nil {
			s.pendingSkillReleases = map[uint64]struct{}{}
		}
		s.pendingSkillReleases[id] = struct{}{}
	} else {
		delete(s.pendingSkillReleases, id)
	}
	s.skillReleaseMu.Unlock()
	return err

}
func (s *Service) orphanUpload(ctx context.Context, id uint64) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = s.background(ctx, func(tx identity.Tx) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		file, e := state.File(id, true)
		if e != nil {
			return e
		}
		if file == nil || file.UploadOperationID != nil || file.State != "uploading" {
			return nil
		}
		now := time.Now().UTC()
		file.State = "orphaned"
		file.OrphanedAt = &now
		file.ExpiresAt = &now
		file.UpdatedAt = now
		return state.SaveFile(file)
	})
}

type countingReader struct {
	reader io.Reader
	count  int64
}

func (r *countingReader) Read(b []byte) (int, error) {
	n, e := r.reader.Read(b)
	r.count += int64(n)
	return n, e
}

// UploadSkill registers an owned temporary file before IO. The command hash is
// based on measured bytes; replaying an upload still verifies the incoming body.
func (s *Service) UploadSkill(ctx context.Context, raw, key, filename, skillID string, source io.Reader) (*Result, error) {
	if s.Files == nil || source == nil {
		return nil, unavailable()
	}
	if !keyPattern.MatchString(key) {
		return nil, httpx.Invalid("Idempotency-Key", "invalid_format")
	}
	if !validFilename(filename) {
		return nil, httpx.Invalid("file", "invalid_filename")
	}
	var file *agents.FileRow
	var selectedID *uint64
	var expected *string
	_, e := s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, _ *Result) error {
		if skillID != "" {
			id, e := validID(skillID)
			if e != nil {
				return e
			}
			r, e := skillsRepository(tx)
			if e != nil {
				return e
			}
			skill, e := r.Skill(id, false)
			if e != nil {
				return e
			}
			if e = s.skill(skill); e != nil {
				return e
			}
			selectedID = &id
			name := skill.Name
			expected = &name
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		now := time.Now().UTC()
		expiry := now.Add(24 * time.Hour)
		file = &agents.FileRow{Purpose: "skill_archive", ContentDomain: "system_skill", StorageKey: agents.NewStorageKey(), WriterToken: cryptox.ID(), State: "uploading", IntegrityState: "unchecked", MediaType: "application/zip", MediaProperties: json.RawMessage(`{}`), UploadedByUserID: &a.User.ID, CreatedAt: now, UpdatedAt: now, ExpiresAt: &expiry}
		return state.InsertFile(file)
	})
	if e != nil {
		return nil, e
	}
	input := &countingReader{reader: source}
	facts, e := s.Files.Write(ctx, file.StorageKey, input, skillpackage.MaxArchiveBytes)
	if e != nil {
		s.orphanUpload(ctx, file.ID)
		if input.count > skillpackage.MaxArchiveBytes {
			return nil, httpx.E(413, "PAYLOAD_TOO_LARGE", "技能压缩包过大")
		}
		return nil, httpx.E(503, "SKILL_UPLOAD_FAILED", "技能压缩包暂存失败")
	}
	request := struct {
		SkillID  *uint64 `json:"skill_id,string"`
		Filename string  `json:"filename"`
		Size     uint64  `json:"size_bytes,string"`
		Hash     string  `json:"sha256"`
	}{selectedID, filename, facts.Size, hex.EncodeToString(facts.SHA256)}
	result, e := s.command(ctx, raw, key, "skill_upload.create", "skill_uploads", request, func(tx identity.Tx, a *identity.Auth, out *Result, receiptID uint64) error {
		if selectedID != nil {
			r, e := skillsRepository(tx)
			if e != nil {
				return e
			}
			v, e := r.Skill(*selectedID, true)
			if e != nil {
				return e
			}
			if e = s.skill(v); e != nil {
				return e
			}
			if expected == nil || v.Name != *expected {
				return integrity()
			}
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		current, e := state.File(file.ID, true)
		if e != nil {
			return e
		}
		if current == nil || current.State != "uploading" || current.UploadedByUserID == nil || *current.UploadedByUserID != a.User.ID {
			return integrity()
		}
		now := time.Now().UTC()
		expiry := now.Add(24 * time.Hour)
		snapshot, e := json.Marshal(SkillUploadSnapshot{filename, facts.Size, request.Hash, expected})
		if e != nil {
			return e
		}
		kind := "skill"
		if selectedID == nil {
			kind = "skill_upload"
		}
		op := &agents.PublicOperationRow{CommandReceiptID: receiptID, Kind: "skill_validate", SubjectKind: kind, SubjectID: selectedID, ContentDomain: "management", OwnerUserID: &a.User.ID, Status: "queued", ConfigSnapshot: snapshot, Result: json.RawMessage(`null`), StagedFileID: &file.ID, ActorUserID: a.User.ID, FenceVersion: 1, CreatedAt: now, UpdatedAt: now, DeadlineAt: now.Add(skillpackage.ParseTimeout), ExpiresAt: &expiry}
		if e = state.InsertPublicOperation(op); e != nil {
			return e
		}
		if selectedID == nil {
			op.SubjectID = &op.ID
			if e = state.SavePublicOperation(op); e != nil {
				return e
			}
		}
		current.State = "staged"
		current.IntegrityState = "verified"
		current.IntegrityCheckedAt = &now
		current.SizeBytes = &facts.Size
		current.SHA256 = facts.SHA256
		current.UploadOperationID = &op.ID
		current.UpdatedAt = now
		current.ExpiresAt = &expiry
		if e = state.SaveFile(current); e != nil {
			return e
		}
		out.Data = skillOperationData(op, nil)
		out.Status = 202
		out.Location = fmt.Sprintf("/api/v1/admin/agents/operations/%d", op.ID)
		out.OperationID = &op.ID
		out.TargetKind = "skill_upload"
		out.TargetID = op.ID
		return nil
	})
	if e != nil || result.Replayed {
		s.orphanUpload(ctx, file.ID)
	}
	return result, e
}
func skillUploadView(op *agents.PublicOperationRow) (SkillUpload, error) {
	var snapshot SkillUploadSnapshot
	if json.Unmarshal(op.ConfigSnapshot, &snapshot) != nil {
		return SkillUpload{}, integrity()
	}
	v := SkillUpload{OperationID: op.ID, UploadedBy: op.ActorUserID, Filename: snapshot.Filename, Size: snapshot.Size, ExpiresAt: op.ExpiresAt, Status: op.Status, Issues: []skillpackage.Issue{}, PublishedID: op.PublishedSkillVersionID}
	if op.SubjectKind == "skill" {
		v.SkillID = op.SubjectID
	}
	switch op.Status {
	case "succeeded":
		v.Status = "passed"
	case "queued", "running":
	default:
		v.Status = "failed"
	}
	if len(op.Result) > 0 && string(op.Result) != "null" {
		var validation SkillValidation
		if json.Unmarshal(op.Result, &validation) != nil {
			return v, integrity()
		}
		v.Name = validation.Name
		v.Frontmatter = validation.Frontmatter
		v.Manifest = validation.Manifest
		if validation.Issues != nil {
			v.Issues = validation.Issues
		}
	}
	if v.Status == "failed" && len(v.Issues) == 0 && op.ErrorCode != nil {
		v.Issues = append(v.Issues, skillpackage.Issue{Code: *op.ErrorCode})
	}
	return v, nil
}
func skillOperationData(op *agents.PublicOperationRow, view *SkillUpload) any {
	certainty := "known"
	if op.Status == "queued" || op.Status == "running" {
		certainty = "pending"
	}
	if op.Status == "interrupted" || op.Status == "outcome_unknown" {
		certainty = "unknown"
	}
	var result any
	if view != nil {
		result = map[string]any{"upload_operation_id": strconv.FormatUint(op.ID, 10), "validation_status": view.Status, "normalized_name": view.Name, "manifest": view.Manifest, "issues": view.Issues, "expires_at": view.ExpiresAt}
	}
	var target any
	if op.SubjectID != nil {
		target = strconv.FormatUint(*op.SubjectID, 10)
	}
	return map[string]any{"id": strconv.FormatUint(op.ID, 10), "kind": op.Kind, "target": map[string]any{"kind": op.SubjectKind, "id": target}, "status": op.Status, "deadline_at": op.DeadlineAt, "started_at": op.StartedAt, "finished_at": op.FinishedAt, "result": result, "error_code": op.ErrorCode, "outcome": map[string]any{"certainty": certainty, "reason": op.ErrorCode}, "created_at": op.CreatedAt}
}
func visibleSkillUpload(op *agents.PublicOperationRow, a *identity.Auth) bool {
	return op != nil && op.Kind == "skill_validate" && op.ContentDomain == "management" && (op.PublishedSkillVersionID != nil || op.ActorUserID == a.User.ID)
}
func (s *Service) GetSkillUpload(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(id, false)
		if e != nil {
			return e
		}
		if !visibleSkillUpload(op, a) {
			return missing()
		}
		view, e := skillUploadView(op)
		if e != nil {
			return e
		}
		out.Data = view
		return nil
	})
}
func (s *Service) DeleteSkillUpload(ctx context.Context, raw string, id uint64, key string) (*Result, error) {
	return s.command(ctx, raw, key, "skill_upload.delete", fmt.Sprintf("skill_upload:%d", id), struct{}{}, func(tx identity.Tx, a *identity.Auth, out *Result, _ uint64) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(id, true)
		if e != nil {
			return e
		}
		if !visibleSkillUpload(op, a) || op.ActorUserID != a.User.ID {
			return missing()
		}
		if op.PublishedSkillVersionID != nil || op.Status == "queued" || op.Status == "running" {
			return inUse()
		}
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		if op.StagedFileID != nil {
			busy, e := r.ActiveFileReaders(*op.StagedFileID)
			if e != nil {
				return e
			}
			if busy {
				return inUse()
			}
		}
		now := time.Now().UTC()
		op.ExpiresAt = &now
		op.UpdatedAt = now
		op.FenceVersion++
		if e = state.SavePublicOperation(op); e != nil {
			return e
		}
		out.Status = 204
		out.Data = nil
		return nil
	})
}
func (s *Service) RecoverSkills(ctx context.Context) error {
	if s.Epoch == "" {
		return unavailable()
	}
	return s.background(ctx, func(tx identity.Tx) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		now := time.Now().UTC()
		if e = r.RecoverSkillOperations(s.Epoch, now); e != nil {
			return e
		}
		return r.RecoverSkillReaders(s.Epoch, now)
	})
}
func (s *Service) ProcessSkills(ctx context.Context, limit int) error {
	if s.Epoch == "" || s.Files == nil || limit < 1 || limit > 100 {
		return unavailable()
	}
	var rows []agents.PublicOperationRow
	if e := s.background(ctx, func(tx identity.Tx) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		if e = r.ExpireSkillOperations(time.Now().UTC()); e != nil {
			return e
		}
		rows, e = r.PendingSkillOperations(limit)
		return e
	}); e != nil {
		return e
	}
	for i := range rows {
		if e := s.processSkill(ctx, rows[i]); e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) processSkill(ctx context.Context, candidate agents.PublicOperationRow) error {
	var claim *agents.PublicOperationRow
	var file *agents.FileRow
	var lease *agents.ResourceReferenceRow
	e := s.background(ctx, func(tx identity.Tx) error {
		claim = nil
		users, e := tx.LockUsers([]uint64{candidate.ActorUserID})
		if e != nil {
			return e
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(candidate.ID, true)
		if e != nil {
			return e
		}
		if op == nil || op.Kind != "skill_validate" || op.Status != "queued" {
			return nil
		}
		now := time.Now().UTC()
		user := users[op.ActorUserID]
		code := ""
		if user == nil || user.Status != "active" || user.DeletedAt != nil || user.Role != "admin" {
			code = "ACTOR_UNAVAILABLE"
		}
		if !now.Before(op.DeadlineAt) {
			code = "OPERATION_EXPIRED"
		}
		if op.StagedFileID == nil {
			code = "SKILL_ARCHIVE_UNAVAILABLE"
		} else {
			file, e = state.File(*op.StagedFileID, true)
			if e != nil {
				return e
			}
			if file == nil || file.State != "staged" || file.SizeBytes == nil || file.IntegrityState != "verified" {
				code = "SKILL_ARCHIVE_UNAVAILABLE"
			}
		}
		if code != "" {
			op.Status = "failed"
			op.ErrorCode = &code
			op.FinishedAt = &now
			op.UpdatedAt = now
			return state.SavePublicOperation(op)
		}
		op.Status = "running"
		op.StartedAt = &now
		op.UpdatedAt = now
		op.ExecutorEpoch = &s.Epoch
		op.FenceVersion++
		if e = state.SavePublicOperation(op); e != nil {
			return e
		}
		lease, e = s.newSkillLease(state, "file", file.ID, "skill_validation")
		if e != nil {
			return e
		}
		claim = op
		return nil
	})
	if e != nil || claim == nil {
		return e
	}
	defer func() { _ = s.releaseSkillLease(ctx, lease.ID) }()
	validationCtx, cancel := context.WithDeadline(ctx, claim.DeadlineAt)
	pkg, validationErr := s.validateSkillBytes(validationCtx, file, claim)
	cancel()
	saveCtx, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer saveCancel()
	return s.background(saveCtx, func(tx identity.Tx) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(claim.ID, true)
		if e != nil {
			return e
		}
		if op == nil || op.Status != "running" || op.FenceVersion != claim.FenceVersion || op.ExecutorEpoch == nil || *op.ExecutorEpoch != s.Epoch {
			return nil
		}
		now := time.Now().UTC()
		op.Status = "succeeded"
		op.FinishedAt = &now
		op.UpdatedAt = now
		report := SkillValidation{Issues: []skillpackage.Issue{}}
		if validationErr != nil {
			code := "SKILL_VALIDATION_FAILED"
			issue := skillpackage.Issue{Code: code}
			var problem *skillpackage.Error
			if errors.As(validationErr, &problem) {
				issue = problem.Issue
				code = issue.Code
			}
			report.Issues = append(report.Issues, issue)
			op.Status = "failed"
			op.ErrorCode = &code
		} else {
			report.Name = &pkg.Frontmatter.Name
			report.Manifest = &pkg.Manifest
			report.Frontmatter = &pkg.Frontmatter
			report.ContentSHA = &pkg.ContentSHA256
		}
		op.Result, e = json.Marshal(report)
		if e != nil {
			return e
		}
		return state.SavePublicOperation(op)
	})
}
func (s *Service) validateSkillBytes(ctx context.Context, file *agents.FileRow, op *agents.PublicOperationRow) (*skillpackage.Package, error) {
	if file.SizeBytes == nil || *file.SizeBytes > uint64(skillpackage.MaxArchiveBytes) {
		return nil, integrity()
	}
	reader, e := s.Files.Open(file.StorageKey)
	if e != nil {
		return nil, e
	}
	defer func() { _ = reader.Close() }()
	// Package retains its ReaderAt for later extraction. Keep a bounded immutable
	// byte snapshot, rather than returning a package backed by a closed file.
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	archive, e := io.ReadAll(io.LimitReader(reader, skillpackage.MaxArchiveBytes+1))
	if e != nil {
		return nil, e
	}
	if uint64(len(archive)) != *file.SizeBytes || int64(len(archive)) > skillpackage.MaxArchiveBytes {
		return nil, integrity()
	}
	pkg, e := skillpackage.Validate(ctx, bytes.NewReader(archive), int64(len(archive)))
	if e != nil {
		return nil, e
	}
	expected, e := hex.DecodeString(pkg.ArchiveSHA256)
	if e != nil || !bytes.Equal(expected, file.SHA256) {
		return nil, &skillpackage.Error{Issue: skillpackage.Issue{Code: "SKILL_INTEGRITY_FAILED"}}
	}
	var snapshot SkillUploadSnapshot
	if json.Unmarshal(op.ConfigSnapshot, &snapshot) != nil {
		return nil, integrity()
	}
	if snapshot.ArchiveSHA != pkg.ArchiveSHA256 || snapshot.Size != *file.SizeBytes {
		return nil, integrity()
	}
	if snapshot.ExpectedName != nil && pkg.Frontmatter.Name != *snapshot.ExpectedName {
		return nil, &skillpackage.Error{Issue: skillpackage.Issue{Code: "SKILL_NAME_MISMATCH", Path: "SKILL.md"}}
	}
	return pkg, nil
}
