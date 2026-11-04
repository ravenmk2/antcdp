package projectdelivery

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const MaterialLimit = 100 << 20

var materialDirs = map[string]string{"sql": "sql", "object": "objects", "config": "configs", "attachment": "attachments"}

type MaterialInfo struct {
	Kind        string `json:"kind" db:"kind"`
	Filename    string `json:"filename" db:"filename"`
	Description string `json:"description_md" db:"description_md"`
	Repository  string `json:"repository_id" db:"repository_id"`
	Database    string `json:"database_name" db:"database_name"`
	Bucket      string `json:"bucket_name" db:"bucket_name"`
	Target      string `json:"target_path" db:"target_path"`
	Format      string `json:"config_format" db:"config_format"`
	Mode        string `json:"config_mode" db:"config_mode"`
}
type Material struct {
	MaterialInfo
	ID         uint64 `db:"id" json:"id,string"`
	ReleaseID  uint64 `db:"release_id" json:"-"`
	Revision   string `db:"revision_id" json:"revision_id"`
	Number     int    `db:"revision_no" json:"revision_no"`
	Position   int    `db:"position_no" json:"sql_position"`
	FileID     string `db:"file_id" json:"-"`
	StorageKey string `db:"storage_key" json:"-"`
	Size       int64  `db:"size_bytes" json:"size_bytes"`
	Hash       string `db:"sha256" json:"sha256"`
}
type ReleaseRepo struct {
	Connection   uint64 `db:"connection_id" json:"connection_id,string"`
	RemoteID     string `db:"repo_id" json:"remote_id"`
	ProjectRepo  uint64 `db:"project_repository_id" json:"project_repository_id,string"`
	Baseline     string `db:"baseline_sha" json:"baseline_sha"`
	BaselineKind string `db:"baseline_kind" json:"baseline_kind"`
	ID           uint64 `db:"id" json:"id,string"`
	Path         string `db:"repository_path" json:"full_path"`
	Branch       string `db:"branch_name" json:"main_branch"`
}
type MaterialStore interface {
	MaterialRows(uint64) ([]Material, error)
	MaterialHistory(uint64, uint64, Query) ([]Material, int, error)
	MaterialRevision(uint64, uint64, string) (*Material, error)
	MaterialRepos(uint64) ([]ReleaseRepo, error)
	ReserveMaterial(*Material, uint64) error
	BindMaterial(*Material, uint64) error
	RemoveMaterial(uint64, uint64) error
	SortMaterial(uint64, []uint64) error
}

func (m MaterialInfo) validate() error {
	if materialDirs[m.Kind] == "" {
		return httpx.Invalid("kind", "invalid_value")
	}
	if m.Filename == "" || m.Filename == "." || m.Filename == ".." || strings.ContainsAny(m.Filename, "/\\") || strings.IndexFunc(m.Filename, unicode.IsControl) >= 0 || utf8.RuneCountInString(m.Filename) > 255 {
		return httpx.Invalid("filename", "invalid_filename")
	}
	if utf8.RuneCountInString(m.Description) > 16000 || utf8.RuneCountInString(m.Database) > 255 || utf8.RuneCountInString(m.Bucket) > 255 || utf8.RuneCountInString(m.Target) > 1024 {
		return httpx.Invalid("metadata", "invalid_length")
	}
	if m.Kind != "sql" && m.Database != "" || m.Kind != "object" && m.Bucket != "" || m.Kind != "config" && (m.Format != "" || m.Mode != "") || m.Kind != "config" && m.Kind != "object" && m.Target != "" {
		return httpx.Invalid("metadata", "invalid_combination")
	}
	if m.Kind == "object" && strings.TrimSpace(m.Target) == "" {
		return httpx.Invalid("target_path", "required")
	}
	if m.Kind == "config" {
		if !fs.ValidPath(m.Target) || strings.ContainsAny(m.Target, "\\:") || strings.IndexFunc(m.Target, unicode.IsControl) >= 0 || path.Base(m.Target) != m.Filename {
			return httpx.Invalid("target_path", "invalid_path")
		}
		if !slices.Contains([]string{"yaml", "toml", "json", "ini", "properties"}, m.Format) || !slices.Contains([]string{"full", "delta"}, m.Mode) {
			return httpx.Invalid("config_format", "invalid_value")
		}
	}
	return nil
}
func (x *releaseContext) editing() error {
	if x.release.Status != "draft" && x.release.Status != "integrating" {
		return releaseReadOnly()
	}
	return nil
}
func (s *Service) MaterialAccess(ctx context.Context, raw string, cmd Command, rid uint64) (*identity.Auth, error) {
	return s.releaseAccess(ctx, raw, cmd, rid, true, false, func(x *releaseContext) error { return x.editing() })
}
func (s *Service) Materials(ctx context.Context, raw string, cmd Command, rid uint64) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, false, func(x *releaseContext) error {
		store := x.store
		rows, e := store.MaterialRows(rid)
		if e != nil {
			return e
		}
		repos, e := store.MaterialRepos(rid)
		if e != nil {
			return e
		}
		out = i.Result{Data: map[string]any{"items": rows, "repositories": repos, "can_edit": x.project.EndedAt == nil && x.variantData.ArchivedAt == nil && x.editing() == nil}, Tag: x.release.ETag}
		return nil
	})
	return out, a, e
}

