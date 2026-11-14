package agents

import (
	"context"
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	_ "golang.org/x/image/webp"
)

const attachmentLimit = 32 << 20

func safeFilename(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > 255 || !utf8.ValidString(name) || strings.ContainsAny(name, "/\\") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func safePreview(filename, media string) bool {
	if isImage(media) {
		return true
	}
	if media != "text/plain" && media != "text/plain; charset=utf-8" {
		return false
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".html", ".htm", ".svg", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh", ".bash", ".py", ".ps1", ".bat", ".cmd", ".vbs", ".xml":
		return false
	}
	return true
}
func (s *Service) orphanAttachment(ctx context.Context, id uint64) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = s.background(cleanup, func(_ identity.Tx, _ Repository, st StateRepository) error {
		file, e := st.File(id, true)
		if e != nil {
			return e
		}
		if file == nil || file.State != "uploading" {
			return nil
		}
		now := time.Now().UTC()
		file.State = "orphaned"
		file.OrphanedAt = &now
		file.ExpiresAt = &now
		file.UpdatedAt = now
		return st.SaveFile(file)
	})
}

func (s *Service) UploadAttachment(ctx context.Context, raw string, session uint64, key, filename string, source io.Reader) (*Result, error) {
	if s.Files == nil || source == nil || s.Epoch == "" {
		return nil, unavailable()
	}
	if !safeFilename(filename) {
		return nil, httpx.Invalid("file", "invalid_filename")
	}
	if !keyPattern.MatchString(key) {
		return nil, httpx.Invalid("Idempotency-Key", "invalid_format")
	}
	var file *FileRow
	var lease *ResourceReferenceRow
	_, e := s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, _ *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		v, e := s.sessionAccess(st, session, a, true, true)
		if e != nil {
			return e
		}
		if v.ArchivedAt != nil {
			return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		expires := now.Add(24 * time.Hour)
		file = &FileRow{Purpose: "user_attachment", ContentDomain: v.ExecutionMode, ContentSessionID: &v.ID, OwnerUserID: v.personalOwnerID(), AgentID: &v.AgentID, StorageKey: NewStorageKey(), WriterToken: NewStorageKey(), State: "uploading", IntegrityState: "unchecked", MediaType: "application/octet-stream", MediaProperties: json.RawMessage(`{}`), UploadedByUserID: &a.User.ID, CreatedAt: now, UpdatedAt: now, ExpiresAt: &expires}
		if e = st.InsertFile(file); e != nil {
			return e
		}
		lease = &ResourceReferenceRow{HolderKind: "download", HolderID: NewStorageKey(), ResourceKind: "file", ResourceID: file.ID, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		return st.InsertResourceReference(lease)
	})
	if e != nil {
		return nil, e
	}
	published := false
	defer func() { _ = s.releaseFileLease(ctx, lease.ID) }()
	defer func() {
		if !published {
			s.orphanAttachment(ctx, file.ID)
		}
	}()
	copyCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	facts, e := s.Files.Write(copyCtx, file.StorageKey, source, attachmentLimit)
	if e != nil {
		return nil, httpx.E(422, "ATTACHMENT_UPLOAD_FAILED", "文件未完成上传，请核对大小和传输状态")
	}
	reader, e := s.Files.Open(file.StorageKey)
	if e != nil {
		return nil, e
	}
	head := make([]byte, 512)
	n, readErr := reader.Read(head)
	if readErr != nil && readErr != io.EOF {
		_ = reader.Close()
		return nil, readErr
	}
	media := http.DetectContentType(head[:n])
	if isImage(media) {
		if _, e = reader.Seek(0, io.SeekStart); e != nil {
			_ = reader.Close()
			return nil, e
		}
		config, _, e := image.DecodeConfig(reader)
		if e != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 4096 || config.Height > 4096 || int64(config.Width)*int64(config.Height) > 16777216 {
			_ = reader.Close()
			return nil, httpx.Invalid("file", "invalid_image")
		}
	}
	if e = reader.Close(); e != nil {
		return nil, e
	}
	request := struct {
		Filename string `json:"filename"`
		Size     uint64 `json:"size_bytes,string"`
		SHA256   string `json:"sha256"`
	}{filename, facts.Size, hexHash(facts.SHA256)}
	out, e := s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, session, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "attachment.upload", "session:"+strconv.FormatUint(session, 10), request, func(rec *Receipt) error {
			v, e := s.sessionAccess(st, session, a, true, true)
			if e != nil {
				return e
			}
			if v.ArchivedAt != nil {
				return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
			}
			row, e := st.File(file.ID, true)
			if e != nil {
				return e
			}
			if row == nil || row.State != "uploading" || row.WriterToken != file.WriterToken {
				return httpx.E(409, "UPLOAD_FENCED", "上传登记已失效")
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			row.State = "staged"
			row.IntegrityState = "verified"
			row.SizeBytes = &facts.Size
			row.SHA256 = facts.SHA256
			row.MediaType = media
			row.MediaProperties, _ = json.Marshal(map[string]bool{"preview": safePreview(filename, media)})
			row.IntegrityCheckedAt = &now
			row.UpdatedAt = now
			if e = st.SaveFile(row); e != nil {
				return e
			}
			attachment := &AttachmentRow{ContentSessionID: v.ID, FileID: row.ID, UploadedByUserID: a.User.ID, Filename: filename, State: "staged", CommandReceiptID: rec.ID, RowVersion: 1, CreatedAt: now, ExpiresAt: row.ExpiresAt}
			if e = st.InsertAttachment(attachment); e != nil {
				return e
			}
			out.Status = 201
			out.Data, e = s.attachmentView(st, attachment)
			if e != nil {
				return e
			}
			out.Tag = s.tag("attachment", attachment.ID, 1)
			out.Location = "/api/v1/agents/sessions/" + strconv.FormatUint(session, 10) + "/attachments/" + strconv.FormatUint(attachment.ID, 10)
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
	if e == nil && !out.Replayed {
		published = true
	}
	return out, e
}

func (s *Service) attachmentView(st StateRepository, row *AttachmentRow) (AttachmentView, error) {
	file, e := st.File(row.FileID, false)
	if e != nil {
		return AttachmentView{}, e
	}
	if file == nil || file.SizeBytes == nil || len(file.SHA256) != 32 {
		return AttachmentView{}, integrity()
	}
	state := row.State
	if state == "staged" && row.ExpiresAt != nil && !time.Now().UTC().Before(*row.ExpiresAt) {
		state = "expired"
	}
	return AttachmentView{ID: row.ID, SessionID: row.ContentSessionID, FileID: row.FileID, Filename: row.Filename, MediaType: file.MediaType, Size: *file.SizeBytes, SHA256: hexHash(file.SHA256), State: state, UploadedBy: row.UploadedByUserID, ExpiresAt: row.ExpiresAt, BoundInputID: row.BoundInputID, Version: strings.Trim(s.tag("attachment", row.ID, row.RowVersion), `"`), CreatedAt: row.CreatedAt}, nil
}
func (s *Service) ListAttachments(ctx context.Context, raw string, session uint64, q AttachmentQuery) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		base := Query{Page: q.Page, PageSize: q.PageSize}
		if e := validateQuery(&base); e != nil {
			return e
		}
		q.Page, q.PageSize = base.Page, base.PageSize
		if q.State == "" {
			q.State = "staged"
		}
		if q.State != "staged" && q.State != "bound" {
			return httpx.Invalid("state", "unsupported")
		}
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, session, a, false, false); e != nil {
			return e
		}
		rows, n, e := st.Attachments(session, a.User.ID, q)
		if e != nil {
			return e
		}
		items := []AttachmentView{}
		for i := range rows {
			v, e := s.attachmentView(st, &rows[i])
			if e != nil {
				return e
			}
			items = append(items, v)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: n}
		return nil
	})
}
func (s *Service) GetAttachment(ctx context.Context, raw string, session, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, session, a, false, false); e != nil {
			return e
		}
		row, e := st.Attachment(id, false)
		if e != nil {
			return e
		}
		if row == nil || row.ContentSessionID != session || row.State != "bound" && row.UploadedByUserID != a.User.ID {
			return missing()
		}
		out.Data, e = s.attachmentView(st, row)
		out.Tag = s.tag("attachment", id, row.RowVersion)
		return e
	})
}
func (s *Service) DeleteAttachment(ctx context.Context, raw string, session, id uint64, tag, key string) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if _, e = s.sessionAccess(st, session, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "attachment.delete", "session:"+strconv.FormatUint(session, 10), map[string]any{"attachment_id": strconv.FormatUint(id, 10)}, func(rec *Receipt) error {
			v, e := s.sessionAccess(st, session, a, true, true)
			if e != nil {
				return e
			}
			if v.ArchivedAt != nil {
				return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
			}
			initial, e := st.Attachment(id, false)
			if e != nil {
				return e
			}
			if initial == nil || initial.ContentSessionID != session || initial.UploadedByUserID != a.User.ID {
				return missing()
			}
			file, e := st.File(initial.FileID, true)
			if e != nil {
				return e
			}
			if file == nil {
				return integrity()
			}
			row, e := st.Attachment(id, true)
			if e != nil {
				return e
			}
			if e = checkTag(tag, s.tag("attachment", id, row.RowVersion)); e != nil {
				return e
			}
			if row.State != "staged" {
				return httpx.E(409, "ATTACHMENT_NOT_STAGED", "仅可删除尚未绑定的附件")
			}
			n, e := st.FileActiveReferences(file.ID)
			if e != nil {
				return e
			}
			if n > 0 {
				return httpx.E(409, "FILE_IN_USE", "文件仍有在途读取")
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			row.State = "deleted"
			row.DeletedAt = &now
			row.RowVersion++
			if e = st.SaveAttachment(row); e != nil {
				return e
			}
			file.State = "orphaned"
			file.OrphanedAt = &now
			file.ExpiresAt = &now
			file.UpdatedAt = now
			if e = st.SaveFile(file); e != nil {
				return e
			}
			out.Status = 204
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
