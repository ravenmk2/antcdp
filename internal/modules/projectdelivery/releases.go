package projectdelivery

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Release struct {
	Manifest       *uint64         `db:"current_manifest_id" json:"current_manifest_id,string,omitempty"`
	EndReason      string          `db:"end_reason" json:"end_reason,omitempty"`
	ID             uint64          `db:"id" json:"id,string"`
	Name           string          `db:"name" json:"name"`
	VersionLabel   string          `db:"version_label" json:"version_label"`
	TagName        string          `db:"tag_name" json:"tag_name"`
	Description    string          `db:"description_md" json:"description_md"`
	Status         string          `db:"status" json:"status"`
	NeedsAttention bool            `db:"needs_attention" json:"needs_attention"`
	Version        uint64          `db:"row_version" json:"-"`
	Snapshot       json.RawMessage `db:"variant_snapshot" json:"-"`
	Updated        time.Time       `db:"updated_at" json:"updated_at"`
	ETag           string          `db:"-" json:"etag"`
}
type ReleaseStore interface {
	WorkflowStore
	MaterialStore
	SnapshotReleaseRepos(uint64, string, []ScopedRepo) error
	Releases(uint64, Query) ([]Release, int, error)
	Release(uint64, uint64) (*Release, error)
	SetReleasePrefix(uint64, string) error
	CreateRelease(uint64, uint64, uint64, *Release) error
	UpdateRelease(*Release) error
}
type ReleaseWrite struct {
	Name         i.Field[string] `json:"name"`
	VersionLabel i.Field[string] `json:"version_label"`
	Description  i.Field[string] `json:"description_md"`
}

var releaseVersion = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$`)
var releasePrefix = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$`)

func normalizeReleaseName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 120 {
		return "", httpx.Invalid("name", "invalid_length")
	}
	for _, r := range value {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return "", httpx.Invalid("name", "invalid_format")
		}
	}
	return value, nil
}

type releaseContext struct {
	*access
	variantData *Variant
	release     *Release
	store       ReleaseStore
}

