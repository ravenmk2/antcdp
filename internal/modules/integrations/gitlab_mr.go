package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type GitLabMRClient struct {
	reviewToken func(uint64, string, string) string
	client      *http.Client
	endpoint    string
	projectID   string
	token       string
}

func (s *Service) AgentGitLabMRClient(ctx context.Context, auth agentcore.Authorization, id uint64) (*GitLabMRClient, error) {
	var client *GitLabMRClient
	err := s.agentAccess(ctx, auth, func(tx identity.Tx, user *identity.User, r Repository) error {
		row, conn, err := agentRepoConnection(tx, user, r, auth, id)
		if err != nil {
			return err
		}
		if _, err = c.ID(row.RepoID); err != nil {
			return integrity()
		}
		snap, err := s.preferredRepoSnapshot(r, conn, true, CredentialOwnership{Type: "user", Owner: user.ID})
		if err != nil {
			return err
		}
		cfg := &snap.Connection.Config
		base, err := secureGitBase(cfg)
		if err != nil {
			return err
		}
		if validateToken(snap.Token) != nil {
			return unavailable()
		}
		client = &GitLabMRClient{
			client: &http.Client{
				Transport:     transport(cfg),
				Timeout:       10 * time.Second,
				CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
			},
			endpoint:  strings.TrimRight(base.String(), "/") + "/api/v4/projects/" + row.RepoID + "/merge_requests",
			projectID: row.RepoID,
			token:     snap.Token,
		}
		return nil
	})
	return client, err
}

type GitLabMRFields struct {
	Description        *string   `json:"description,omitempty"`
	AssigneeIDs        *[]uint64 `json:"assignee_ids,omitempty"`
	ReviewerIDs        *[]uint64 `json:"reviewer_ids,omitempty"`
	Squash             *bool     `json:"squash,omitempty"`
	RemoveSourceBranch *bool     `json:"remove_source_branch,omitempty"`
}

type GitLabMRCreate struct {
	GitLabMRFields
	SourceBranch string `json:"source_branch"`
	TargetBranch string `json:"target_branch"`
	Title        string `json:"title"`
}

type GitLabMRUpdate struct {
	GitLabMRFields
	Title        *string `json:"title,omitempty"`
	TargetBranch *string `json:"target_branch,omitempty"`
	StateEvent   *string `json:"state_event,omitempty"`
}

type GitLabMRMerge struct {
	ReviewToken        string `json:"-"`
	SHA                string `json:"sha"`
	Squash             *bool  `json:"squash,omitempty"`
	RemoveSourceBranch *bool  `json:"should_remove_source_branch,omitempty"`
}

type GitLabMRQuery struct {
	State        string `json:"state"`
	SourceBranch string `json:"source_branch"`
	TargetBranch string `json:"target_branch"`
	Search       string `json:"search"`
	Page         int    `json:"page"`
	Size         int    `json:"page_size"`
}

type GitLabMR struct {
	IID                 uint64  `json:"iid"`
	Title               string  `json:"title"`
	State               string  `json:"state"`
	Draft               bool    `json:"draft"`
	SourceBranch        string  `json:"source_branch"`
	TargetBranch        string  `json:"target_branch"`
	SHA                 string  `json:"sha"`
	WebURL              string  `json:"web_url"`
	DetailedMergeStatus string  `json:"detailed_merge_status"`
	Description         *string `json:"description,omitempty"`
	PipelineStatus      string  `json:"pipeline_status,omitempty"`
}

type GitLabMRPage struct {
	Items    []GitLabMR `json:"items"`
	Page     int        `json:"page"`
	Size     int        `json:"page_size"`
	NextPage *int       `json:"next_page"`
}

type gitLabMRResponse struct {
	GitLabMR
	SourceProject json.Number `json:"source_project_id"`
	TargetProject json.Number `json:"target_project_id"`
	HeadPipeline  *struct {
		Status string `json:"status"`
	} `json:"head_pipeline"`
}

func (v gitLabMRResponse) inProject(id string) bool {
	return v.SourceProject.String() == id && v.TargetProject.String() == id
}

func (v gitLabMRResponse) valid(iid uint64) bool {
	return v.IID > 0 && (iid == 0 || v.IID == iid) && v.State != "" && safeRepoURL(&v.WebURL, false)
}

func (v gitLabMRResponse) result(details bool) GitLabMR {
	out := v.GitLabMR
	if !details {
		out.Description = nil
	} else if v.HeadPipeline != nil {
		out.PipelineStatus = v.HeadPipeline.Status
	}
	return out
}

