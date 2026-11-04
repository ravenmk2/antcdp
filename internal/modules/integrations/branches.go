package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// BranchSnapshot contains version metadata only. The transport material is never
// serializable. Callers must authorize the project and repository before using it.
type BranchSnapshot struct {
	ConnectionVersion  uint64 `json:"connection_version,string"`
	ConfigVersion      uint64 `json:"config_version,string"`
	CredentialsVersion uint64 `json:"credentials_version,string"`
	CredentialID       uint64 `json:"credential_id,string"`
	CredentialVersion  uint64 `json:"credential_version,string"`
	MaterialVersion    uint64 `json:"material_version,string"`
	config             HTTPConfig
	token              string
}

func (s *Service) BranchSnapshot(tx identity.Tx, cid uint64, decrypt bool) (BranchSnapshot, error) {
	r, e := repo(tx)
	if e != nil {
		return BranchSnapshot{}, e
	}
	v, e := s.repoSnapshot(r, cid, decrypt)
	if e != nil {
		return BranchSnapshot{}, e
	}
	return BranchSnapshot{v.Connection.Version, v.Connection.ConfigVersion, v.Connection.CredentialsVersion, v.Credential.ID, v.Credential.Version, v.Credential.MaterialVersion, v.Connection.Config, v.Token}, nil
}

type BranchResult struct {
	Status    string `json:"status"`
	Reason    string `json:"reason"`
	Commit    string `json:"commit_id"`
	Protected *bool  `json:"protected"`
	Default   *bool  `json:"default"`
}
type gitLabBranch struct {
	Name      string `json:"name"`
	Protected *bool  `json:"protected"`
	Default   *bool  `json:"default"`
	Commit    struct {
		ID string `json:"id"`
	} `json:"commit"`
}

var fullCommit = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)

func BranchReason(e error) string {
	var api *httpx.Error
	if errors.As(e, &api) {
		switch api.Code {
		case "SYSTEM_PREFERRED_REQUIRED":
			return "system_preferred_required"
		case "CREDENTIAL_UNAVAILABLE":
			return "credential_unavailable"
		case "RESOURCE_DISABLED":
			return "connection_disabled"
		case "REMOTE_AUTHENTICATION_FAILED":
			return "authentication_failed"
		case "REMOTE_ACCESS_DENIED":
			return "access_denied"
		case "RATE_LIMITED":
			return "rate_limited"
		case "REMOTE_TIMEOUT":
			return "timeout"
		}
	}
	return "credential_unavailable"
}
func branchHTTP(ctx context.Context, snap BranchSnapshot, method, path, body string) (int, []byte, string) {
	if e := ValidateConfig(snap.config.BaseURL, snap.config.CA); e != nil {
		return 0, nil, "connection_unavailable"
	}
	if release, e := repoSlot(); e != nil {
		return 0, nil, "rate_limited"
	} else {
		defer release()
	}
	tr := transport(&snap.config)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, e := http.NewRequestWithContext(ctx, method, strings.TrimRight(snap.config.BaseURL, "/")+"/api/v4"+path, strings.NewReader(body))
	if e != nil {
		return 0, nil, "invalid_request"
	}
	req.Header.Set("PRIVATE-TOKEN", snap.token)
	req.Header.Set("Accept", "application/json")
	if method == http.MethodPost || method == http.MethodPut {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, e := client.Do(req)
	if e != nil {
		return 0, nil, "timeout"
	}
	defer func() { _ = res.Body.Close() }()
	b, e := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil || len(b) > 2<<20 {
		return res.StatusCode, nil, "invalid_response"
	}
	return res.StatusCode, b, ""
}
func branchStatus(code int) string {
	switch code {
	case 401:
		return "authentication_failed"
	case 403:
		return "access_denied"
	case 404:
		return "repository_unavailable"
	case 429:
		return "rate_limited"
	default:
		return "remote_unavailable"
	}
}
func observed(b []byte, name string) BranchResult {
	var v gitLabBranch
	if json.Unmarshal(b, &v) != nil || v.Name != name || !fullCommit.MatchString(v.Commit.ID) {
		return BranchResult{Status: "unknown", Reason: "invalid_response"}
	}
	return BranchResult{Status: "exists", Commit: v.Commit.ID, Protected: v.Protected, Default: v.Default}
}
func (s *Service) ReadBranch(ctx context.Context, snap BranchSnapshot, rid, name string) BranchResult {
	if _, e := c.ID(rid); e != nil {
		return BranchResult{Status: "unknown", Reason: "invalid_request"}
	}
	path := "/projects/" + rid + "/repository/branches"
	code, b, reason := branchHTTP(ctx, snap, http.MethodGet, path+"/"+url.PathEscape(name), "")
	if reason != "" {
		return BranchResult{Status: "unknown", Reason: reason}
	}
	if code == 200 {
		return observed(b, name)
	}
	if code != 404 {
		return BranchResult{Status: "unknown", Reason: branchStatus(code)}
	}
	code, b, reason = branchHTTP(ctx, snap, http.MethodGet, path+"?per_page=1", "")
	if reason != "" {
		return BranchResult{Status: "unknown", Reason: reason}
	}
	if code != 200 {
		return BranchResult{Status: "unknown", Reason: branchStatus(code)}
	}
	var rows []json.RawMessage
	if json.Unmarshal(b, &rows) != nil || rows == nil {
		return BranchResult{Status: "unknown", Reason: "invalid_response"}
	}
	for _, row := range rows {
		var v gitLabBranch
		if json.Unmarshal(row, &v) != nil || v.Name == "" || !fullCommit.MatchString(v.Commit.ID) {
			return BranchResult{Status: "unknown", Reason: "invalid_response"}
		}
		if v.Name == name {
			return observed(row, name)
		}
	}
	return BranchResult{Status: "missing"}
}
func (s *Service) CreateBranch(ctx context.Context, snap BranchSnapshot, rid, name, commit string) BranchResult {
	if _, e := c.ID(rid); e != nil || !fullCommit.MatchString(commit) {
		return BranchResult{Status: "failed", Reason: "invalid_request"}
	}
	code, b, reason := branchHTTP(ctx, snap, http.MethodPost, "/projects/"+rid+"/repository/branches", url.Values{"branch": {name}, "ref": {commit}}.Encode())
	if reason != "" || code >= 500 || code == 0 {
		if reason == "" {
			reason = "remote_unavailable"
		}
		return BranchResult{Status: "unknown", Reason: reason}
	}
	if code == 201 {
		out := observed(b, name)
		if out.Status != "exists" || out.Commit != commit {
			return BranchResult{Status: "unknown", Reason: "invalid_response"}
		}
		out.Status = "created"
		return out
	}
	reason = branchStatus(code)
	if code == 400 || code == 409 {
		reason = "target_exists_or_rejected"
	}
	if code >= 400 && code < 500 {
		return BranchResult{Status: "failed", Reason: reason}
	}
	return BranchResult{Status: "unknown", Reason: "invalid_response"}
}

// BranchRepository checks current archival state before a write. The caller must
// reauthorize after this network round trip and before calling CreateBranch.
func (s *Service) BranchRepository(ctx context.Context, snap BranchSnapshot, rid string) string {
	repo, e := getGitLabRepo(ctx, &snap.config, snap.token, rid)
	if e != nil {
		return BranchReason(e)
	}
	if repo.Archived == nil || *repo.Archived {
		return "remote_archived"
	}
	return ""
}
