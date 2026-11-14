package agents

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// ProcessFileMaintenance reconciles local readers and reclaims unbound upload
// and deleted artifact bytes. Skill archives have their own catalog lifecycle.
func (s *Service) ProcessFileMaintenance(ctx context.Context, limit int) error {
	if s.Files == nil || s.Epoch == "" {
		return nil
	}
	if limit < 1 || limit > 1000 {
		return httpx.Invalid("limit", "invalid_range")
	}
	s.fileReleaseMu.Lock()
	pending := []uint64{}
	for id := range s.pendingFileReleases {
		pending = append(pending, id)
	}
	s.fileReleaseMu.Unlock()
	for _, id := range pending {
		if e := s.releaseFileLease(ctx, id); e != nil {
			return e
		}
	}
	var old []ResourceReferenceRow
	var rows []FileRow
	now := time.Now().UTC().Truncate(time.Millisecond)
	e := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		var e error
		old, e = st.OldDownloadReferences(s.Epoch, limit)
		if e != nil {
			return e
		}
		rows, e = st.FileCleanupCandidates(now, limit)
		return e
	})
	if e != nil {
		return e
	}
	// Old-epoch download holders are process-local readers/writers. The previous
	// single application process is gone; this says nothing about remote tools.
	for _, ref := range old {
		if e = s.releaseFileLease(ctx, ref.ID); e != nil {
			return e
		}
	}
	for _, candidate := range rows {
		var deleting *FileRow
		e = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			if candidate.ContentSessionID != nil {
				if _, e := st.Session(*candidate.ContentSessionID, true); e != nil {
					return e
				}
			}
			file, e := st.File(candidate.ID, true)
			if e != nil {
				return e
			}
			if file == nil || file.Purpose != "user_attachment" && file.Purpose != "agent_artifact" && file.Purpose != "tool_image" || file.UploadOperationID != nil || file.State == "deleted" || file.State == "bound" {
				return nil
			}
			if file.State != "deleting" && (file.ExpiresAt == nil || now.Before(*file.ExpiresAt)) {
				return nil
			}
			n, e := st.FileActiveReferences(file.ID)
			if e != nil {
				return e
			}
			if n > 0 {
				return nil
			}
			bound, e := st.FileHasBindings(file.ID)
			if e != nil {
				return e
			}
			if bound {
				return nil
			}
			attachments, e := st.AttachmentsForFile(file.ID)
			if e != nil {
				return e
			}
			for i := range attachments {
				row := &attachments[i]
				if row.State == "staged" {
					if row.ExpiresAt == nil || now.Before(*row.ExpiresAt) {
						return nil
					}
					row.State = "expired"
					row.RowVersion++
					if e = st.SaveAttachment(row); e != nil {
						return e
					}
				}
			}
			file.State = "deleting"
			file.UpdatedAt = now
			if e = st.SaveFile(file); e != nil {
				return e
			}
			deleting = file
			return nil
		})
		if e != nil {
			return e
		}
		if deleting == nil {
			continue
		}
		if e = s.Files.Delete(deleting.StorageKey); e != nil {
			return e
		}
		e = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			file, e := st.File(deleting.ID, true)
			if e != nil {
				return e
			}
			if file == nil || file.State != "deleting" || file.StorageKey != deleting.StorageKey || file.WriterToken != deleting.WriterToken {
				return integrity()
			}
			finished := time.Now().UTC().Truncate(time.Millisecond)
			file.State = "deleted"
			file.DeletedAt = &finished
			file.UpdatedAt = finished
			return st.SaveFile(file)
		})
		if e != nil {
			return e
		}
	}
	return nil
}
