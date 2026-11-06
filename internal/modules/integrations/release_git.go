package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// ReleaseGit carries one operator's personal credentials for one GitLab project.
type ReleaseGit struct {
	snap    BranchSnapshot
	project string
}

func (s *Service) ReleaseGit(tx identity.Tx, actor, cid uint64, rid string) (ReleaseGit, error) {
	r, e := repo(tx)
	if e != nil {
		return ReleaseGit{}, e
	}
	if _, e = strconv.ParseUint(rid, 10, 64); e != nil {
		return ReleaseGit{}, httpx.Invalid("repository_id", "unsupported")
	}
	v, e := s.ownedRepoSnapshot(r, cid, true, CredentialOwnership{Type: "personal", Owner: actor})
	if e != nil {
		return ReleaseGit{}, e
	}
	return ReleaseGit{snap: BranchSnapshot{ConnectionVersion: v.Connection.Version, ConfigVersion: v.Connection.ConfigVersion, CredentialsVersion: v.Connection.CredentialsVersion, CredentialID: v.Credential.ID, CredentialVersion: v.Credential.Version, MaterialVersion: v.Credential.MaterialVersion, config: v.Connection.Config, token: v.Token}, project: "/projects/" + rid}, nil
}

type ReleaseMR struct {
	IID       uint64 `json:"iid"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Source    string `json:"source_branch"`
	Target    string `json:"target_branch"`
	Head      string `json:"sha"`
	MergeSHA  string `json:"merge_commit_sha"`
	SquashSHA string `json:"squash_commit_sha"`
}
type ReleaseCommit struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}
type GitActor struct {
	ID       uint64 `json:"id"`
	Username string `json:"username"`
}

func (g ReleaseGit) remote(ctx context.Context, method, endpoint string, form url.Values, out any) error {
	status, b, reason := branchHTTP(ctx, g.snap, method, endpoint, form.Encode())
	if reason != "" || status < 200 || status >= 300 {
		if reason == "" {
			reason = branchStatus(status)
		}
		code := 502
		if status == 404 {
			code = 404
		}
		if status == 401 || status == 403 {
			code = 403
		}
		if status == 429 {
			code = 429
		}
		if status == 400 || status == 405 || status == 409 || status == 422 {
			code = 409
		}
		return httpx.E(code, "GITLAB_"+strings.ToUpper(reason), fmt.Sprintf("GitLab 请求未完成（HTTP %d），请核实凭证、审批状态及远端结果", status))
	}
	if json.Unmarshal(b, out) != nil {
		return httpx.E(502, "GITLAB_INVALID_RESPONSE", "GitLab 响应无法核实")
	}
	return nil
}
func (g ReleaseGit) Actor(ctx context.Context) (GitActor, error) {
	var a GitActor
	e := g.remote(ctx, "GET", "/user", nil, &a)
	if e == nil && (a.ID == 0 || a.Username == "") {
		e = httpx.E(502, "GITLAB_IDENTITY_UNKNOWN", "无法确认 GitLab 身份")
	}
	return a, e
}
func (g ReleaseGit) Commit(ctx context.Context, ref string) (ReleaseCommit, error) {
	var c ReleaseCommit
	e := g.remote(ctx, "GET", g.project+"/repository/commits/"+url.PathEscape(ref), nil, &c)
	if e == nil && !fullCommit.MatchString(c.ID) {
		e = httpx.E(502, "GITLAB_INVALID_SHA", "无法核实提交 ID")
	}
	return c, e
}
func (g ReleaseGit) Head(ctx context.Context, branch string) (string, error) {
	var b gitLabBranch
	e := g.remote(ctx, "GET", g.project+"/repository/branches/"+url.PathEscape(branch), nil, &b)
	if e == nil && (b.Name != branch || !fullCommit.MatchString(b.Commit.ID)) {
		e = httpx.E(502, "GITLAB_INVALID_BRANCH", "无法核实主干")
	}
	return b.Commit.ID, e
}
func (g ReleaseGit) Range(ctx context.Context, base, head string) ([]ReleaseCommit, error) {
	if base == head {
		return []ReleaseCommit{}, nil
	}
	var ancestor ReleaseCommit
	q := url.Values{"refs[]": {base, head}}
	if e := g.remote(ctx, "GET", g.project+"/repository/merge_base?"+q.Encode(), nil, &ancestor); e != nil {
		return nil, e
	}
	if ancestor.ID != base {
		return nil, httpx.E(409, "BASELINE_DIVERGED", "基线不是目标主干的祖先，请核对历史")
	}
	return g.commits(ctx, "/repository/commits", url.Values{"ref_name": {base + ".." + head}})
}
func (g ReleaseGit) commits(ctx context.Context, p string, q url.Values) ([]ReleaseCommit, error) {
	var result []ReleaseCommit
	for page := 1; page <= 100; page++ {
		q.Set("page", strconv.Itoa(page))
		q.Set("per_page", "50")
		var rows []ReleaseCommit
		if e := g.remote(ctx, "GET", g.project+p+"?"+q.Encode(), nil, &rows); e != nil {
			return nil, e
		}
		for _, c := range rows {
			if !fullCommit.MatchString(c.ID) {
				return nil, httpx.E(502, "GITLAB_INVALID_SHA", "远端提交数据不完整")
			}
		}
		result = append(result, rows...)
		if len(rows) < 50 {
			return result, nil
		}
	}
	return nil, httpx.E(409, "DIFF_INCOMPLETE", "差异超过单次核对范围")
}
func (g ReleaseGit) MRCommits(ctx context.Context, iid uint64) ([]ReleaseCommit, error) {
	return g.commits(ctx, fmt.Sprintf("/merge_requests/%d/commits", iid), url.Values{})
}
func (g ReleaseGit) MR(ctx context.Context, iid uint64) (ReleaseMR, error) {
	var m ReleaseMR
	e := g.remote(ctx, "GET", fmt.Sprintf("%s/merge_requests/%d", g.project, iid), nil, &m)
	if e == nil && (m.IID != iid || !fullCommit.MatchString(m.Head)) {
		e = httpx.E(502, "GITLAB_INVALID_MR", "无法确认合并请求")
	}
	return m, e
}
func (g ReleaseGit) MRs(ctx context.Context, branch string, page, size int) ([]ReleaseMR, error) {
	q := url.Values{"target_branch": {branch}, "state": {"opened"}, "page": {strconv.Itoa(page)}, "per_page": {strconv.Itoa(size)}}
	rows := []ReleaseMR{}
	e := g.remote(ctx, "GET", g.project+"/merge_requests?"+q.Encode(), nil, &rows)
	return rows, e
}
func (g ReleaseGit) Merge(ctx context.Context, iid uint64, sha string) error {
	var m ReleaseMR
	return g.remote(ctx, http.MethodPut, fmt.Sprintf("%s/merge_requests/%d/merge", g.project, iid), url.Values{"sha": {sha}}, &m)
}
func (g ReleaseGit) Tag(ctx context.Context, name string) (string, error) {
	var v struct {
		Name   string        `json:"name"`
		Commit ReleaseCommit `json:"commit"`
	}
	e := g.remote(ctx, "GET", g.project+"/repository/tags/"+url.PathEscape(name), nil, &v)
	if e == nil && (v.Name != name || !fullCommit.MatchString(v.Commit.ID)) {
		e = httpx.E(502, "GITLAB_INVALID_TAG", "无法核实 Tag")
	}
	return v.Commit.ID, e
}
func (g ReleaseGit) CreateTag(ctx context.Context, name, sha string) error {
	var v struct {
		Name string `json:"name"`
	}
	return g.remote(ctx, "POST", g.project+"/repository/tags", url.Values{"tag_name": {name}, "ref": {sha}}, &v)
}
func (g ReleaseGit) CreateRevertBranch(ctx context.Context, branch, head string) error {
	var v gitLabBranch
	return g.remote(ctx, "POST", g.project+"/repository/branches", url.Values{"branch": {branch}, "ref": {head}}, &v)
}
func (g ReleaseGit) RevertCommit(ctx context.Context, branch, sha string) (string, error) {
	var c ReleaseCommit
	e := g.remote(ctx, "POST", g.project+"/repository/commits/"+url.PathEscape(sha)+"/revert", url.Values{"branch": {branch}}, &c)
	if e == nil && !fullCommit.MatchString(c.ID) {
		return "", httpx.E(502, "GITLAB_INVALID_SHA", "无法核实回退提交")
	}
	return c.ID, e
}
func (g ReleaseGit) CreateRevertMR(ctx context.Context, source, target, title string) (ReleaseMR, error) {
	var m ReleaseMR
	e := g.remote(ctx, "POST", g.project+"/merge_requests", url.Values{"source_branch": {source}, "target_branch": {target}, "title": {title}}, &m)
	return m, e
}

func (g ReleaseGit) SameCredential(v ReleaseGit) bool {
	return g.snap.CredentialID == v.snap.CredentialID && g.snap.MaterialVersion == v.snap.MaterialVersion && g.snap.ConfigVersion == v.snap.ConfigVersion
}
func (g ReleaseGit) FindRevertMR(ctx context.Context, source, target string) (ReleaseMR, error) {
	q := url.Values{"source_branch": {source}, "target_branch": {target}, "scope": {"all"}}
	var rows []ReleaseMR
	e := g.remote(ctx, "GET", g.project+"/merge_requests?"+q.Encode(), nil, &rows)
	if e == nil && len(rows) == 1 && rows[0].Source == source && rows[0].Target == target {
		return rows[0], nil
	}
	return ReleaseMR{}, e
}

func (g ReleaseGit) VerifyRevert(ctx context.Context, branch, original, parent string) (string, bool) {
	head, e := g.Head(ctx, branch)
	if e != nil || head == parent {
		return "", false
	}
	var c struct {
		ID      string   `json:"id"`
		Message string   `json:"message"`
		Parents []string `json:"parent_ids"`
	}
	if e = g.remote(ctx, "GET", g.project+"/repository/commits/"+url.PathEscape(head), nil, &c); e != nil {
		return "", false
	}
	return head, c.ID == head && len(c.Parents) == 1 && c.Parents[0] == parent && strings.Contains(c.Message, "This reverts commit "+original)
}
