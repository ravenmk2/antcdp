package integrations

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

const mrTestPath = "/gitlab/api/v4/projects/97/merge_requests"
const mrTestSHA = "0123456789abcdef0123456789abcdef01234567"
const mrTestResponse = `{"iid":14,"source_project_id":97,"target_project_id":97,"state":"opened","draft":false,"description":"notes","head_pipeline":{"status":"success"},"web_url":"https://gitlab.example/team/project/-/merge_requests/14"}`

func mrTestClient(t *testing.T, handler http.HandlerFunc) *GitLabMRClient {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") != "fixture" || r.Header.Get("Accept") != "application/json" {
			t.Error("missing GitLab headers")
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	return &GitLabMRClient{client: server.Client(), endpoint: server.URL + mrTestPath, projectID: "97", token: "fixture"}
}

func requireMRFailure(t *testing.T, err error, code string, unknown bool) {
	t.Helper()
	var failure *GitLabMRFailure
	if !errors.As(err, &failure) || failure.Code != "GITLAB_MR_"+code || failure.Unknown != unknown {
		t.Fatalf("expected MR error %s, unknown=%v; got %v", code, unknown, err)
	}
}

func TestGitLabMRWriteRequests(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	g := mrTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, mrTestPath)
		mu.Lock()
		calls = append(calls, r.Method+" "+path)
		mu.Unlock()
		var body map[string]json.RawMessage
		if r.Method != http.MethodGet {
			if r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(r.Body).Decode(&body) != nil {
				t.Error("invalid JSON request")
			}
		}
		response := mrTestResponse
		switch {
		case r.Method == http.MethodPost && path == "":
			if string(body["source_branch"]) != `"feature/a"` || string(body["target_branch"]) != `"main"` || body["target_project_id"] != nil {
				t.Error("incorrect create fields")
			}
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPut && path == "/14":
			if len(body) != 4 || string(body["description"]) != `""` || string(body["assignee_ids"]) != "[]" || string(body["squash"]) != "false" || string(body["state_event"]) != `"close"` {
				t.Error("PATCH semantics were lost in the update")
			}
		case r.Method == http.MethodPut && path == "/14/merge":
			if string(body["sha"]) != `"`+mrTestSHA+`"` || string(body["should_remove_source_branch"]) != "false" || body["auto_merge"] != nil {
				t.Error("incorrect merge fields")
			}
			response = strings.Replace(response, `"opened"`, `"merged"`, 1)
		case r.Method == http.MethodGet && path == "/14":
		default:
			t.Errorf("unexpected MR route %s %s", r.Method, r.URL.Path)
		}
		_, _ = io.WriteString(w, response)
	})
	ctx := t.Context()
	if mr, err := g.Create(ctx, GitLabMRCreate{SourceBranch: "feature/a", TargetBranch: "main", Title: "Changes"}); err != nil || mr.IID != 14 {
		t.Fatalf("create: %+v, %v", mr, err)
	}
	detail, err := g.Get(ctx, 14)
	if err != nil || detail.Description == nil || *detail.Description != "notes" || detail.PipelineStatus != "success" {
		t.Fatalf("get: %+v, %v", detail, err)
	}
	update := GitLabMRUpdate{StateEvent: new("close"), GitLabMRFields: GitLabMRFields{
		Description: new(""), AssigneeIDs: new([]uint64{}), Squash: new(false),
	}}
	if _, err = g.Update(ctx, 14, update); err != nil {
		t.Fatal(err)
	}
	if mr, err := g.Merge(ctx, 14, GitLabMRMerge{SHA: mrTestSHA, RemoveSourceBranch: new(false)}); err != nil || mr.State != "merged" {
		t.Fatalf("merge: %+v, %v", mr, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if got := strings.Join(calls, "|"); got != "POST |GET /14|GET /14|PUT /14|GET /14|PUT /14/merge" {
		t.Fatalf("unexpected requests: %s", got)
	}
}

func TestGitLabMRRobotReview(t *testing.T) {
	var changed atomic.Bool
	var writes atomic.Int32
	g := mrTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		sha := mrTestSHA
		if changed.Load() {
			sha = strings.Repeat("a", 40)
		}
		switch strings.TrimPrefix(r.URL.Path, mrTestPath) {
		case "/14":
			_, _ = io.WriteString(w, strings.Replace(mrTestResponse, `"iid":14`, `"sha":"`+sha+`","target_branch":"main","iid":14`, 1))
		case "/14/versions":
			_, _ = io.WriteString(w, `[{"id":8,"head_commit_sha":"`+sha+`"}]`)
		case "/14/versions/8":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": 8, "state": "collected", "real_size": "1", "head_commit_sha": sha,
				"diffs": []MRDiffFile{{OldPath: "Dockerfile", NewPath: "Dockerfile", NewMode: "100644", NewFile: true}},
			})
		case "/14/merge":
			var body map[string]any
			if r.Method != http.MethodPut || json.NewDecoder(r.Body).Decode(&body) != nil || body["sha"] != sha || body["review_token"] != nil {
				t.Error("unexpected merge request")
			}
			writes.Add(1)
			_, _ = io.WriteString(w, strings.Replace(mrTestResponse, "opened", "merged", 1))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	})
	g.BindReview(func(_ uint64, sha, branch string) string { return sha + "-" + branch })
	ctx := t.Context()
	_, err := g.Merge(ctx, 14, GitLabMRMerge{SHA: mrTestSHA})
	requireMRFailure(t, err, "REVIEW_REQUIRED", false)
	diff, err := g.Diff(ctx, 14)
	if err != nil || diff.ReviewToken == "" || len(diff.Files) != 1 || !diff.Files[0].NewFile || diff.Files[0].Diff != "" {
		t.Fatal(diff, err)
	}
	changed.Store(true)
	for _, sha := range []string{mrTestSHA, strings.Repeat("a", 40)} {
		_, err = g.Merge(ctx, 14, GitLabMRMerge{SHA: sha, ReviewToken: diff.ReviewToken})
		requireMRFailure(t, err, "REVIEW_REQUIRED", false)
	}
	if writes.Load() != 0 {
		t.Fatal("merged before fresh review")
	}
	fresh, err := g.Diff(ctx, 14)
	if err != nil {
		t.Fatal(err)
	}
	_, err = g.Merge(ctx, 14, GitLabMRMerge{SHA: fresh.SHA, ReviewToken: fresh.ReviewToken})
	if err != nil || writes.Load() != 1 {
		t.Fatal("fresh review merge", err)
	}
}

