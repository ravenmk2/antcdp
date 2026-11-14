package agentresources

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

func (s *Service) ReadSkillContent(ctx context.Context, raw string, skillID, versionID uint64, path string) (*Result, error) {
	if s.Files == nil {
		return nil, unavailable()
	}
	normalized, e := skillpackage.NormalizePath(path, false)
	if e != nil {
		return nil, httpx.Invalid("path", "invalid_format")
	}
	var version *SkillVersion
	var entry *skillpackage.Entry
	var file *agents.FileRow
	var lease *agents.ResourceReferenceRow
	out, e := s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, _ *Result) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		version, e = r.SkillVersion(versionID, true)
		if e != nil {
			return e
		}
		if version == nil || version.SkillID != skillID {
			return missing()
		}
		if e = s.skillVersion(version); e != nil {
			return e
		}
		if version.State != "ready" {
			return httpx.E(410, "SKILL_VERSION_DELETED", "技能版本已删除")
		}
		for i := range version.Manifest.Entries {
			if version.Manifest.Entries[i].Path == normalized {
				entry = &version.Manifest.Entries[i]
				break
			}
		}
		if entry == nil {
			return missing()
		}
		if entry.Size > 256<<10 {
			return httpx.E(413, "PAYLOAD_TOO_LARGE", "文件过大，请下载技能包查看")
		}
		if !strings.HasPrefix(entry.MediaType, "text/") && entry.MediaType != "application/json" {
			return httpx.E(415, "UNSUPPORTED_MEDIA_TYPE", "该文件不支持文本预览")
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		file, e = state.File(version.ArchiveFileID, true)
		if e != nil {
			return e
		}
		if file == nil || file.State != "bound" || file.ContentDomain != "system_skill" || file.IntegrityState != "verified" || !bytes.Equal(file.SHA256, version.ArchiveHash) {
			return integrity()
		}
		lease, e = s.newSkillLease(state, "skill_version", versionID, "skill_preview")
		return e
	})
	if e != nil {
		return out, e
	}
	defer func() { _ = s.releaseSkillLease(ctx, lease.ID) }()
	reader, e := s.Files.Open(file.StorageKey)
	if e != nil {
		return out, unavailable()
	}
	defer func() { _ = reader.Close() }()
	b, e := skillpackage.ReadArchive(ctx, reader, version.ArchiveSHA, version.Frontmatter.Name, *entry, 256<<10)
	if e != nil {
		return out, httpx.E(409, "SKILL_INTEGRITY_FAILED", "技能文件完整性验证失败")
	}
	if !utf8.Valid(b) || bytes.ContainsRune(b, 0) {
		return out, httpx.E(415, "UNSUPPORTED_MEDIA_TYPE", "该文件不支持文本预览")
	}
	out.Data = map[string]any{"path": normalized, "text": string(b), "media_type": entry.MediaType, "truncated": false}
	return out, nil
}

type SkillDownload struct {
	Reader              io.ReadCloser
	Filename, MediaType string
	Size                uint64
	Auth                *identity.Auth
}
type leasedSkillReader struct {
	io.ReadCloser
	once     sync.Once
	release  func() error
	closeErr error
}

func (r *leasedSkillReader) Close() error {
	r.once.Do(func() {
		r.closeErr = r.ReadCloser.Close()
		if e := r.release(); r.closeErr == nil {
			r.closeErr = e
		}
	})
	return r.closeErr
}
func (s *Service) OpenSkillArchive(ctx context.Context, raw string, skillID, versionID uint64) (*SkillDownload, error) {
	if s.Files == nil {
		return nil, unavailable()
	}
	var version *SkillVersion
	var file *agents.FileRow
	var lease *agents.ResourceReferenceRow
	out, e := s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, _ *Result) error {
		r, e := skillsRepository(tx)
		if e != nil {
			return e
		}
		version, e = r.SkillVersion(versionID, true)
		if e != nil {
			return e
		}
		if version == nil || version.SkillID != skillID {
			return missing()
		}
		if e = s.skillVersion(version); e != nil {
			return e
		}
		if version.State != "ready" {
			return httpx.E(410, "SKILL_VERSION_DELETED", "技能版本已删除")
		}
		state, e := agents.StateFor(tx)
		if e != nil {
			return e
		}
		file, e = state.File(version.ArchiveFileID, true)
		if e != nil {
			return e
		}
		if file == nil || file.State != "bound" || file.ContentDomain != "system_skill" || file.SizeBytes == nil || file.IntegrityState != "verified" {
			return integrity()
		}
		lease, e = s.newSkillLease(state, "file", file.ID, "skill_archive_download")
		return e
	})
	if e != nil {
		return nil, e
	}
	success := false
	defer func() {
		if !success {
			_ = s.releaseSkillLease(ctx, lease.ID)
		}
	}()
	facts, e := s.Files.Inspect(ctx, file.StorageKey, skillpackage.MaxArchiveBytes)
	if e != nil || facts.Size != *file.SizeBytes || !bytes.Equal(facts.SHA256, file.SHA256) || !bytes.Equal(facts.SHA256, version.ArchiveHash) {
		return nil, httpx.E(409, "SKILL_INTEGRITY_FAILED", "技能包完整性验证失败")
	}
	reader, e := s.Files.Open(file.StorageKey)
	if e != nil {
		return nil, unavailable()
	}
	success = true
	return &SkillDownload{Reader: &leasedSkillReader{ReadCloser: reader, release: func() error { return s.releaseSkillLease(ctx, lease.ID) }}, Filename: fmt.Sprintf("%s-%s.zip", version.Frontmatter.Name, version.Label), MediaType: "application/zip", Size: facts.Size, Auth: out.Auth}, nil
}