type GitLabMRFailure struct {
	Code    string
	Message string
	Unknown bool
}

func (e *GitLabMRFailure) Error() string { return e.Code }

func mrError(code, message string) *GitLabMRFailure {
	return &GitLabMRFailure{Code: "GITLAB_MR_" + code, Message: message}
}

func mrUnknown() *GitLabMRFailure {
	return &GitLabMRFailure{
		Code:    "GITLAB_MR_OUTCOME_UNKNOWN",
		Message: "GitLab 写入结果未确认。请按 IID 查询 MR，创建请求则按源和目标分支查找，再决定是否重试。",
		Unknown: true,
	}
}

// GitLab interprets slash commands in MR descriptions, including /merge.
var mrQuickAction = regexp.MustCompile(`(?im)^[\t ]*/[a-z][a-z0-9_+-]*(?:[\t \r]|$)`)

func validateMRDescription(desc *string) error {
	if desc != nil && mrQuickAction.MatchString(strings.ReplaceAll(*desc, "\r", "\n")) {
		return mrError("QUICK_ACTION_NOT_ALLOWED", "MR 描述包含独立的斜杠指令行。请用行内代码引用指令，或使用对应的结构化参数。")
	}
	return nil
}

func (g *GitLabMRClient) Create(ctx context.Context, input GitLabMRCreate) (GitLabMR, error) {
	if err := validateMRDescription(input.Description); err != nil {
		return GitLabMR{}, err
	}
	return g.write(ctx, http.MethodPost, "", http.StatusCreated, 0, input)
}

func (g *GitLabMRClient) List(ctx context.Context, q GitLabMRQuery) (GitLabMRPage, error) {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.Size == 0 {
		q.Size = 20
	}
	if q.State == "" {
		q.State = "all"
	}
	out := GitLabMRPage{Items: []GitLabMR{}, Page: q.Page, Size: q.Size}
	query := url.Values{"page": {strconv.Itoa(q.Page)}, "per_page": {strconv.Itoa(q.Size)}, "state": {q.State}, "scope": {"all"}}
	for key, value := range map[string]string{"source_branch": q.SourceBranch, "target_branch": q.TargetBranch, "search": q.Search} {
		if value != "" {
			query.Set(key, value)
		}
	}
	var rows []gitLabMRResponse
	header, err := g.request(ctx, http.MethodGet, "", query, http.StatusOK, nil, &rows)
	if err != nil {
		return out, err
	}
	if rows == nil {
		return out, mrInvalidResponse()
	}
	for _, row := range rows {
		if !row.inProject(g.projectID) {
			continue
		}
		if !row.valid(0) {
			return out, mrInvalidResponse()
		}
		out.Items = append(out.Items, row.result(false))
	}
	out.NextPage, err = mrNextPage(header, q.Page)
	return out, err
}

func (g *GitLabMRClient) Get(ctx context.Context, iid uint64) (GitLabMR, error) {
	var row gitLabMRResponse
	if _, err := g.request(ctx, http.MethodGet, mrPath(iid), nil, http.StatusOK, nil, &row); err != nil {
		return GitLabMR{}, err
	}
	if !row.valid(iid) {
		return GitLabMR{}, mrInvalidResponse()
	}
	if !row.inProject(g.projectID) {
		return GitLabMR{}, mrError("NOT_FOUND", "当前项目内没有可访问的此 IID 对应的 MR。")
	}
	return row.result(true), nil
}

type MRDiffFile struct {
	OldPath   string `json:"old_path"`
	NewPath   string `json:"new_path"`
	OldMode   string `json:"a_mode"`
	NewMode   string `json:"b_mode"`
	Diff      string `json:"diff"`
	Collapsed bool   `json:"collapsed"`
	TooLarge  bool   `json:"too_large"`
}

type MRDiff struct {
	SHA         string       `json:"head_commit_sha"`
	Files       []MRDiffFile `json:"diffs"`
	ReviewToken string       `json:"review_token,omitempty"`
}

// BindReview ties proof of a complete diff read to this execution's robot and conversation.
func (g *GitLabMRClient) BindReview(sign func(uint64, string, string) string) { g.reviewToken = sign }

