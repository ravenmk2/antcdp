package projectdelivery

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RepoReview struct {
	FrozenRepo
	Extra    []i.ReleaseCommit `json:"extra"`
	Problems []string          `json:"problems"`
}
type FreezePreview struct {
	Repositories []RepoReview `json:"repositories"`
	Problems     []string     `json:"problems"`
	Token        string       `json:"preview_token"`
}

func reviewRepo(ctx context.Context, t gitTarget, changes []ReleaseChange) (RepoReview, []ReleaseChange, error) {
	out := RepoReview{FrozenRepo: FrozenRepo{ReleaseRepo: t.Repo}, Extra: []i.ReleaseCommit{}, Problems: []string{}}
	head, e := t.Git.Head(ctx, t.Repo.Branch)
	if e != nil {
		return out, nil, e
	}
	out.SHA = head
	if t.Repo.Baseline == "" {
		return out, nil, repoLabel(t.Repo, "请先确认基线")
	}
	delta, e := t.Git.Range(ctx, t.Repo.Baseline, head)
	if e != nil {
		return out, nil, e
	}
	inRange := map[string]bool{}
	for _, c := range delta {
		inRange[c.ID] = true
	}
	accounted := map[string]bool{}
	reverts := map[uint64]bool{}
	items := []ReleaseChange{}
	for _, v := range changes {
		if v.Repo != t.Repo.ID || v.Status == "removed" {
			continue
		}
		if v.Kind == "commit" {
			if !inRange[v.Ref] {
				out.Problems = append(out.Problems, "补录的提交不在本次差异范围："+v.Ref)
			}
			accounted[v.Ref] = true
			items = append(items, v)
			continue
		}
		iid, e := strconv.ParseUint(v.Ref, 10, 64)
		if e != nil {
			return out, nil, e
		}
		m, e := t.Git.MR(ctx, iid)
		if e != nil {
			return out, nil, e
		}
		v.Evidence = jsonData(m)
		result := m.MergeSHA
		if result == "" {
			result = m.SquashSHA
		}
		if result == "" {
			result = m.Head
		}
		if m.State != "merged" || m.Target != t.Repo.Branch || !inRange[result] {
			out.Problems = append(out.Problems, "MR !"+v.Ref+" 尚未核实合入本次主干差异")
			items = append(items, v)
			continue
		}
		commits, e := t.Git.MRCommits(ctx, iid)
		if e != nil {
			return out, nil, e
		}
		accounted[result] = true
		accounted[m.SquashSHA] = true
		for _, c := range commits {
			accounted[c.ID] = true
		}
		reverts[v.ID] = true
		v.Status = "included"
		items = append(items, v)
	}
	for j := range items {
		if items[j].RevertedBy != 0 {
			if reverts[items[j].RevertedBy] {
				items[j].Status = "reverted"
			} else {
				out.Problems = append(out.Problems, "关联回退 MR 尚未合入")
			}
		}
	}
	for _, c := range delta {
		if !accounted[c.ID] {
			out.Extra = append(out.Extra, c)
		}
	}
	out.Observed = time.Now().UTC()
	return out, items, nil
}
func (s *Service) Freeze(ctx context.Context, raw string, cmd Command, rid uint64, token string, save bool, root *os.Root) (i.Result, *identity.Auth, error) {
	var out i.Result
	var targets []gitTarget
	var changes []ReleaseChange
	var materials []Material
	var r Release
	a, e := s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		if e := x.state("integrating"); e != nil {
			return e
		}
		if err := x.noRemoteInFlight(); err != nil {
			return err
		}
		r = *x.release
		rows, e := x.store.MaterialRepos(rid)
		if e != nil {
			return e
		}
		for _, repo := range rows {
			g, e := s.Integrations.ReleaseGit(x.tx, x.auth.User.ID, repo.Connection, repo.RemoteID)
			if e != nil {
				return e
			}
			targets = append(targets, gitTarget{repo, g})
		}
		changes, e = x.store.ReleaseChanges(rid)
		if e != nil {
			return e
		}
		materials, e = x.store.MaterialRows(rid)
		return e
	})
	if e != nil {
		return out, a, e
	}
	preview := FreezePreview{Repositories: []RepoReview{}, Problems: []string{}}
	entries := []FrozenEntry{}
	heads := map[uint64]string{}
	for _, t := range targets {
		repo, items, e := reviewRepo(ctx, t, changes)
		if e != nil {
			return out, a, e
		}
		preview.Repositories = append(preview.Repositories, repo)
		heads[t.Repo.ID] = repo.SHA
		entries = append(entries, FrozenEntry{Kind: "repository", Subject: repo.ID, Data: jsonData(repo.FrozenRepo)})
		for _, v := range items {
			entries = append(entries, FrozenEntry{Kind: "change", Subject: v.ID, Data: jsonData(v)})
		}
	}
	conflicts, e := materialConflicts(root, materials)
	if e != nil {
		return out, a, e
	}
	preview.Problems = append(preview.Problems, conflicts...)
	for _, m := range materials {
		entries = append(entries, FrozenEntry{Kind: "item", Subject: m.ID, Revision: m.Revision, Position: m.Position, Data: jsonData(m)})
	}
	preview.Token = digest([]any{rid, r.Version, heads})
	if !save {
		return i.Result{Data: preview, Tag: r.ETag}, a, nil
	}
	if token == "" || token != preview.Token {
		return out, a, changed()
	}
	if len(preview.Problems) > 0 {
		return out, a, releaseBlocked(preview.Problems[0])
	}
	for _, repo := range preview.Repositories {
		if len(repo.Problems)+len(repo.Extra) > 0 {
			return out, a, repoLabel(repo.ReleaseRepo, "仍有未处置的合并请求或额外提交")
		}
	}
	for _, t := range targets {
		head, e := t.Git.Head(ctx, t.Repo.Branch)
		if e != nil {
			return out, a, e
		}
		if heads[t.Repo.ID] != head {
			return out, a, changed()
		}
	}
	a, e = s.releaseAccess(ctx, raw, cmd, rid, true, true, func(x *releaseContext) error {
		if e := x.noRemoteInFlight(); e != nil {
			return e
		}
		m := Manifest{Header: jsonData(map[string]any{"release_id": fmt.Sprint(rid), "variant": r.Snapshot, "name": r.Name, "version_label": r.VersionLabel, "tag_name": r.TagName, "description_md": r.Description}), Created: time.Now().UTC()}
		m.Digest = digest([]any{m.Header, entries})
		for _, entry := range entries {
			if entry.Kind == "change" {
				var c ReleaseChange
				if err := json.Unmarshal(entry.Data, &c); err != nil {
					return err
				}
				if err := x.store.SaveChange(rid, x.auth.User.ID, &c); err != nil {
					return err
				}
			}
		}
		if e := x.store.FreezeRelease(x.release, &m, entries, x.auth.User.ID); e != nil {
			return e
		}
		if e := x.touch(cmd, "frozen", map[string]any{"manifest_id": m.ID, "digest": m.Digest}); e != nil {
			return e
		}
		out.Data = m
		out.Tag = tag("release", rid, x.release.Version)
		return nil
	})
	return out, a, e
}
func (x *releaseContext) noRemoteInFlight() error {
	ops, e := x.store.Operations(x.release.ID)
	if e != nil {
		return e
	}
	if len(ops) > 0 && (ops[0].Status == "running" || ops[0].Status == "unknown") {
		return releaseBlocked("远端操作尚未核实")
	}
	return nil
}