func TestGitLabMRDiffReturnsGitLabFileStatus(t *testing.T) {
	for _, tc := range []struct {
		name, state, size string
		files             []MRDiffFile
		status            int
		sha, errorCode    string
	}{
		{
			name: "partial", state: "overflow", size: "1000+",
			files: []MRDiffFile{
				{OldPath: "config.yml", NewPath: "config.yml", Collapsed: true},
				{OldPath: "index.json", NewPath: "index.json", TooLarge: true},
				{OldPath: "old.png", NewPath: "new.png", Diff: "Binary files differ", RenamedFile: true},
			},
		},
		{name: "empty version", state: "without_files", size: "0", files: []MRDiffFile{}},
		{name: "mismatched commit", sha: strings.Repeat("a", 40), errorCode: "DIFF_NOT_READY"},
		{name: "GitLab rejection", status: http.StatusForbidden, errorCode: "ACCESS_DENIED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g := mrTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch strings.TrimPrefix(r.URL.Path, mrTestPath) {
				case "/14":
					_, _ = io.WriteString(w, strings.Replace(mrTestResponse, `"iid":14`, `"sha":"`+mrTestSHA+`","iid":14`, 1))
				case "/14/versions":
					_, _ = io.WriteString(w, `[{"id":8,"head_commit_sha":"`+mrTestSHA+`"}]`)
				case "/14/versions/8":
					if tc.status != 0 {
						w.WriteHeader(tc.status)
						return
					}
					sha := tc.sha
					if sha == "" {
						sha = mrTestSHA
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": 8, "head_commit_sha": sha,
						"state": tc.state, "real_size": tc.size, "diffs": tc.files})
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
				}
			})
			g.BindReview(func(_ uint64, sha, _ string) string { return sha })
			diff, err := g.Diff(t.Context(), 14)
			if tc.errorCode != "" {
				requireMRFailure(t, err, tc.errorCode, false)
				return
			}
			if err != nil || diff.SHA != mrTestSHA || diff.ReviewToken != mrTestSHA || diff.State != tc.state || diff.RealSize != tc.size || diff.Files == nil || !slices.Equal(diff.Files, tc.files) {
				t.Fatalf("unexpected diff: %+v, %v", diff, err)
			}
		})
	}
}

