package integrations

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

type agentRepoStore interface {
	ProjectRepoStore
	ProjectIDForCode(string) (uint64, error)
	ProjectIDForRepository(uint64) (uint64, error)
}

type AgentRepoSummary struct {
	ID         uint64  `json:"project_repo_id,string"`
	Connection uint64  `json:"conn_id,string"`
	Name       string  `json:"name"`
	FullPath   string  `json:"full_path"`
	Branch     *string `json:"default_branch"`
	Enabled    bool    `json:"connection_enabled"`
}

type AgentRepoPage struct {
	Items []AgentRepoSummary `json:"items"`
	Page  int                `json:"page"`
	Size  int                `json:"page_size"`
	Total int                `json:"total"`
}

type AgentGitRemote struct {
	ID          uint64  `json:"project_repo_id,string"`
	Connection  uint64  `json:"conn_id,string"`
	Origin      string  `json:"origin"`
	Branch      *string `json:"default_branch"`
	Path        string  `json:"path"`
	Base        string  `json:"-"`
	DisplayName string  `json:"-"`
	Email       string  `json:"-"`
}

func (s *Service) agentAccess(ctx context.Context, auth agentcore.Authorization, fn func(identity.Tx, *identity.User, Repository) error) error {
	store, err := s.Store()
	if err != nil {
		return err
	}
	return store.Transact(ctx, func(tx identity.Tx) error {
		users, err := tx.LockUsers([]uint64{uint64(auth.AccountID)})
		if err != nil {
			return err
		}
		user := users[uint64(auth.AccountID)]
		if user == nil || user.DeletedAt != nil || user.Status != "active" || user.AuthVersion != uint64(auth.AccountVersion) {
			return forbidden()
		}
		r, err := repo(tx)
		if err != nil {
			return err
		}
		return fn(tx, user, r)
	})
}

func agentProjectAccess(tx identity.Tx, user *identity.User, auth agentcore.Authorization, pid uint64) error {
	if pid == 0 || !auth.Allows("project", agentcore.ID(pid), "member") {
		return fail()
	}
	cr, ok := tx.(c.Repository)
	if !ok {
		return integrity()
	}
	if err := cr.LockCollaboration(c.Project, pid, 0); err != nil {
		return err
	}
	p, err := cr.Resource(c.Project, pid, user.ID)
	if err != nil {
		return err
	}
	if p == nil || p.EndedAt != nil || (!p.IsMember && user.Role != "admin") {
		return fail()
	}
	return nil
}

func (s *Service) AgentRepoList(ctx context.Context, auth agentcore.Authorization, code string, q RepoQuery) (out AgentRepoPage, err error) {
	if !resourcecode.Valid(code) {
		return out, httpx.Invalid("project_code", "invalid_format")
	}
	err = s.agentAccess(ctx, auth, func(tx identity.Tx, user *identity.User, _ Repository) error {
		r, ok := tx.(agentRepoStore)
		if !ok {
			return integrity()
		}
		pid, err := r.ProjectIDForCode(code)
		if err != nil {
			return err
		}
		if err = agentProjectAccess(tx, user, auth, pid); err != nil {
			return err
		}
		page, err := r.ProjectRepos(pid, q)
		if err != nil {
			return err
		}
		out = AgentRepoPage{Items: make([]AgentRepoSummary, 0, len(page.Items)), Page: q.Page, Size: q.Size, Total: page.Total}
		for _, v := range page.Items {
			out.Items = append(out.Items, AgentRepoSummary{ID: v.ID, Connection: v.ConnectionID, Name: v.Name, FullPath: v.FullPath, Branch: v.Branch, Enabled: v.ConnectionEnabled})
		}
		return nil
	})
	return out, err
}

func secureGitBase(cfg *HTTPConfig) (*url.URL, error) {
	if err := ValidateConfig(cfg.BaseURL, cfg.CA); err != nil {
		return nil, err
	}
	base, err := url.Parse(cfg.BaseURL)
	if err != nil || base.Scheme != "https" {
		return nil, httpx.E(409, "GIT_HTTPS_REQUIRED", "Git 认证需要 HTTPS 连接")
	}
	return base, nil
}