type ManifestDownload struct {
	Manifest Manifest      `json:"manifest"`
	Entries  []FrozenEntry `json:"entries"`
	Files    []Material    `json:"-"`
}

func (s *Service) ManifestData(ctx context.Context, raw string, cmd Command, rid, mid uint64) (ManifestDownload, *identity.Auth, error) {
	var data ManifestDownload
	a, e := s.releaseAccess(ctx, raw, cmd, rid, false, false, func(x *releaseContext) error {
		ms, e := x.store.ReleaseManifests(rid)
		if e != nil {
			return e
		}
		for _, m := range ms {
			if m.ID == mid {
				data.Manifest = m
				break
			}
		}
		if data.Manifest.ID == 0 {
			return notFound()
		}
		data.Entries, e = x.store.Entries(mid)
		if e != nil {
			return e
		}
		for _, item := range data.Entries {
			if item.Kind == "item" {
				m, e := x.store.MaterialRevision(rid, item.Subject, item.Revision)
				if e != nil {
					return e
				}
				if m == nil {
					return notFound()
				}
				m.Position = item.Position
				data.Files = append(data.Files, *m)
			}
		}
		return nil
	})
	return data, a, e
}
func archiveName(m Material) string {
	name := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, m.Filename)
	name = strings.TrimRight(name, ". ")
	if name == "" {
		name = "payload"
	}
	stem := strings.ToUpper(strings.Split(name, ".")[0])
	switch stem {
	case "CON", "NUL", "AUX", "PRN", "CONIN$", "CONOUT$":
		name = "_" + name
	}
	if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) {
		name = "_" + name
	}
	dir := fmt.Sprint(m.ID)
	if m.Kind == "sql" {
		dir = fmt.Sprintf("%03d-%d", m.Position, m.ID)
	}
	return path.Join(materialDirs[m.Kind], dir, name)
}
func (d ManifestDownload) WriteZip(root *os.Root, w io.Writer) error {
	for _, m := range d.Files {
		f, e := root.Open(m.StorageKey)
		if e != nil {
			return e
		}
		info, e := f.Stat()
		_ = f.Close()
		if e != nil || !info.Mode().IsRegular() || info.Size() != m.Size {
			return httpx.E(500, "FILE_INTEGRITY", "归档原件缺失或损坏")
		}
	}
	z := zip.NewWriter(w)
	var header struct {
		Name        string `json:"name"`
		Version     string `json:"version_label"`
		Description string `json:"description_md"`
	}
	if e := json.Unmarshal(d.Manifest.Header, &header); e != nil {
		return e
	}
	var readme strings.Builder
	title := header.Name
	if title == "" {
		title = header.Version
	}
	fmt.Fprintf(&readme, "# %s\n\n%s\n", title, header.Description)
	for _, m := range d.Files {
		filename := archiveName(m)
		fmt.Fprintf(&readme, "\n## %s\n\n%s\n\n目标 %s %s %s\n", filename, m.Description, m.Database, m.Bucket, m.Target)
		f, e := root.Open(m.StorageKey)
		if e != nil {
			return e
		}
		dest, e := z.Create(filename)
		if e != nil {
			_ = f.Close()
			return e
		}
		h := sha256.New()
		n, e := io.Copy(io.MultiWriter(dest, h), f)
		_ = f.Close()
		if e != nil {
			return e
		}
		if n != m.Size || hex.EncodeToString(h.Sum(nil)) != m.Hash {
			return fmt.Errorf("file integrity check failed for item %d", m.ID)
		}
	}
	f, e := z.Create("README.md")
	if e != nil {
		return e
	}
	if _, e = io.WriteString(f, readme.String()); e != nil {
		return e
	}
	f, e = z.Create("manifest.json")
	if e != nil {
		return e
	}
	paths := map[string]string{}
	for _, m := range d.Files {
		paths[m.Revision] = archiveName(m)
	}
	if e = json.NewEncoder(f).Encode(struct {
		ManifestDownload
		Paths map[string]string `json:"revision_paths"`
	}{d, paths}); e != nil {
		return e
	}
	return z.Close()
}
