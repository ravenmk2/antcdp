package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RepoInfo struct {
	RepoID    string  `db:"repo_id" json:"repo_id"`
	Name      string  `db:"name" json:"name"`
	Namespace string  `db:"namespace_path" json:"namespace_path"`
	FullPath  string  `db:"full_path" json:"full_path"`
	WebURL    *string `db:"web_url" json:"web_url"`
	HTTPURL   *string `db:"http_clone_url" json:"http_clone_url"`
	SSHURL    *string `db:"ssh_clone_url" json:"ssh_clone_url"`
	Branch    *string `db:"default_branch" json:"default_branch"`
	Archived  *bool   `db:"remote_archived" json:"remote_archived"`
	Linked    bool    `db:"-" json:"already_linked"`
}
type ProjectRepo struct {
	RepoInfo
	ID                uint64    `db:"id" json:"id,string"`
	ProjectID         uint64    `db:"project_id" json:"project_id,string"`
	ConnectionID      uint64    `db:"connection_id" json:"connection_id,string"`
	ConnectionName    string    `db:"connection_name" json:"connection_name"`
	ServiceType       string    `db:"service_type" json:"service_type"`
	ConnectionEnabled bool      `db:"connection_enabled" json:"connection_enabled"`
	SyncedAt          time.Time `db:"last_synced_at" json:"last_synced_at"`
	Version           uint64    `db:"row_version" json:"-"`
	Creator           uint64    `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt         time.Time `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time `db:"updated_at" json:"updated_at"`
	ETag              string    `db:"-" json:"etag"`
}
type RepoQuery struct {
	Search       string
	ConnectionID uint64
	Page, Size   int
}
type RepoPage struct {
	Items           []ProjectRepo `json:"items"`
	Total           int           `json:"total"`
	Page            int           `json:"page"`
	Size            int           `json:"page_size"`
	MutationVersion string        `json:"mutation_version"`
}
type ProjectRepoStore interface {
	RepoVersion(uint64) (uint64, error)
	ProjectRepos(uint64, RepoQuery) (RepoPage, error)
	ProjectRepo(uint64, uint64) (*ProjectRepo, error)
	LinkedRepoIDs(uint64, uint64) ([]string, error)
	InsertProjectRepo(*ProjectRepo) error
	SaveProjectRepo(*ProjectRepo) error
	DeleteProjectRepo(uint64, uint64) error
	BumpRepos(uint64) error
	ConnectionRepoCount(uint64) (int, error)
	RepoDiagnostic(uint64) (json.RawMessage, error)
	SaveRepoDiagnostic(uint64, json.RawMessage) error
}
type RepoWrite struct {
	ConnectionID string   `json:"connection_id"`
	RepoIDs      []string `json:"repo_ids"`
	IDs          []string `json:"ids"`
}