func (s *Service) releaseAccess(ctx context.Context, raw string, cmd Command, rid uint64, write, admin bool, fn func(*releaseContext) error) (*identity.Auth, error) {
	return s.access(ctx, raw, cmd.ProjectID, admin, func(x *access) error {
		v, e := x.variant(cmd.VariantID, write, false)
		if e != nil {
			return e
		}
		if write && x.project.EndedAt != nil {
			return httpx.E(409, "PROJECT_ARCHIVED", "项目已归档")
		}
		store, ok := x.tx.(ReleaseStore)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "发布管理暂不可用")
		}
		rc := &releaseContext{access: x, variantData: v, store: store}
		if rid != 0 {
			rc.release, e = store.Release(v.ID, rid)
			if e != nil {
				return e
			}
			if rc.release == nil {
				return notFound()
			}
			rc.release.ETag = tag("release", rid, rc.release.Version)
			if write {
				if e = match(cmd.Tag, rc.release.ETag); e != nil {
					return e
				}
			}
		}
		return fn(rc)
	})
}
func (s *Service) ReleaseSettings(ctx context.Context, raw string, cmd Command, prefix string) (i.Result, *identity.Auth, error) {
	var out i.Result
	a, e := s.releaseAccess(ctx, raw, cmd, 0, true, true, func(x *releaseContext) error {
		v := x.variantData
		if e := match(cmd.Tag, tag("project-variant", v.ID, v.Version)); e != nil {
			return e
		}
		if !releasePrefix.MatchString(prefix) || !ValidBranch(prefix+"1") {
			return httpx.Invalid("tag_prefix", "invalid_tag")
		}
		if e := x.store.SetReleasePrefix(v.ID, prefix); e != nil {
			return e
		}
		out = i.Result{Data: map[string]string{"tag_prefix": prefix}, Tag: tag("project-variant", v.ID, v.Version+1)}
		return x.audit("project_variant", v.ID, v.Name, "release_settings", map[string]string{"tag_prefix": prefix}, cmd.Meta)
	})
	return out, a, e
}
func (s *Service) Releases(ctx context.Context, raw string, cmd Command, rid uint64, w *ReleaseWrite) (i.Result, *identity.Auth, error) {
	var out i.Result
	if e := validateQuery(&cmd.Query); e != nil {
		return out, nil, e
	}
	a, e := s.releaseAccess(ctx, raw, cmd, rid, w != nil, w != nil && rid == 0, func(x *releaseContext) error {
		v := x.variantData
		if w == nil && rid == 0 {
			rows, total, e := x.store.Releases(v.ID, cmd.Query)
			if e != nil {
				return e
			}
			for n := range rows {
				rows[n].ETag = tag("release", rows[n].ID, rows[n].Version)
			}
			out.Data = Page[Release]{Items: rows, Total: total, Page: cmd.Query.Page, Size: cmd.Query.Size, CanManage: x.manage && v.ArchivedAt == nil}
			return nil
		}
		r := x.release
		if w != nil {
			action := "updated"
			if rid == 0 {
				if v.ReleaseTagPrefix == "" {
					return httpx.Invalid("tag_prefix", "required")
				}
				snap, e := json.Marshal(map[string]string{"tag_prefix": v.ReleaseTagPrefix, "variant_name": v.Name, "variant_code": v.Code, "project_name": x.project.Name, "project_code": x.project.Code})
				if e != nil {
					return e
				}
				r = &Release{Snapshot: snap, Status: "draft", Version: 1}
				action = "created"
			} else if r.Status != "draft" && r.Status != "integrating" {
				return releaseReadOnly()
			}
			if w.Name.Set {
				if !x.manage {
					return httpx.E(403, "FORBIDDEN", "仅项目管理员可编辑发布名称")
				}
				if w.Name.Null {
					return httpx.Invalid("name", "invalid_format")
				}
				name, err := normalizeReleaseName(w.Name.Value)
				if err != nil {
					return err
				}
				r.Name = name
			}
			if w.VersionLabel.Set || rid == 0 {
				if !x.manage {
					return httpx.E(403, "FORBIDDEN", "仅项目管理员可编辑版本号")
				}
				if r.Status != "draft" {
					return releaseReadOnly()
				}
				if !releaseVersion.MatchString(w.VersionLabel.Value) {
					return httpx.Invalid("version_label", "invalid_version")
				}
				var snap struct {
					Prefix string `json:"tag_prefix"`
				}
				if e := json.Unmarshal(r.Snapshot, &snap); e != nil {
					return e
				}
				r.VersionLabel = w.VersionLabel.Value
				r.TagName = snap.Prefix + r.VersionLabel
				if !ValidBranch(r.TagName) {
					return httpx.Invalid("version_label", "invalid_tag")
				}
			}
			if w.Description.Set {
				if w.Description.Null || utf8.RuneCountInString(w.Description.Value) > 16000 {
					return httpx.Invalid("description_md", "invalid_length")
				}
				r.Description = w.Description.Value
			}
			var e error
			if rid == 0 {
				e = x.store.CreateRelease(cmd.ProjectID, v.ID, x.auth.User.ID, r)
				if e == nil {
					repos, err := x.allRepos()
					if err != nil {
						return err
					}
					e = x.store.SnapshotReleaseRepos(r.ID, v.Branch, Evaluate(v.Scope, repos))
				}
			} else {
				r.Version++
				e = x.store.UpdateRelease(r)
			}
			if e != nil {
				return e
			}
			if e = x.audit("project_release", r.ID, r.TagName, action, map[string]string{"name": r.Name, "version_label": r.VersionLabel}, cmd.Meta); e != nil {
				return e
			}
		}
		r.ETag = tag("release", r.ID, r.Version)
		out = i.Result{Data: r, Tag: r.ETag}
		return nil
	})
	if e == nil && rid == 0 && w != nil {
		release := out.Data.(*Release)
		captureCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		defer cancel()
		var rows []ReleaseRepo
		_, readErr := s.releaseAccess(captureCtx, raw, cmd, release.ID, false, false, func(x *releaseContext) error {
			var err error
			rows, err = x.store.MaterialRepos(release.ID)
			return err
		})
		if readErr == nil {
			for _, repo := range rows {
				if captureCtx.Err() != nil {
					break
				}
				cmd.Tag = release.ETag
				updated, _, err := s.GitInput(captureCtx, raw, cmd, release.ID, "baseline", FlowWrite{Repo: repo.ID})
				if err == nil {
					release.Version++
					release.ETag = updated.Tag
					out.Tag = updated.Tag
				}
			}
		}
	}
	return out, a, e
}
func releaseReadOnly() error {
	return httpx.E(409, "RELEASE_READ_ONLY", "当前发布状态不可编辑")
}