// GitLab behind a TLS-terminating proxy may advertise HTTP for this same origin.
func gitOrigin(base *url.URL, raw *string) (*url.URL, error) {
	if raw == nil || !safeRepoURL(raw, false) {
		return nil, invalidRemote()
	}
	origin, err := url.Parse(*raw)
	if err != nil || !strings.EqualFold(origin.Host, base.Host) || path.Clean(origin.Path) != origin.Path || !strings.HasPrefix(origin.Path, strings.TrimRight(base.Path, "/")+"/") || strings.ContainsAny(origin.Path, "\\\x00\n\r") {
		return nil, invalidRemote()
	}
	origin.Scheme, origin.Host = base.Scheme, base.Host
	return origin, nil
}

func (s *Service) AgentGitRemote(ctx context.Context, auth agentcore.Authorization, id uint64) (out AgentGitRemote, err error) {
	err = s.agentAccess(ctx, auth, func(tx identity.Tx, user *identity.User, r Repository) error {
		row, conn, err := agentRepoConnection(tx, user, r, auth, id)
		if err != nil {
			return err
		}
		cfg, err := config(r, conn)
		if err != nil {
			return err
		}
		base, err := secureGitBase(cfg)
		if err != nil {
			return err
		}
		origin, err := gitOrigin(base, row.HTTPURL)
		if err != nil {
			return err
		}
		out = AgentGitRemote{ID: id, Connection: conn.ID, Origin: origin.String(), Branch: row.Branch, Base: "https://" + base.Host}
		out.DisplayName = user.DisplayName
		if user.Email != nil {
			out.Email = *user.Email
		}
		return nil
	})
	return out, err
}

func agentRepoConnection(tx identity.Tx, user *identity.User, r Repository, auth agentcore.Authorization, id uint64) (*ProjectRepo, *ServiceConnection, error) {
	pr, ok := tx.(agentRepoStore)
	if !ok {
		return nil, nil, integrity()
	}
	pid, err := pr.ProjectIDForRepository(id)
	if err != nil {
		return nil, nil, err
	}
	if err = agentProjectAccess(tx, user, auth, pid); err != nil {
		return nil, nil, err
	}
	row, err := pr.ProjectRepo(pid, id)
	if err != nil {
		return nil, nil, err
	}
	if row == nil {
		return nil, nil, fail()
	}
	conn, err := r.Connection(row.ConnectionID)
	if err != nil {
		return nil, nil, err
	}
	if conn == nil || conn.Type != "gitlab" {
		return nil, nil, fail()
	}
	allowed, err := ConnectionAllowed(r, conn, CredentialOwnership{Type: "project", Owner: pid})
	if err != nil {
		return nil, nil, err
	}
	if !allowed {
		return nil, nil, fail()
	}
	if !conn.Enabled {
		return nil, nil, httpx.E(409, "RESOURCE_DISABLED", "服务连接已停用")
	}
	return row, conn, nil
}

// GitMaterial is passed directly to the private sandbox writer. It must never be serialized.
type GitMaterial struct {
	Base       string `json:"-"`
	Version    string `json:"-"`
	Credential string `json:"-"`
	CA         string `json:"-"`
}

func (s *Service) AgentGitCredential(ctx context.Context, auth agentcore.Authorization, id uint64, decrypt bool) (out GitMaterial, err error) {
	err = s.agentAccess(ctx, auth, func(_ identity.Tx, user *identity.User, r Repository) error {
		snap, err := s.ownedRepoSnapshot(r, id, decrypt, CredentialOwnership{Type: "personal", Owner: user.ID})
		if err != nil {
			return err
		}
		base, err := secureGitBase(&snap.Connection.Config)
		if err != nil {
			return err
		}
		out.Base = "https://" + base.Host
		out.Version = fmt.Sprintf("%d-%d-%d-%d", user.ID, snap.Connection.ConfigVersion, snap.Credential.ID, snap.Credential.MaterialVersion)
		if ca := snap.Connection.Config.CA; ca != nil {
			out.CA = *ca
		}
		if decrypt {
			if err := validateToken(snap.Token); err != nil {
				return unavailable()
			}
			entry := url.URL{Scheme: "https", Host: base.Host, User: url.UserPassword("git", snap.Token)}
			out.Credential = entry.String() + "\n"
		}
		return nil
	})
	return out, err
}