func (s *Service) repoTag(p, v uint64) string { return s.tag("project-repositories", p, "/", v) }
func (s *Service) decorateRepo(v *ProjectRepo) {
	v.ETag = s.tag("project-repository", v.ID, "/", v.Version)
}
func (s *Service) projectRepoAccess(ctx context.Context, raw string, pid uint64, write bool, fn func(identity.Tx, Repository, ProjectRepoStore, *identity.Auth, *c.Resource) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		if write && a.User.Role != "admin" {
			return forbidden()
		}
		cr, ok := tx.(c.Repository)
		if !ok {
			return integrity()
		}
		r, e := repo(tx)
		if e != nil {
			return e
		}
		pr, ok := tx.(ProjectRepoStore)
		if !ok {
			return integrity()
		}
		if e = cr.LockCollaboration(c.Project, pid, 0); e != nil {
			return e
		}
		p, e := cr.Resource(c.Project, pid, a.User.ID)
		if e != nil {
			return e
		}
		if p == nil || (!p.IsMember && a.User.Role != "admin") {
			return fail()
		}
		if write && p.EndedAt != nil {
			return httpx.E(409, "PROJECT_ARCHIVED", "归档项目只读")
		}
		return fn(tx, r, pr, a, p)
	})
}
func (s *Service) ProjectRepoList(ctx context.Context, raw string, pid uint64, q RepoQuery) (Result, *identity.Auth, error) {
	var out Result
	if q.Page < 1 || q.Page > 1000000 || q.Size < 1 || q.Size > 100 || utf8.RuneCountInString(q.Search) > 100 {
		return out, nil, httpx.Invalid("query", "invalid_value")
	}
	a, e := s.projectRepoAccess(ctx, raw, pid, false, func(_ identity.Tx, _ Repository, r ProjectRepoStore, _ *identity.Auth, _ *c.Resource) error {
		v, e := r.RepoVersion(pid)
		if e != nil {
			return e
		}
		page, e := r.ProjectRepos(pid, q)
		if e != nil {
			return e
		}
		for i := range page.Items {
			s.decorateRepo(&page.Items[i])
		}
		tag := s.repoTag(pid, v)
		page.MutationVersion = tag
		out = Result{Data: page, CollectionTag: tag}
		return nil
	})
	return out, a, e
}
func (s *Service) RepoConnections(ctx context.Context, raw string, pid uint64) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.projectRepoAccess(ctx, raw, pid, true, func(_ identity.Tx, r Repository, _ ProjectRepoStore, _ *identity.Auth, _ *c.Resource) error {
		rows, e := r.Connections()
		if e != nil {
			return e
		}
		items := []map[string]any{}
		for _, v := range rows {
			if v.Type == "gitlab" {
				items = append(items, map[string]any{"id": fmt.Sprint(v.ID), "name": v.Name, "service_type": v.Type, "enabled": v.Enabled})
			}
		}
		out.Data = map[string]any{"items": items}
		return nil
	})
	return out, a, e
}

type repoSnapshot struct {
	Connection     ServiceConnection
	Credential     ServiceCredential
	ProjectVersion uint64
	Actor          uint64
	Token          string
}

