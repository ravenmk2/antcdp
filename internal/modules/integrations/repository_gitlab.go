package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type RepoBrowseQuery struct {
	Kind, Search, Container, Cursor string
	Recursive                       bool
}
type RepoContainer struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	FullPath string  `json:"full_path"`
	ParentID *string `json:"parent_id"`
}
type gitLabRepo struct {
	ID        json.Number `json:"id"`
	Name      string      `json:"name"`
	Path      string      `json:"path_with_namespace"`
	Web       *string     `json:"web_url"`
	HTTP      *string     `json:"http_url_to_repo"`
	SSH       *string     `json:"ssh_url_to_repo"`
	Branch    *string     `json:"default_branch"`
	Archived  *bool       `json:"archived"`
	Namespace struct {
		FullPath string `json:"full_path"`
	} `json:"namespace"`
}

func invalidRemote() error {
	return httpx.E(502, "REMOTE_INVALID_RESPONSE", "GitLab 返回了无效仓库信息")
}
func validRepoText(s string, max int) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && !strings.ContainsFunc(s, unicode.IsControl)
}
func safeRepoURL(v *string, ssh bool) bool {
	if v == nil || *v == "" {
		return true
	}
	s := *v
	if !validRepoText(s, 2048) || strings.TrimSpace(s) != s {
		return false
	}
	if ssh && !strings.Contains(s, "://") {
		parts := strings.SplitN(s, ":", 2)
		return len(parts) == 2 && strings.Contains(parts[0], "@") && !strings.ContainsAny(parts[0], "/?#") && parts[1] != "" && !strings.ContainsAny(parts[1], "?#")
	}
	u, e := url.Parse(s)
	if e != nil || u.Hostname() == "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return false
	}
	if ssh {
		if u.Scheme != "ssh" {
			return false
		}
		if u.User != nil {
			_, password := u.User.Password()
			return !password
		}
		return true
	}
	return (u.Scheme == "https" || u.Scheme == "http") && u.User == nil
}
func normalizeGitLabRepo(v gitLabRepo) (RepoInfo, error) {
	out := RepoInfo{RepoID: v.ID.String(), Name: v.Name, Namespace: v.Namespace.FullPath, FullPath: v.Path, WebURL: v.Web, HTTPURL: v.HTTP, SSHURL: v.SSH, Branch: v.Branch, Archived: v.Archived}
	if _, e := c.ID(out.RepoID); e != nil {
		return out, invalidRemote()
	}
	if out.Name == "" || out.FullPath == "" || !validRepoText(out.Name, 255) || !validRepoText(out.Namespace, 2048) || !validRepoText(out.FullPath, 2048) || !safeRepoURL(out.WebURL, false) || !safeRepoURL(out.HTTPURL, false) || !safeRepoURL(out.SSHURL, true) || (out.Branch != nil && !validRepoText(*out.Branch, 1024)) {
		return out, invalidRemote()
	}
	return out, nil
}
func repoHTTP(ctx context.Context, g *HTTPConfig, token, path string, q url.Values, dest any) (bool, error) {
	if e := ValidateConfig(g.BaseURL, g.CA); e != nil {
		return false, e
	}
	tr := transport(g)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(g.BaseURL, "/")+"/api/v4"+path+"?"+q.Encode(), nil)
	if e != nil {
		return false, invalidRemote()
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	req.Header.Set("Accept", "application/json")
	res, e := client.Do(req)
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			return false, httpx.E(504, "REMOTE_TIMEOUT", "GitLab 请求超时")
		}
		return false, httpx.E(502, "REMOTE_UNAVAILABLE", "无法访问 GitLab，请检查连接配置")
	}
	defer func() { _ = res.Body.Close() }()
	switch res.StatusCode {
	case 200:
	case 401:
		return false, httpx.E(502, "REMOTE_AUTHENTICATION_FAILED", "系统首选凭证认证失败")
	case 403:
		return false, httpx.E(502, "REMOTE_ACCESS_DENIED", "系统首选凭证无权访问")
	case 404:
		return false, httpx.E(502, "REMOTE_REPOSITORY_UNAVAILABLE", "仓库或分组不存在，或当前凭证无权访问")
	case 429:
		return false, httpx.E(429, "RATE_LIMITED", "GitLab 请求频率受限，请稍后重试")
	default:
		return false, httpx.E(502, "REMOTE_UNAVAILABLE", "GitLab 请求失败")
	}
	body, e := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil || len(body) > 2<<20 || json.Unmarshal(body, dest) != nil {
		return false, invalidRemote()
	}
	return res.Header.Get("X-Next-Page") != "", nil
}
func getGitLabRepo(ctx context.Context, g *HTTPConfig, token, id string) (RepoInfo, error) {
	var v gitLabRepo
	if _, e := c.ID(id); e != nil {
		return RepoInfo{}, e
	}
	_, e := repoHTTP(ctx, g, token, "/projects/"+id, url.Values{}, &v)
	if e != nil {
		return RepoInfo{}, e
	}
	out, e := normalizeGitLabRepo(v)
	if out.RepoID != id {
		return out, invalidRemote()
	}
	return out, e
}
func browseGitLab(ctx context.Context, g *HTTPConfig, token string, q RepoBrowseQuery, page int) (any, bool, error) {
	params := url.Values{"page": {strconv.Itoa(page)}, "per_page": {"20"}, "order_by": {"name"}, "sort": {"asc"}}
	if q.Search != "" {
		params.Set("search", q.Search)
	}
	if q.Kind == "containers" {
		path := "/groups"
		if q.Container != "" {
			path += "/" + q.Container + "/subgroups"
		} else if q.Search == "" {
			params.Set("top_level_only", "true")
		}
		var groups []struct {
			ID     json.Number  `json:"id"`
			Parent *json.Number `json:"parent_id"`
			Name   string       `json:"name"`
			Path   string       `json:"full_path"`
		}
		more, e := repoHTTP(ctx, g, token, path, params, &groups)
		if e != nil {
			return nil, false, e
		}
		out := []RepoContainer{}
		for _, v := range groups {
			if _, e := c.ID(v.ID.String()); e != nil || !validRepoText(v.Name, 255) || !validRepoText(v.Path, 2048) {
				return nil, false, invalidRemote()
			}
			var parent *string
			if v.Parent != nil {
				s := v.Parent.String()
				parent = &s
			}
			out = append(out, RepoContainer{ID: v.ID.String(), Name: v.Name, FullPath: v.Path, ParentID: parent})
		}
		return out, more || len(groups) == 20, nil
	}
	path := "/projects"
	if q.Container != "" {
		path = "/groups/" + q.Container + "/projects"
		params.Set("with_shared", "false")
		params.Set("include_subgroups", strconv.FormatBool(q.Recursive))
	}
	var rows []gitLabRepo
	more, e := repoHTTP(ctx, g, token, path, params, &rows)
	if e != nil {
		return nil, false, e
	}
	out := []RepoInfo{}
	for _, v := range rows {
		i, e := normalizeGitLabRepo(v)
		if e != nil {
			return nil, false, e
		}
		out = append(out, i)
	}
	return out, more || len(rows) == 20, nil
}