func (g *GitLabMRClient) Diff(ctx context.Context, iid uint64) (MRDiff, error) {
	mr, err := g.Get(ctx, iid)
	if err != nil {
		return MRDiff{}, err
	}
	var versions []struct {
		ID  uint64 `json:"id"`
		SHA string `json:"head_commit_sha"`
	}
	suffix := mrPath(iid) + "/versions"
	if _, err = g.request(ctx, http.MethodGet, suffix, url.Values{"per_page": {"1"}}, http.StatusOK, nil, &versions); err != nil {
		return MRDiff{}, err
	}
	if len(versions) != 1 || versions[0].ID == 0 || mr.SHA == "" || versions[0].SHA != mr.SHA {
		return MRDiff{}, mrError("DIFF_NOT_READY", "MR 差异尚未对应当前提交，请稍后重新读取。")
	}
	var version struct {
		MRDiff
		ID    uint64 `json:"id"`
		State string `json:"state"`
		Size  string `json:"real_size"`
	}
	if _, err = g.request(ctx, http.MethodGet, suffix+"/"+strconv.FormatUint(versions[0].ID, 10), nil, http.StatusOK, nil, &version); err != nil {
		return MRDiff{}, err
	}
	size, err := strconv.Atoi(version.Size)
	if err != nil || size == 0 || version.State != "collected" || version.ID != versions[0].ID || version.SHA != mr.SHA || size != len(version.Files) {
		return MRDiff{}, mrError("DIFF_INCOMPLETE", "GitLab 未返回完整差异，无法完成代码审查。")
	}
	for _, file := range version.Files {
		if file.OldPath == "" || file.NewPath == "" || file.Diff == "" || file.Collapsed || file.TooLarge || strings.HasPrefix(file.Diff, "Binary files ") {
			return MRDiff{}, mrError("DIFF_INCOMPLETE", "文件缺少完整文本差异，请由维护者审查。")
		}
	}
	result := MRDiff{SHA: version.SHA, Files: version.Files}
	if g.reviewToken != nil {
		result.ReviewToken = g.reviewToken(iid, mr.SHA, mr.TargetBranch)
		encoded, err := json.Marshal(result)
		if err != nil {
			return MRDiff{}, err
		}
		if len(encoded) > agentcore.ToolOutputMaxBytes {
			return MRDiff{}, mrError("DIFF_INCOMPLETE", "差异超出助手可保留的完整工具输出大小，无法完成代码审查。")
		}
	}
	return result, nil
}

func (g *GitLabMRClient) Update(ctx context.Context, iid uint64, input GitLabMRUpdate) (GitLabMR, error) {
	if input == (GitLabMRUpdate{}) {
		return GitLabMR{}, mrError("INVALID_ARGUMENTS", "请至少提供一个 MR 更新字段。")
	}
	if err := validateMRDescription(input.Description); err != nil {
		return GitLabMR{}, err
	}
	if _, err := g.Get(ctx, iid); err != nil {
		return GitLabMR{}, err
	}
	return g.write(ctx, http.MethodPut, mrPath(iid), http.StatusOK, iid, input)
}

func (g *GitLabMRClient) Merge(ctx context.Context, iid uint64, input GitLabMRMerge) (GitLabMR, error) {
	if _, err := hex.DecodeString(input.SHA); err != nil || (len(input.SHA) != 40 && len(input.SHA) != 64) {
		return GitLabMR{}, mrError("INVALID_ARGUMENTS", "请提供已确认的完整源分支提交 SHA。")
	}
	mr, err := g.Get(ctx, iid)
	if err != nil {
		return GitLabMR{}, err
	}
	if g.reviewToken != nil {
		expected := g.reviewToken(iid, input.SHA, mr.TargetBranch)
		if expected == "" || mr.SHA != input.SHA || !hmac.Equal([]byte(expected), []byte(input.ReviewToken)) {
			return GitLabMR{}, mrError("REVIEW_REQUIRED", "请在当前会话读取并审查此 MR 当前提交的完整差异。")
		}
	}
	out, err := g.write(ctx, http.MethodPut, mrPath(iid)+"/merge", http.StatusOK, iid, input)
	if err == nil && out.State != "merged" {
		return GitLabMR{}, mrUnknown()
	}
	return out, err
}

func mrPath(iid uint64) string { return "/" + strconv.FormatUint(iid, 10) }

func (g *GitLabMRClient) write(ctx context.Context, method, suffix string, status int, iid uint64, input any) (GitLabMR, error) {
	var row gitLabMRResponse
	if _, err := g.request(ctx, method, suffix, nil, status, input, &row); err != nil {
		return GitLabMR{}, err
	}
	if !row.valid(iid) || !row.inProject(g.projectID) {
		return GitLabMR{}, mrUnknown()
	}
	return row.result(false), nil
}

