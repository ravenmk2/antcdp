package agents

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) fileAccess(st StateRepository, id uint64, a *identity.Auth, lock bool) (*FileRow, string, bool, error) {
	initial, e := st.File(id, false)
	if e != nil {
		return nil, "", false, e
	}
	if initial == nil || initial.ContentDomain == "system_skill" || initial.ContentSessionID == nil {
		return nil, "", false, missing()
	}
	session, e := s.sessionAccess(st, *initial.ContentSessionID, a, false, lock)
	if e != nil {
		return nil, "", false, e
	}
	if initial.ContentDomain != session.ExecutionMode {
		return nil, "", false, integrity()
	}
	file := initial
	if lock {
		file, e = st.File(id, true)
		if e != nil {
			return nil, "", false, e
		}
		if file == nil {
			return nil, "", false, missing()
		}
	}
	attachments, e := st.AttachmentsForFile(id)
	if e != nil {
		return nil, "", false, e
	}
	for _, row := range attachments {
		if row.ContentSessionID != session.ID {
			return nil, "", false, integrity()
		}
		if row.State == "bound" {
			return file, row.Filename, true, nil
		}
		if row.UploadedByUserID == a.User.ID {
			readable := row.State == "staged" && row.ExpiresAt != nil && time.Now().UTC().Before(*row.ExpiresAt)
			return file, row.Filename, readable, nil
		}
	}
	artifacts, e := st.ArtifactsForFile(id)
	if e != nil {
		return nil, "", false, e
	}
	if len(artifacts) > 0 {
		row := artifacts[0]
		if row.ContentSessionID != session.ID {
			return nil, "", false, integrity()
		}
		return file, row.Filename, row.DeletedAt == nil, nil
	}
	return nil, "", false, missing()
}

func (s *Service) GetFile(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		file, filename, readable, e := s.fileAccess(st, id, a, false)
		if e != nil {
			return e
		}
		meta := FileMetadata{ID: file.ID, Filename: filename, MediaType: file.MediaType, Size: file.SizeBytes, State: file.State, Integrity: file.IntegrityState, CreatedAt: file.CreatedAt}
		if len(file.SHA256) == 32 {
			hash := hexHash(file.SHA256)
			meta.SHA256 = &hash
		}
		if readable && (file.State == "staged" || file.State == "bound") && file.IntegrityState == "verified" {
			url := "/api/v1/agents/files/" + strconv.FormatUint(id, 10) + "/content"
			meta.DownloadURL = &url
			meta.Preview = safePreview(filename, file.MediaType)
		}
		out.Data = meta
		return nil
	})
}

type leasedReader struct {
	ReadSeekCloser
	once     sync.Once
	closed   func()
	closeErr error
}

func (r *leasedReader) Close() error {
	r.once.Do(func() {
		r.closeErr = r.ReadSeekCloser.Close()
		if r.closeErr == nil && r.closed != nil {
			r.closed()
		}
	})
	return r.closeErr
}

func (s *Service) releaseFileLease(ctx context.Context, id uint64) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	e := s.background(cleanup, func(_ identity.Tx, _ Repository, st StateRepository) error {
		v, e := st.ResourceReference(id, true)
		if e != nil {
			return e
		}
		if v == nil || v.State == "released" {
			return nil
		}
		now := time.Now().UTC()
		reason := "local_reader_closed"
		v.State = "released"
		v.ReleasedAt = &now
		v.LastVerifiedAt = &now
		v.UpdatedAt = now
		v.ReleaseReason = &reason
		v.ReleaseEvidence = json.RawMessage(`{"local_reader_closed":true}`)
		return st.SaveResourceReference(v)
	})
	s.fileReleaseMu.Lock()
	defer s.fileReleaseMu.Unlock()
	if e != nil {
		if s.pendingFileReleases == nil {
			s.pendingFileReleases = map[uint64]bool{}
		}
		s.pendingFileReleases[id] = true
	} else {
		delete(s.pendingFileReleases, id)
	}
	return e
}

func (s *Service) GetFileContent(ctx context.Context, raw string, id uint64) (*Result, error) {
	if s.Files == nil || s.Epoch == "" {
		return nil, unavailable()
	}
	var file *FileRow
	var name string
	var lease *ResourceReferenceRow
	out, e := s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, _ *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		var readable bool
		file, name, readable, e = s.fileAccess(st, id, a, true)
		if e != nil {
			return e
		}
		if !readable || file.State != "bound" && file.State != "staged" || file.IntegrityState != "verified" || file.SizeBytes == nil || *file.SizeBytes >= math.MaxInt64 || len(file.SHA256) != 32 {
			return httpx.E(409, "FILE_UNAVAILABLE", "文件当前不可读取")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		lease = &ResourceReferenceRow{HolderKind: "download", HolderID: NewStorageKey(), ResourceKind: "file", ResourceID: file.ID, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		return st.InsertResourceReference(lease)
	})
	if e != nil {
		return nil, e
	}
	reader, e := s.Files.Open(file.StorageKey)
	if e != nil {
		if errors.Is(e, os.ErrNotExist) {
			_ = s.markFileIntegrity(ctx, file, "missing")
		}
		_ = s.releaseFileLease(ctx, lease.ID)
		return nil, httpx.E(409, "FILE_UNAVAILABLE", "文件字节暂不可用")
	}
	valid := false
	defer func() {
		if !valid {
			if reader.Close() == nil {
				_ = s.releaseFileLease(ctx, lease.ID)
			}
		}
	}()
	hash := sha256.New()
	n, e := io.Copy(hash, io.LimitReader(contextReader{ctx, reader}, int64(*file.SizeBytes)+1))
	if e != nil {
		return nil, e
	}
	if uint64(n) != *file.SizeBytes || string(hash.Sum(nil)) != string(file.SHA256) {
		_ = s.markFileIntegrity(ctx, file, "corrupt")
		return nil, httpx.E(409, "FILE_INTEGRITY_FAILED", "文件完整性校验失败")
	}
	if _, e = reader.Seek(0, io.SeekStart); e != nil {
		return nil, e
	}
	wrapped := &leasedReader{ReadSeekCloser: reader, closed: func() { _ = s.releaseFileLease(ctx, lease.ID) }}
	out.Data = &FileContent{Reader: wrapped, Filename: name, MediaType: file.MediaType, Size: *file.SizeBytes, Preview: safePreview(name, file.MediaType)}
	valid = true
	return out, nil
}

func (s *Service) markFileIntegrity(ctx context.Context, observed *FileRow, state string) error {
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return s.background(finish, func(_ identity.Tx, _ Repository, st StateRepository) error {
		file, e := st.File(observed.ID, true)
		if e != nil {
			return e
		}
		if file == nil || file.StorageKey != observed.StorageKey || file.WriterToken != observed.WriterToken || file.State == "deleting" || file.State == "deleted" {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		file.IntegrityState = state
		file.IntegrityCheckedAt = &now
		file.UpdatedAt = now
		return st.SaveFile(file)
	})
}
