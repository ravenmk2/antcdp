package agents

import (
	"slices"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type InputFileRow struct {
	InputID          uint64    `db:"input_id"`
	Ordinal          uint64    `db:"ordinal"`
	ReferenceKind    string    `db:"reference_kind"`
	ReferenceID      uint64    `db:"reference_id"`
	FileID           uint64    `db:"file_id"`
	ContentSessionID uint64    `db:"content_session_id"`
	SourceSHA256     []byte    `db:"source_sha256"`
	CreatedAt        time.Time `db:"created_at"`
}

func bindInputFiles(st StateRepository, session *SessionRow, input, user uint64, refs []agentcore.FileRef, model agentcore.LockedModel, now time.Time) error {
	ids := []uint64{}
	targets := make([]uint64, len(refs))
	for i, ref := range refs {
		switch ref.Kind {
		case "attachment":
			v, e := st.Attachment(uint64(ref.ID), false)
			if e != nil {
				return e
			}
			if v == nil || v.ContentSessionID != session.ID {
				return missing()
			}
			targets[i] = v.FileID
		case "artifact":
			v, e := st.Artifact(uint64(ref.ID), false)
			if e != nil {
				return e
			}
			if v == nil || v.ContentSessionID != session.ID || v.DeletedAt != nil {
				return missing()
			}
			targets[i] = v.FileID
		default:
			return httpx.Invalid("file_refs", "unsupported")
		}
		ids = append(ids, targets[i])
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	files := map[uint64]*FileRow{}
	for _, id := range ids {
		v, e := st.File(id, true)
		if e != nil {
			return e
		}
		if v == nil || v.ContentSessionID == nil || *v.ContentSessionID != session.ID || v.ContentDomain != session.ExecutionMode || v.State != "staged" && v.State != "bound" || v.IntegrityState != "verified" || v.SizeBytes == nil || len(v.SHA256) != 32 {
			return httpx.E(409, "FILE_UNAVAILABLE", "文件当前不可用")
		}
		if v.ContentDomain == "interactive" && (v.OwnerUserID == nil || session.personalOwnerID() == nil || *v.OwnerUserID != *session.personalOwnerID()) || v.ContentDomain == "service" && (v.AgentID == nil || *v.AgentID != session.AgentID) {
			return missing()
		}
		if isImage(v.MediaType) && model.Capabilities.ImageInput != modelcore.Supported {
			return httpx.E(422, "MODEL_CAPABILITY_UNSUPPORTED", "所选模型不支持图像输入")
		}
		files[id] = v
	}
	rows := []InputFileRow{}
	for i, ref := range refs {
		file := files[targets[i]]
		if ref.Kind == "attachment" {
			v, e := st.Attachment(uint64(ref.ID), true)
			if e != nil {
				return e
			}
			if v == nil || v.FileID != file.ID || v.ContentSessionID != session.ID {
				return missing()
			}
			if v.State == "staged" {
				if v.UploadedByUserID != user || v.ExpiresAt == nil || !now.Before(*v.ExpiresAt) {
					return httpx.E(409, "ATTACHMENT_UNAVAILABLE", "暂存附件不可用")
				}
				v.State = "bound"
				v.BoundInputID = &input
				v.BoundAt = &now
				v.RowVersion++
				if e = st.SaveAttachment(v); e != nil {
					return e
				}
				file.State = "bound"
				file.BoundAt = &now
				file.ExpiresAt = nil
				file.UpdatedAt = now
				if e = st.SaveFile(file); e != nil {
					return e
				}
			} else if v.State != "bound" {
				return httpx.E(409, "ATTACHMENT_UNAVAILABLE", "附件不可用")
			}
		} else {
			v, e := st.Artifact(uint64(ref.ID), true)
			if e != nil {
				return e
			}
			if v == nil || v.DeletedAt != nil || v.FileID != file.ID {
				return missing()
			}
		}
		rows = append(rows, InputFileRow{InputID: input, Ordinal: uint64(i), ReferenceKind: ref.Kind, ReferenceID: uint64(ref.ID), FileID: file.ID, ContentSessionID: session.ID, SourceSHA256: file.SHA256, CreatedAt: now})
	}
	return st.ReplaceInputFiles(input, rows)
}