func (s *Service) repoSnapshot(r Repository, id uint64, decrypt bool) (repoSnapshot, error) {
	var snap repoSnapshot
	v, e := r.Connection(id)
	if e != nil {
		return snap, e
	}
	if v == nil || v.Type != "gitlab" {
		return snap, fail()
	}
	if !v.Enabled {
		return snap, httpx.E(409, "RESOURCE_DISABLED", "服务连接已停用")
	}
	g, e := config(r, v)
	if e != nil {
		return snap, e
	}
	v.Config = *g
	creds, e := r.Credentials(id, CredentialOwnership{Type: "system"})
	if e != nil {
		return snap, e
	}
	var selected *ServiceCredential
	for j := range creds {
		if creds[j].Preferred {
			if selected != nil {
				return snap, integrity()
			}
			selected = &creds[j]
		}
	}
	if selected == nil {
		return snap, httpx.E(409, "SYSTEM_PREFERRED_REQUIRED", "请先为该连接设置系统首选凭证")
	}
	if !selected.Usable() {
		return snap, unavailable()
	}
	snap.Connection = *v
	snap.Credential = *selected
	if decrypt {
		sealed, e := r.Secret("credential", selected.ID)
		if e != nil {
			return snap, e
		}
		snap.Token, e = s.Cipher(credentialPurpose(v.Type, "credential", id, selected.ID, selected.AuthMethod), sealed, false)
		if e != nil {
			return snap, e
		}
	}
	return snap, nil
}
func sameRepoSnapshot(x, y repoSnapshot) bool {
	return x.Connection.Version == y.Connection.Version && x.Connection.ConfigVersion == y.Connection.ConfigVersion && x.Connection.CredentialsVersion == y.Connection.CredentialsVersion && x.Credential.ID == y.Credential.ID && x.Credential.Version == y.Credential.Version && x.Credential.MaterialVersion == y.Credential.MaterialVersion
}
func (s *Service) repoStart(ctx context.Context, raw string, pid, cid uint64) (repoSnapshot, *identity.Auth, error) {
	var snap repoSnapshot
	a, e := s.projectRepoAccess(ctx, raw, pid, true, func(_ identity.Tx, r Repository, _ ProjectRepoStore, a *identity.Auth, p *c.Resource) error {
		var e error
		snap, e = s.repoSnapshot(r, cid, true)
		snap.ProjectVersion = p.Version
		snap.Actor = a.User.ID
		return e
	})
	return snap, a, e
}
func repoSlot() (func(), error) {
	select {
	case outboundSlots <- struct{}{}:
		return func() { <-outboundSlots }, nil
	default:
		return nil, httpx.E(429, "RATE_LIMITED", "仓库查询繁忙，请稍后重试")
	}
}
func validateRepoIDs(ids []string) error {
	if len(ids) < 1 || len(ids) > 100 {
		return httpx.Invalid("repo_ids", "invalid_count")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if _, e := c.ID(id); e != nil || seen[id] {
			return httpx.Invalid("repo_ids", "invalid_or_duplicate")
		}
		seen[id] = true
	}
	return nil
}
func (s *Service) LinkRepos(ctx context.Context, raw string, pid uint64, w RepoWrite, tag string, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	if len(w.IDs) > 0 {
		return out, nil, httpx.Invalid("ids", "unsupported")
	}
	if e := validateRepoIDs(w.RepoIDs); e != nil {
		return out, nil, e
	}
	cid, e := c.ID(w.ConnectionID)
	if e != nil {
		return out, nil, e
	}
	release, e := repoSlot()
	if e != nil {
		return out, nil, e
	}
	defer release()
	snap, a, e := s.repoStart(ctx, raw, pid, cid)
	if e != nil {
		return out, a, e
	}
	// Check stale clients before expensive external requests; repeat under the commit lock.
	a, e = s.projectRepoAccess(ctx, raw, pid, true, func(_ identity.Tx, _ Repository, r ProjectRepoStore, _ *identity.Auth, _ *c.Resource) error {
		v, e := r.RepoVersion(pid)
		if e != nil {
			return e
		}
		return check(tag, s.repoTag(pid, v))
	})
	if e != nil {
		return out, a, e
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	infos := make([]RepoInfo, 0, len(w.RepoIDs))
	for _, id := range w.RepoIDs {
		v, e := getGitLabRepo(ctx, &snap.Connection.Config, snap.Token, id)
		if e != nil {
			return out, a, e
		}
		infos = append(infos, v)
	}
	a, e = s.projectRepoAccess(ctx, raw, pid, true, func(tx identity.Tx, r Repository, pr ProjectRepoStore, a *identity.Auth, p *c.Resource) error {
		current, e := s.repoSnapshot(r, cid, false)
		if e != nil {
			return e
		}
		if p.Version != snap.ProjectVersion || !sameRepoSnapshot(snap, current) {
			return changedState()
		}
		v, e := pr.RepoVersion(pid)
		if e != nil {
			return e
		}
		if e = check(tag, s.repoTag(pid, v)); e != nil {
			return e
		}
		existing, e := pr.LinkedRepoIDs(pid, cid)
		if e != nil {
			return e
		}
		seen := map[string]bool{}
		for _, id := range existing {
			seen[id] = true
		}
		for _, i := range infos {
			if seen[i.RepoID] {
				return httpx.E(409, "REPOSITORY_ALREADY_LINKED", "部分仓库已关联，请刷新后重试")
			}
		}
		items := []ProjectRepo{}
		for _, info := range infos {
			v := ProjectRepo{RepoInfo: info, ProjectID: pid, ConnectionID: cid, Creator: a.User.ID, Version: 1, SyncedAt: time.Now().UTC(), ConnectionName: current.Connection.Name, ServiceType: current.Connection.Type, ConnectionEnabled: true}
			if e = pr.InsertProjectRepo(&v); e != nil {
				return e
			}
			s.decorateRepo(&v)
			items = append(items, v)
			if e = audit(tx, a, "project_repository", v.ID, info.FullPath, "linked", map[string]any{"project_id": fmt.Sprint(pid), "connection_id": fmt.Sprint(cid), "repo_id": info.RepoID}, meta); e != nil {
				return e
			}
		}
		if e = pr.BumpRepos(pid); e != nil {
			return e
		}
		next := s.repoTag(pid, v+1)
		out = Result{Data: map[string]any{"items": items, "mutation_version": next}, CollectionTag: next}
		return nil
	})
	return out, a, e
}
func (s *Service) UnlinkRepos(ctx context.Context, raw string, pid uint64, w RepoWrite, tag string, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	if w.ConnectionID != "" || len(w.RepoIDs) > 0 {
		return out, nil, httpx.Invalid("body", "unsupported")
	}
	if e := validateRepoIDs(w.IDs); e != nil {
		return out, nil, e
	}
	ids := make([]uint64, 0, len(w.IDs))
	for _, id := range w.IDs {
		v, _ := strconv.ParseUint(id, 10, 64)
		ids = append(ids, v)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	a, e := s.projectRepoAccess(ctx, raw, pid, true, func(tx identity.Tx, _ Repository, r ProjectRepoStore, a *identity.Auth, _ *c.Resource) error {
		v, e := r.RepoVersion(pid)
		if e != nil {
			return e
		}
		if e = check(tag, s.repoTag(pid, v)); e != nil {
			return e
		}
		for _, id := range ids {
			row, e := r.ProjectRepo(pid, id)
			if e != nil {
				return e
			}
			if row == nil {
				return fail()
			}
			if e = r.DeleteProjectRepo(pid, id); e != nil {
				return e
			}
			if e = audit(tx, a, "project_repository", id, row.FullPath, "unlinked", map[string]any{"project_id": fmt.Sprint(pid), "repo_id": row.RepoID}, meta); e != nil {
				return e
			}
		}
		if e = r.BumpRepos(pid); e != nil {
			return e
		}
		next := s.repoTag(pid, v+1)
		out = Result{Data: map[string]any{"removed_ids": w.IDs, "mutation_version": next}, CollectionTag: next}
		return nil
	})
	return out, a, e
}
func (s *Service) RefreshRepo(ctx context.Context, raw string, pid, id uint64, tag string, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	var row *ProjectRepo
	a, e := s.projectRepoAccess(ctx, raw, pid, true, func(_ identity.Tx, _ Repository, r ProjectRepoStore, _ *identity.Auth, _ *c.Resource) error {
		var e error
		row, e = r.ProjectRepo(pid, id)
		if e != nil {
			return e
		}
		if row == nil {
			return fail()
		}
		s.decorateRepo(row)
		return check(tag, row.ETag)
	})
	if e != nil {
		return out, a, e
	}
	release, e := repoSlot()
	if e != nil {
		return out, a, e
	}
	defer release()
	snap, a, e := s.repoStart(ctx, raw, pid, row.ConnectionID)
	if e != nil {
		return out, a, e
	}
	started := time.Now().UTC()
	info, e := getGitLabRepo(ctx, &snap.Connection.Config, snap.Token, row.RepoID)
	if e != nil {
		remoteErr := e
		a, e = s.projectRepoAccess(ctx, raw, pid, true, func(_ identity.Tx, r Repository, pr ProjectRepoStore, _ *identity.Auth, p *c.Resource) error {
			current, err := s.repoSnapshot(r, row.ConnectionID, false)
			if err != nil {
				return err
			}
			if p.Version != snap.ProjectVersion || !sameRepoSnapshot(snap, current) {
				return changedState()
			}
			v, err := pr.ProjectRepo(pid, id)
			if err != nil {
				return err
			}
			if v == nil {
				return fail()
			}
			s.decorateRepo(v)
			if err = check(tag, v.ETag); err != nil {
				return err
			}
			return saveRepoCheck(pr, id, snap, started, remoteErr)
		})
		if e != nil {
			return out, a, e
		}
		return out, a, remoteErr
	}
	a, e = s.projectRepoAccess(ctx, raw, pid, true, func(tx identity.Tx, r Repository, pr ProjectRepoStore, a *identity.Auth, p *c.Resource) error {
		current, e := s.repoSnapshot(r, row.ConnectionID, false)
		if e != nil {
			return e
		}
		if p.Version != snap.ProjectVersion || !sameRepoSnapshot(snap, current) {
			return changedState()
		}
		v, e := pr.ProjectRepo(pid, id)
		if e != nil {
			return e
		}
		if v == nil {
			return fail()
		}
		s.decorateRepo(v)
		if e = check(tag, v.ETag); e != nil {
			return e
		}
		v.RepoInfo = info
		v.SyncedAt = time.Now().UTC()
		v.Version++
		if e = pr.SaveProjectRepo(v); e != nil {
			return e
		}
		if e = saveRepoCheck(pr, id, snap, started, nil); e != nil {
			return e
		}
		if e = pr.BumpRepos(pid); e != nil {
			return e
		}
		version, e := pr.RepoVersion(pid)
		if e != nil {
			return e
		}
		s.decorateRepo(v)
		out = Result{Data: v, Tag: v.ETag, CollectionTag: s.repoTag(pid, version)}
		return audit(tx, a, "project_repository", id, v.FullPath, "refreshed", map[string]any{"project_id": fmt.Sprint(pid)}, meta)
	})
	return out, a, e
}

// Keep the platform ID a string all the way through JSON and storage.
func repoCursorPayload(snap repoSnapshot, q RepoBrowseQuery, page int, expires int64) string {
	b, _ := json.Marshal([]any{snap.Actor, snap.ProjectVersion, snap.Connection.ID, snap.Connection.Version, snap.Connection.CredentialsVersion, snap.Credential.ID, snap.Credential.MaterialVersion, q.Kind, q.Search, q.Container, q.Recursive, page, expires})
	return string(b)
}
func (s *Service) BrowseRepos(ctx context.Context, raw string, pid, cid uint64, q RepoBrowseQuery) (Result, *identity.Auth, error) {
	var out Result
	if len(q.Search) > 400 || utf8.RuneCountInString(q.Search) > 100 || (q.Kind != "repos" && q.Kind != "containers") {
		return out, nil, httpx.Invalid("query", "invalid_value")
	}
	if q.Container != "" {
		if _, e := c.ID(q.Container); e != nil {
			return out, nil, e
		}
	}
	if q.Kind == "containers" && q.Container != "" && q.Search != "" {
		return out, nil, httpx.Invalid("parent_id", "unsupported")
	}
	if q.Recursive && (q.Container == "" || q.Kind != "repos") {
		return out, nil, httpx.Invalid("recursive", "unsupported")
	}
	release, e := repoSlot()
	if e != nil {
		return out, nil, e
	}
	defer release()
	snap, a, e := s.repoStart(ctx, raw, pid, cid)
	if e != nil {
		return out, a, e
	}
	page := 1
	expires := time.Now().Add(10 * time.Minute).Unix()
	if q.Cursor != "" {
		parts := strings.Split(q.Cursor, ".")
		if len(parts) != 3 {
			return out, a, httpx.Invalid("cursor", "invalid_format")
		}
		page, e = strconv.Atoi(parts[0])
		expires, _ = strconv.ParseInt(parts[1], 10, 64)
		if e != nil || page < 1 || page > 1000000 || expires < time.Now().Unix() || parts[2] != s.ETag(repoCursorPayload(snap, q, page, expires)) {
			return out, a, httpx.E(422, "CURSOR_INVALID", "查询条件或凭证已变化，请重新搜索")
		}
	}
	items, more, e := browseGitLab(ctx, &snap.Connection.Config, snap.Token, q, page)
	if e != nil {
		return out, a, e
	}
	a, e = s.projectRepoAccess(ctx, raw, pid, true, func(_ identity.Tx, r Repository, pr ProjectRepoStore, _ *identity.Auth, p *c.Resource) error {
		current, e := s.repoSnapshot(r, cid, false)
		if e != nil {
			return e
		}
		if p.Version != snap.ProjectVersion || !sameRepoSnapshot(snap, current) {
			return changedState()
		}
		if rows, ok := items.([]RepoInfo); ok {
			ids, e := pr.LinkedRepoIDs(pid, cid)
			if e != nil {
				return e
			}
			linked := map[string]bool{}
			for _, id := range ids {
				linked[id] = true
			}
			for i := range rows {
				rows[i].Linked = linked[rows[i].RepoID]
			}
			items = rows
		}
		var next *string
		if more {
			v := fmt.Sprintf("%d.%d.%s", page+1, expires, s.ETag(repoCursorPayload(snap, q, page+1, expires)))
			next = &v
		}
		out.Data = map[string]any{"items": items, "next_cursor": next}
		return nil
	})
	return out, a, e
}

type repoCheck struct {
	Status             string    `json:"status"`
	Reason             string    `json:"reason,omitempty"`
	StartedAt          time.Time `json:"started_at"`
	FinishedAt         time.Time `json:"finished_at"`
	CheckID            string    `json:"check_id"`
	ConnectionVersion  uint64    `json:"connection_version"`
	ConfigVersion      uint64    `json:"config_version"`
	CredentialsVersion uint64    `json:"credentials_version"`
	CredentialID       uint64    `json:"credential_id"`
	MaterialVersion    uint64    `json:"material_version"`
}

func saveRepoCheck(r ProjectRepoStore, id uint64, snap repoSnapshot, started time.Time, remoteErr error) error {
	checkID, e := newCredentialCode()
	if e != nil {
		return e
	}
	d := repoCheck{Status: "succeeded", StartedAt: started, FinishedAt: time.Now().UTC(), CheckID: checkID, ConnectionVersion: snap.Connection.Version, ConfigVersion: snap.Connection.ConfigVersion, CredentialsVersion: snap.Connection.CredentialsVersion, CredentialID: snap.Credential.ID, MaterialVersion: snap.Credential.MaterialVersion}
	if remoteErr != nil {
		d.Status = "failed"
		d.Reason = "REMOTE_UNAVAILABLE"
		var apiErr *httpx.Error
		if errors.As(remoteErr, &apiErr) {
			d.Reason = apiErr.Code
		}
	}
	old, e := r.RepoDiagnostic(id)
	if e != nil {
		return e
	}
	if len(old) > 0 {
		var previous repoCheck
		if json.Unmarshal(old, &previous) != nil {
			return integrity()
		}
		if previous.StartedAt.After(started) || (previous.StartedAt.Equal(started) && previous.CheckID > checkID) {
			return nil
		}
	}
	b, e := json.Marshal(d)
	if e != nil {
		return e
	}
	return r.SaveRepoDiagnostic(id, b)
}
func (s *Service) GetProjectRepo(ctx context.Context, raw string, pid, id uint64, diagnostic bool) (Result, *identity.Auth, error) {
	var out Result
	a, e := s.projectRepoAccess(ctx, raw, pid, false, func(_ identity.Tx, r Repository, pr ProjectRepoStore, _ *identity.Auth, _ *c.Resource) error {
		v, e := pr.ProjectRepo(pid, id)
		if e != nil {
			return e
		}
		if v == nil {
			return fail()
		}
		s.decorateRepo(v)
		out = Result{Data: v, Tag: v.ETag}
		if !diagnostic {
			return nil
		}
		out = Result{Data: map[string]any{"latest": nil}}
		b, e := pr.RepoDiagnostic(id)
		if e != nil {
			return e
		}
		if len(b) == 0 {
			return nil
		}
		var d repoCheck
		if json.Unmarshal(b, &d) != nil {
			return integrity()
		}
		connection, e := r.Connection(v.ConnectionID)
		if e != nil {
			return e
		}
		if connection == nil {
			return integrity()
		}
		credential, e := r.Credential(d.CredentialID)
		if e != nil {
			return e
		}
		outdated := !connection.Enabled || connection.Version != d.ConnectionVersion || connection.ConfigVersion != d.ConfigVersion || connection.CredentialsVersion != d.CredentialsVersion || credential == nil || !credential.Usable() || !credential.Preferred || credential.MaterialVersion != d.MaterialVersion
		out.Data = map[string]any{"latest": map[string]any{"status": d.Status, "reason": d.Reason, "finished_at": d.FinishedAt, "outdated": outdated}}
		return nil
	})
	return out, a, e
}