func TestGitLabMRProjectBoundaryAndPagination(t *testing.T) {
	const fork = `{"iid":14,"source_project_id":98,"target_project_id":97,"state":"opened"}`
	g := mrTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("fork MR was sent for mutation: %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		switch r.URL.Path {
		case mrTestPath:
			q := r.URL.Query()
			if q.Get("scope") != "all" || q.Get("state") != "opened" || q.Get("source_branch") != "feature/a+b" || q.Get("per_page") != "1" {
				t.Errorf("incorrect search parameters: %v", q)
			}
			if q.Get("page") == "1" {
				w.Header().Set("Link", `<https://gitlab.example/gitlab/api/v4/projects/97/merge_requests?page=2>; rel="next"`)
				_, _ = io.WriteString(w, "["+fork+"]")
			} else {
				_, _ = io.WriteString(w, "["+mrTestResponse+"]")
			}
		case mrTestPath + "/14":
			_, _ = io.WriteString(w, fork)
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
		}
	})
	query := GitLabMRQuery{State: "opened", SourceBranch: "feature/a+b", Size: 1}
	first, err := g.List(t.Context(), query)
	if err != nil || first.Items == nil || len(first.Items) != 0 || first.NextPage == nil || *first.NextPage != 2 {
		t.Fatalf("first page: %+v, %v", first, err)
	}
	query.Page = *first.NextPage
	last, err := g.List(t.Context(), query)
	if err != nil || len(last.Items) != 1 || last.Items[0].Description != nil || last.NextPage != nil {
		t.Fatalf("last page: %+v, %v", last, err)
	}
	_, err = g.Get(t.Context(), 14)
	requireMRFailure(t, err, "NOT_FOUND", false)
	_, err = g.Update(t.Context(), 14, GitLabMRUpdate{Title: new("New title")})
	requireMRFailure(t, err, "NOT_FOUND", false)
	_, err = g.Merge(t.Context(), 14, GitLabMRMerge{SHA: mrTestSHA})
	requireMRFailure(t, err, "NOT_FOUND", false)
}

func TestGitLabMRRejectsUnsafeArgumentsBeforeNetwork(t *testing.T) {
	g := &GitLabMRClient{}
	for _, desc := range []string{"/merge", "Description\r/MERGE", "Description\r\n\t/approve\t ", "Description\n/label urgent"} {
		_, err := g.Create(t.Context(), GitLabMRCreate{GitLabMRFields: GitLabMRFields{Description: &desc}})
		requireMRFailure(t, err, "QUICK_ACTION_NOT_ALLOWED", false)
		_, err = g.Update(t.Context(), 14, GitLabMRUpdate{GitLabMRFields: GitLabMRFields{Description: &desc}})
		requireMRFailure(t, err, "QUICK_ACTION_NOT_ALLOWED", false)
	}
	if err := validateMRDescription(new("Use `/merge`, or see:\n/api/v4/projects")); err != nil {
		t.Fatal(err)
	}
	_, err := g.Update(t.Context(), 14, GitLabMRUpdate{})
	requireMRFailure(t, err, "INVALID_ARGUMENTS", false)
	_, err = g.Merge(t.Context(), 14, GitLabMRMerge{SHA: strings.Repeat("z", 40)})
	requireMRFailure(t, err, "INVALID_ARGUMENTS", false)
}

func TestGitLabMRMergeOutcome(t *testing.T) {
	for _, test := range []struct {
		name, body, code string
		status           int
		unknown          bool
	}{
		{"stale SHA", "", "SHA_MISMATCH", 409, false},
		{"merge checks", "", "MERGE_BLOCKED", 405, false},
		{"rate limited", "", "RATE_LIMITED", 429, false},
		{"upstream error after dispatch", "", "OUTCOME_UNKNOWN", 502, true},
		{"truncated response", "{", "OUTCOME_UNKNOWN", 200, true},
		{"no confirmed merge", mrTestResponse, "OUTCOME_UNKNOWN", 200, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var writes atomic.Int32
			g := mrTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					_, _ = io.WriteString(w, mrTestResponse)
					return
				}
				writes.Add(1)
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, test.body)
			})
			_, err := g.Merge(t.Context(), 14, GitLabMRMerge{SHA: mrTestSHA})
			requireMRFailure(t, err, test.code, test.unknown)
			if count := writes.Load(); count != 1 {
				t.Fatalf("got %d writes", count)
			}
		})
	}
}
