package integrations

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RepositoryLabel struct {
	ID    uint64 `db:"id" json:"id,string"`
	Code  string `db:"code" json:"code"`
	Name  string `db:"name" json:"name"`
	Color string `db:"color" json:"color"`
}
type RepositoryLabelDefinition struct {
	RepositoryLabel
	RepositoryCount int `db:"repository_count" json:"repository_count"`
}
type RepositoryLabelWrite struct {
	Code  Field[string] `json:"code"`
	Name  Field[string] `json:"name"`
	Color Field[string] `json:"color"`
}
type RepositoryLabelsWrite struct {
	IDs Field[[]string] `json:"label_ids"`
}
type RepositoryLabelStore interface {
	RepositoryLabels(uint64) ([]RepositoryLabelDefinition, error)
	SaveRepositoryLabel(uint64, uint64, *RepositoryLabel, bool) error
	DeleteRepositoryLabel(uint64, uint64) error
	SetRepositoryLabels(uint64, uint64, []uint64) error
}

var labelCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var labelColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func normalizeRepositoryLabel(w RepositoryLabelWrite, current RepositoryLabel, create bool) (RepositoryLabel, error) {
	if !create && w.Code.Set {
		return current, httpx.Invalid("code", "immutable")
	}
	if create && (!w.Code.Set || w.Code.Null || !labelCodePattern.MatchString(w.Code.Value)) {
		return current, httpx.Invalid("code", "invalid_format")
	}
	if create {
		current.Code = w.Code.Value
	}
	if w.Name.Null || create && !w.Name.Set {
		return current, httpx.Invalid("name", "required")
	}
	if w.Name.Set {
		current.Name = strings.TrimSpace(w.Name.Value)
	}
	if !utf8.ValidString(current.Name) || current.Name == "" || utf8.RuneCountInString(current.Name) > 100 || strings.ContainsFunc(current.Name, unicode.IsControl) {
		return current, httpx.Invalid("name", "invalid_value")
	}
	if w.Color.Null || create && !w.Color.Set {
		return current, httpx.Invalid("color", "required")
	}
	if w.Color.Set {
		current.Color = strings.ToUpper(w.Color.Value)
	}
	if !labelColorPattern.MatchString(current.Color) {
		return current, httpx.Invalid("color", "invalid_format")
	}
	return current, nil
}

func (s *Service) RepositoryLabels(ctx context.Context, raw string, pid uint64) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.projectRepoAccess(ctx, raw, pid, false, func(_ identity.Tx, _ Repository, r ProjectRepoStore, _ *identity.Auth, _ *c.Resource) error {
		store, ok := r.(RepositoryLabelStore)
		if !ok {
			return integrity()
		}
		rows, err := store.RepositoryLabels(pid)
		if err != nil {
			return err
		}
		version, err := r.RepoVersion(pid)
		if err != nil {
			return err
		}
		tag := s.repoTag(pid, version)
		out = Result{Data: map[string]any{"items": rows, "mutation_version": tag}, CollectionTag: tag}
		return nil
	})
	return out, a, e
}

func (s *Service) WriteRepositoryLabel(ctx context.Context, raw string, pid, id uint64, w RepositoryLabelWrite, remove bool, tag string, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.projectRepoAccess(ctx, raw, pid, true, func(tx identity.Tx, _ Repository, r ProjectRepoStore, a *identity.Auth, _ *c.Resource) error {
		store, ok := r.(RepositoryLabelStore)
		if !ok {
			return integrity()
		}
		version, err := r.RepoVersion(pid)
		if err != nil {
			return err
		}
		if err = check(tag, s.repoTag(pid, version)); err != nil {
			return err
		}
		rows, err := store.RepositoryLabels(pid)
		if err != nil {
			return err
		}
		var current RepositoryLabel
		for _, v := range rows {
			if v.ID == id {
				current = v.RepositoryLabel
			}
		}
		if id != 0 && current.ID == 0 {
			return fail()
		}
		next := current
		action := "updated"
		if remove {
			if err = store.DeleteRepositoryLabel(pid, id); err != nil {
				return err
			}
			action = "deleted"
		} else {
			next, err = normalizeRepositoryLabel(w, current, id == 0)
			if err != nil {
				return err
			}
			for _, v := range rows {
				if v.Code == next.Code && v.ID != id {
					return httpx.E(409, "LABEL_CODE_EXISTS", "标签编码已存在")
				}
			}
			if next != current {
				if err = store.SaveRepositoryLabel(pid, a.User.ID, &next, id == 0); err != nil {
					return err
				}
				if id == 0 {
					action = "created"
				}
			}
		}
		if remove || next != current {
			if err = r.BumpRepos(pid); err != nil {
				return err
			}
			version++
			if err = audit(tx, a, "project_repository_label", next.ID, next.Name, action, map[string]any{"project_id": fmt.Sprint(pid), "code": next.Code, "name": next.Name, "color": next.Color}, meta); err != nil {
				return err
			}
		}
		resultTag := s.repoTag(pid, version)
		out = Result{Data: map[string]any{"item": next, "removed": remove, "mutation_version": resultTag}, CollectionTag: resultTag}
		return nil
	})
	return out, a, e
}

func (s *Service) SetRepositoryLabels(ctx context.Context, raw string, pid, rid uint64, w RepositoryLabelsWrite, tag string, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	if !w.IDs.Set || w.IDs.Null {
		return out, nil, httpx.Invalid("label_ids", "required")
	}
	ids := make([]uint64, 0, len(w.IDs.Value))
	seen := map[uint64]bool{}
	for _, rawID := range w.IDs.Value {
		id, e := c.ID(rawID)
		if e != nil || seen[id] {
			return out, nil, httpx.Invalid("label_ids", "invalid_or_duplicate")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	slices.Sort(ids)
	a, e := s.projectRepoAccess(ctx, raw, pid, true, func(tx identity.Tx, _ Repository, r ProjectRepoStore, a *identity.Auth, _ *c.Resource) error {
		store, ok := r.(RepositoryLabelStore)
		if !ok {
			return integrity()
		}
		row, err := r.ProjectRepo(pid, rid)
		if err != nil {
			return err
		}
		if row == nil {
			return fail()
		}
		s.decorateRepo(row)
		if err = check(tag, row.ETag); err != nil {
			return err
		}
		labels, err := store.RepositoryLabels(pid)
		if err != nil {
			return err
		}
		valid := map[uint64]bool{}
		for _, v := range labels {
			valid[v.ID] = true
		}
		for _, id := range ids {
			if !valid[id] {
				return httpx.Invalid("label_ids", "unavailable")
			}
		}
		old := make([]uint64, 0, len(row.Labels))
		for _, v := range row.Labels {
			old = append(old, v.ID)
		}
		slices.Sort(old)
		if !slices.Equal(old, ids) {
			if err = store.SetRepositoryLabels(pid, rid, ids); err != nil {
				return err
			}
			if err = r.BumpRepos(pid); err != nil {
				return err
			}
			if err = audit(tx, a, "project_repository", rid, row.FullPath, "labels_updated", map[string]any{"project_id": fmt.Sprint(pid), "label_ids": w.IDs.Value}, meta); err != nil {
				return err
			}
			row, err = r.ProjectRepo(pid, rid)
			if err != nil {
				return err
			}
			s.decorateRepo(row)
		}
		version, err := r.RepoVersion(pid)
		if err != nil {
			return err
		}
		out = Result{Data: row, Tag: row.ETag, CollectionTag: s.repoTag(pid, version)}
		return nil
	})
	return out, a, e
}
