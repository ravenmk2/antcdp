package agentresources

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// CleanupSkills removes only registered, no-longer-used bytes. Ready versions,
// active readers are never inferred to be expired.
func (s *Service) CleanupSkills(ctx context.Context, limit int) error {
	if s.Files == nil || s.Epoch == "" || limit < 1 || limit > 100 {
		return unavailable()
	}
	s.skillReleaseMu.Lock()
	pending := []uint64{}
	for id := range s.pendingSkillReleases {
		pending = append(pending, id)
		if len(pending) >= limit {
			break
		}
	}
	s.skillReleaseMu.Unlock()
	for _, id := range pending {
		if e := s.releaseSkillLease(ctx, id); e != nil {
			return e
		}
	}
	var versions []SkillVersion
	var uploads []agents.PublicOperationRow
	var orphaned []agents.FileRow
	if e := s.background(ctx, func(tx identity.Tx) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		versions, e = r.RetiredSkillVersions(limit)
		if e != nil {
			return e
		}
		uploads, e = r.ExpiredSkillUploads(time.Now().UTC(), limit)
		if e != nil {
			return e
		}
		orphaned, e = r.ExpiredUnassociatedSkillFiles(time.Now().UTC(), limit)
		return e
	}); e != nil {
		return e
	}
	for _, v := range versions {
		if e := s.cleanupSkillVersion(ctx, v.ID); e != nil {
			return e
		}
	}
	for _, op := range uploads {
		if e := s.cleanupSkillUpload(ctx, op.ID); e != nil {
			return e
		}
	}
	for _, file := range orphaned {
		if e := s.cleanupUnassociatedSkillFile(ctx, file.ID); e != nil {
			return e
		}
	}
	return nil
}

func (s *Service) cleanupUnassociatedSkillFile(ctx context.Context, id uint64) error {
	var file *agents.FileRow
	err := s.background(ctx, func(tx identity.Tx) error {
		file = nil
		r, err := skillsRepository(tx)
		if err != nil {
			return err
		}
		state, err := agents.StateFor(tx)
		if err != nil {
			return err
		}
		row, err := state.File(id, true)
		if err != nil {
			return err
		}
		if row == nil || row.ContentDomain != "system_skill" || row.Purpose != "skill_archive" || row.UploadOperationID != nil || row.ExpiresAt == nil || time.Now().Before(*row.ExpiresAt) || row.State != "uploading" && row.State != "orphaned" && row.State != "deleting" {
			return nil
		}
		busy, err := r.ActiveFileReaders(id)
		if err != nil || busy {
			return err
		}
		row.State = "deleting"
		row.UpdatedAt = time.Now().UTC()
		if err = state.SaveFile(row); err != nil {
			return err
		}
		file = row
		return nil
	})
	if err != nil || file == nil {
		return err
	}
	if err = s.Files.Delete(file.StorageKey); err != nil {
		return nil
	}
	return s.background(ctx, func(tx identity.Tx) error {
		state, err := agents.StateFor(tx)
		if err != nil {
			return err
		}
		row, err := state.File(id, true)
		if err != nil {
			return err
		}
		if row == nil || row.State != "deleting" || row.StorageKey != file.StorageKey || row.UploadOperationID != nil {
			return integrity()
		}
		now := time.Now().UTC()
		row.State = "deleted"
		row.DeletedAt, row.UpdatedAt = &now, now
		return state.SaveFile(row)
	})
}
func cleanupReport(state string) json.RawMessage {
	v, _ := json.Marshal(map[string]any{"cleanup_state": state, "cleanup_attempted_at": time.Now().UTC()})
	return v
}
func (s *Service) cleanupSkillVersion(ctx context.Context, id uint64) error {
	var version *SkillVersion
	var file *agents.FileRow
	e := s.background(ctx, func(tx identity.Tx) error {
		version = nil
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.SkillVersion(id, true)
		if e != nil {
			return e
		}
		if v == nil || v.State != "deleted" {
			return nil
		}
		busy, e := r.VersionReferenced(id, v.ArchiveFileID)
		if e != nil {
			return e
		}
		if busy {
			return nil
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		file, e = state.File(v.ArchiveFileID, true)
		if e != nil {
			return e
		}
		if file == nil || file.ContentDomain != "system_skill" {
			return integrity()
		}
		if file.State != "deleted" {
			file.State = "deleting"
			file.UpdatedAt = time.Now().UTC()
			if e = state.SaveFile(file); e != nil {
				return e
			}
		}
		v.ReportJSON = cleanupReport("running")
		if e = r.SaveSkillVersion(v); e != nil {
			return e
		}
		version = v
		return nil
	})
	if e != nil || version == nil {
		return e
	}
	ioErr := s.Files.Delete(file.StorageKey)
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return s.background(saveCtx, func(tx identity.Tx) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		v, e := r.SkillVersion(id, true)
		if e != nil {
			return e
		}
		if v == nil || v.State != "deleted" || v.ArchiveFileID != version.ArchiveFileID {
			return integrity()
		}
		if ioErr != nil {
			v.ReportJSON = cleanupReport("failed")
			return r.SaveSkillVersion(v)
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		current, e := state.File(file.ID, true)
		if e != nil {
			return e
		}
		if current == nil || current.StorageKey != file.StorageKey {
			return integrity()
		}
		now := time.Now().UTC()
		current.State = "deleted"
		current.DeletedAt = &now
		current.UpdatedAt = now
		current.ErrorCode = nil
		if e = state.SaveFile(current); e != nil {
			return e
		}
		v.ReportJSON = cleanupReport("completed")
		return r.SaveSkillVersion(v)
	})
}
func (s *Service) cleanupSkillUpload(ctx context.Context, id uint64) error {
	var file *agents.FileRow
	e := s.background(ctx, func(tx identity.Tx) error {
		file = nil
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		op, e := state.PublicOperation(id, true)
		if e != nil {
			return e
		}
		if op == nil || op.Kind != "skill_validate" || op.PublishedSkillVersionID != nil || op.ExpiresAt == nil || time.Now().Before(*op.ExpiresAt) || op.StagedFileID == nil {
			return nil
		}
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		busy, e := r.ActiveFileReaders(*op.StagedFileID)
		if e != nil {
			return e
		}
		if busy {
			return nil
		}
		v, e := state.File(*op.StagedFileID, true)
		if e != nil {
			return e
		}
		if v == nil || v.State == "deleted" {
			return nil
		}
		if v.State == "bound" || v.ContentDomain != "system_skill" {
			return integrity()
		}
		now := time.Now().UTC()
		if op.Status == "queued" || op.Status == "running" {
			code := "SKILL_UPLOAD_EXPIRED"
			op.Status = "cancelled"
			op.ErrorCode = &code
			op.FenceVersion++
			op.FinishedAt = &now
			op.UpdatedAt = now
			if e = state.SavePublicOperation(op); e != nil {
				return e
			}
		}
		v.State = "deleting"
		v.UpdatedAt = now
		if e = state.SaveFile(v); e != nil {
			return e
		}
		file = v
		return nil
	})
	if e != nil || file == nil {
		return e
	}
	if e = s.Files.Delete(file.StorageKey); e != nil {
		return nil
	}
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return s.background(saveCtx, func(tx identity.Tx) error {
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		v, e := state.File(file.ID, true)
		if e != nil {
			return e
		}
		if v == nil || v.State != "deleting" || v.StorageKey != file.StorageKey {
			return integrity()
		}
		now := time.Now().UTC()
		v.State = "deleted"
		v.DeletedAt = &now
		v.UpdatedAt = now
		return state.SaveFile(v)
	})
}