func mrInvalidResponse() error {
	return mrError("INVALID_RESPONSE", "GitLab 返回了无效或过大的 MR 响应。列表查询可使用更小的 page_size。")
}

func mrRequestFailed(ctx context.Context, err error, write bool) error {
	if write {
		return mrUnknown()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return mrError("TIMEOUT", "GitLab MR 请求超时。")
	}
	if ctx.Err() != nil {
		return mrError("CANCELLED", "GitLab MR 请求已取消。")
	}
	return mrError("UNAVAILABLE", "无法访问 GitLab MR API。")
}

func (g *GitLabMRClient) request(ctx context.Context, method, suffix string, query url.Values, status int, input, output any) (http.Header, error) {
	write := input != nil
	var body io.Reader
	if write {
		data, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
	}
	endpoint := g.endpoint + suffix
	if len(query) != 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, mrError("UNAVAILABLE", "GitLab MR 请求地址无效。")
	}
	if err = ctx.Err(); err != nil {
		return nil, mrRequestFailed(ctx, err, false)
	}
	req.Header.Set("PRIVATE-TOKEN", g.token)
	req.Header.Set("Accept", "application/json")
	if write {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := g.client.Do(req)
	if err != nil {
		return nil, mrRequestFailed(ctx, err, write)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != status {
		return nil, mrStatusError(res.StatusCode, write, strings.HasSuffix(suffix, "/merge"))
	}
	const maxBodyBytes = 16 << 20
	limited := &io.LimitedReader{R: res.Body, N: maxBodyBytes + 1}
	decoder := json.NewDecoder(limited)
	err = decoder.Decode(output)
	if err == nil {
		var extra json.RawMessage
		err = decoder.Decode(&extra)
		if errors.Is(err, io.EOF) && limited.N > 0 {
			return res.Header, nil
		}
	}
	if write {
		return nil, mrUnknown()
	}
	return nil, mrInvalidResponse()
}

func mrStatusError(status int, write, merge bool) error {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return mrError("ACCESS_DENIED", "GitLab 拒绝访问。请检查个人首选凭证的 API scope 和 GitLab 项目权限。")
	case status == http.StatusNotFound:
		return mrError("NOT_FOUND", "GitLab 项目或 MR 不存在，或当前凭证不可见。")
	case status == http.StatusConflict && merge:
		return mrError("SHA_MISMATCH", "源分支 HEAD 已变化。请重新读取 MR 并确认新 SHA 后再合并。")
	case status == http.StatusConflict:
		return mrError("CONFLICT", "GitLab 报告 MR 写入冲突。创建时可按源和目标分支查询已有 MR。")
	case merge && (status == http.StatusMethodNotAllowed || status == http.StatusUnprocessableEntity):
		return mrError("MERGE_BLOCKED", "GitLab 当前拒绝合并。请读取 MR 的合并状态和流水线状态。")
	case status == http.StatusBadRequest || status == http.StatusUnprocessableEntity:
		return mrError("REJECTED", "GitLab 拒绝了 MR 参数或当前状态下的操作。")
	case status == http.StatusTooManyRequests:
		return mrError("RATE_LIMITED", "GitLab MR API 请求频率受限，请稍后重试。")
	case write && (status < 400 || status >= 500 || status == http.StatusRequestTimeout):
		return mrUnknown()
	default:
		return mrError("UNAVAILABLE", "GitLab MR 请求失败。")
	}
}

func mrNextPage(header http.Header, current int) (*int, error) {
	raw := strings.TrimSpace(header.Get("X-Next-Page"))
	if raw == "" {
		for _, link := range strings.Split(strings.Join(header.Values("Link"), ","), ",") {
			address, relation, ok := strings.Cut(strings.TrimSpace(link), ">;")
			if !ok || !strings.HasPrefix(address, "<") || strings.TrimSpace(relation) != `rel="next"` {
				continue
			}
			next, err := url.Parse(address[1:])
			if err != nil || next.Query().Get("page") == "" {
				return nil, mrInvalidResponse()
			}
			raw = next.Query().Get("page")
			break
		}
	}
	if raw == "" {
		return nil, nil
	}
	page, err := strconv.Atoi(raw)
	if err != nil || page != current+1 {
		return nil, mrInvalidResponse()
	}
	return &page, nil
}