// id=0 lists removed items; a specific id lists every saved revision.
func (s *Service) MaterialHistory(ctx context.Context, raw string, cmd Command, rid, id uint64) (i.Result, *identity.Auth, error) {
	var out i.Result
	if e := validateQuery(&cmd.Query); e != nil {
		return out, nil, e
	}
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, false, func(x *releaseContext) error {
		rows, n, e := x.store.MaterialHistory(rid, id, cmd.Query)
		out.Data = Page[Material]{Items: rows, Total: n, Page: cmd.Query.Page, Size: cmd.Query.Size}
		return e
	})
	return out, a, e
}

// Upload bodies are streamed before the short binding transactions, never while holding project locks.
func StageMaterial(root *os.Root, upload string, reader io.Reader) (int64, string, error) {
	dir := path.Join("tmp/uploads/releases", upload)
	if e := root.MkdirAll(dir, 0700); e != nil {
		return 0, "", e
	}
	f, e := root.OpenFile(dir+"/payload.part", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return 0, "", e
	}
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(f, h), io.LimitReader(reader, MaterialLimit+1))
	if e == nil && n > MaterialLimit {
		e = httpx.E(413, "PAYLOAD_TOO_LARGE", "单个文件不能超过 100 MiB")
	}
	if e == nil {
		e = f.Sync()
	}
	if ce := f.Close(); e == nil {
		e = ce
	}
	return n, hex.EncodeToString(h.Sum(nil)), e
}
func (s *Service) SaveMaterial(ctx context.Context, raw string, cmd Command, rid, id uint64, info MaterialInfo, root *os.Root, upload string, size int64, hash string) (i.Result, *identity.Auth, error) {
	var out i.Result
	if e := info.validate(); e != nil {
		return out, nil, e
	}
	if info.Kind == "config" && upload != "" {
		if e := validateConfigFile(root, path.Join("tmp/uploads/releases", upload, "payload.part"), info); e != nil {
			return out, nil, e
		}
	}
	m := Material{MaterialInfo: info, ID: id, ReleaseID: rid, Revision: cryptox.ID(), FileID: upload, Hash: hash, Size: size}
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, false, func(x *releaseContext) error {
		m.ID = id
		if e := x.editing(); e != nil {
			return e
		}
		store := x.store
		if info.Repository != "" {
			repos, e := store.MaterialRepos(rid)
			if e != nil {
				return e
			}
			if !slices.ContainsFunc(repos, func(r ReleaseRepo) bool { return fmt.Sprint(r.ID) == info.Repository }) {
				return httpx.Invalid("repository_id", "out_of_scope")
			}
		}
		if id != 0 {
			prev, e := store.MaterialRevision(rid, id, "")
			if e != nil {
				return e
			}
			if prev == nil {
				return notFound()
			}
			if prev.Kind != info.Kind {
				return httpx.Invalid("kind", "immutable")
			}
			if upload == "" {
				m.FileID = prev.FileID
				m.StorageKey = prev.StorageKey
				m.Hash = prev.Hash
				m.Size = prev.Size
				if m.Kind == "config" && (info.Format != prev.Format || info.Mode != prev.Mode) {
					return httpx.Invalid("content", "required")
				}
			}
			m.Number = prev.Number + 1
		} else if upload == "" {
			return httpx.Invalid("file", "required")
		} else {
			m.Number = 1
		}
		if upload == "" {
			return nil
		}
		if e := store.ReserveMaterial(&m, x.auth.User.ID); e != nil {
			return e
		}
		return nil
	})
	if e != nil {
		return out, a, e
	}
	if upload != "" {
		if e = root.MkdirAll(path.Dir(m.StorageKey), 0700); e == nil {
			e = root.Rename(path.Join("tmp/uploads/releases", upload, "payload.part"), m.StorageKey)
		}
		if e != nil {
			return out, a, e
		}
	}
	a, e = s.releaseAccess(ctx, raw, cmd, rid, true, false, func(x *releaseContext) error {
		if e := x.editing(); e != nil {
			return e
		}
		if e := x.store.BindMaterial(&m, x.auth.User.ID); e != nil {
			return e
		}
		x.release.Version++
		if e := x.store.UpdateRelease(x.release); e != nil {
			return e
		}
		out = i.Result{Data: m, Tag: tag("release", rid, x.release.Version)}
		return x.audit("project_release", rid, x.release.TagName, "material_saved", map[string]any{"item_id": m.ID, "revision": m.Revision}, cmd.Meta)
	})
	return out, a, e
}
func (s *Service) ChangeMaterials(ctx context.Context, raw string, cmd Command, rid, id uint64, order []uint64) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, false, func(x *releaseContext) error {
		if e := x.editing(); e != nil {
			return e
		}
		store := x.store
		action := "material_removed"
		if id != 0 {
			if e := store.RemoveMaterial(rid, id); e != nil {
				return e
			}
		} else {
			action = "sql_reordered"
			if e := store.SortMaterial(rid, order); e != nil {
				return e
			}
		}
		x.release.Version++
		if e := x.store.UpdateRelease(x.release); e != nil {
			return e
		}
		out = i.Result{Data: map[string]bool{"saved": true}, Tag: tag("release", rid, x.release.Version)}
		return x.audit("project_release", rid, x.release.TagName, action, map[string]any{"item_id": id}, cmd.Meta)
	})
	return out, a, e
}
func (s *Service) DownloadMaterial(ctx context.Context, raw string, cmd Command, rid, id uint64, rev string) (*Material, *identity.Auth, error) {
	var m *Material
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, false, func(x *releaseContext) error {
		var e error
		m, e = x.store.MaterialRevision(rid, id, rev)
		if e != nil {
			return e
		}
		if m == nil {
			return notFound()
		}
		return nil
	})
	return m, a, e
}
