package mysql

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

func releaseGitFixture() http.Handler {
	var mu sync.Mutex
	a, b, c := strings.Repeat("a", 40), strings.Repeat("b", 40), strings.Repeat("c", 40)
	branches := map[string]string{"main": a}
	tags := map[string]string{}
	lostTagRead := false
	mrs := map[uint64]i.ReleaseMR{1: {IID: 1, Title: "报表", State: "opened", Source: "feature/reports", Target: "main", Head: b}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		respond := func(v any) { _ = json.NewEncoder(w).Encode(v) }
		if r.URL.Path == "/api/v4/user" {
			respond(i.GitActor{ID: 19, Username: "test-manager"})
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/api/v4/projects/123")
		_ = r.ParseForm()
		switch {
		case strings.HasPrefix(p, "/repository/branches/"):
			name := strings.TrimPrefix(p, "/repository/branches/")
			sha, ok := branches[name]
			if !ok {
				w.WriteHeader(404)
				return
			}
			respond(map[string]any{"name": name, "commit": map[string]string{"id": sha}})
		case p == "/repository/branches" && r.Method == "POST":
			name := r.Form.Get("branch")
			branches[name] = r.Form.Get("ref")
			respond(map[string]any{"name": name, "commit": map[string]string{"id": branches[name]}})
		case strings.HasSuffix(p, "/revert"):
			branches[r.Form.Get("branch")] = c
			respond(i.ReleaseCommit{ID: c})
		case p == "/merge_requests" && r.Method == "POST":
			mrs[2] = i.ReleaseMR{IID: 2, Title: "撤回报表", State: "opened", Head: c, Target: "main", Source: r.Form.Get("source_branch")}
			respond(mrs[2])
		case p == "/merge_requests":
			respond([]i.ReleaseMR{mrs[1]})
		case strings.HasPrefix(p, "/merge_requests/"):
			parts := strings.Split(strings.TrimPrefix(p, "/merge_requests/"), "/")
			iid, _ := strconv.ParseUint(parts[0], 10, 64)
			m, ok := mrs[iid]
			if !ok {
				w.WriteHeader(404)
				return
			}
			if len(parts) == 2 && parts[1] == "commits" {
				respond([]i.ReleaseCommit{{ID: m.Head}})
				return
			}
			if len(parts) == 2 && parts[1] == "merge" && r.Method == "PUT" {
				if r.Form.Get("sha") != m.Head {
					w.WriteHeader(409)
					return
				}
				m.MergeSHA = m.Head
				m.State = "merged"
				branches["main"] = m.Head
				mrs[iid] = m
			}
			respond(m)
		case p == "/repository/merge_base":
			respond(i.ReleaseCommit{ID: a})
		case p == "/repository/commits":
			rows := []i.ReleaseCommit{{ID: b}}
			if branches["main"] == c {
				rows = append(rows, i.ReleaseCommit{ID: c})
			}
			respond(rows)
		case p == "/repository/tags" && r.Method == "POST":
			tag := r.Form.Get("tag_name")
			tags[tag] = r.Form.Get("ref")
			if tag == "qa-v1.3.0" {
				lostTagRead = true
				w.WriteHeader(503)
				return
			}
			respond(map[string]string{"name": tag})
		case strings.HasPrefix(p, "/repository/tags/"):
			tag := strings.TrimPrefix(p, "/repository/tags/")
			if lostTagRead {
				lostTagRead = false
				w.WriteHeader(503)
				return
			}
			sha, ok := tags[tag]
			if !ok {
				w.WriteHeader(404)
				return
			}
			respond(map[string]any{"name": tag, "commit": map[string]string{"id": sha}})
		default:
			w.WriteHeader(404)
		}
	})
}
func verifyReleaseWorkflow(t *testing.T, manager *apiClient, variant, cid string) {
	t.Helper()
	tag := func(p string) map[string]string {
		manager.call(t, "GET", p, nil, 200, nil)
		return map[string]string{"If-Match": manager.last.Header().Get("ETag")}
	}
	personal := "/me/service-connections/gitlab/" + cid + "/credentials"
	cred := testData(manager.call(t, "POST", personal, map[string]any{"name": "release operator", "authentication": map[string]any{"auth_method": "gitlab_access_token", "identity_config": map[string]any{}, "secret": map[string]string{"token": "release-personal-fixture"}}}, 201, tag(personal)))
	manager.call(t, "PUT", personal+"/preferred", map[string]any{"credential_id": cred["id"]}, 200, tag(personal+"/preferred"))
	create := func(ver string) string {
		v := testData(manager.call(t, "POST", variant+"/releases", map[string]string{"version_label": ver}, 201, nil))
		return variant + "/releases/" + v["id"].(string)
	}
	r, other := create("1.2.0"), create("1.3.0")
	set := testData(manager.call(t, "GET", r+"/items", nil, 200, nil))
	repo := set["repositories"].([]any)[0].(map[string]any)
	repoID := repo["id"].(string)
	if repo["baseline_sha"] != strings.Repeat("a", 40) {
		t.Fatal("did not capture baseline at draft creation")
	}
	act := func(action string, body any, expected int) map[string]any {
		return manager.call(t, "POST", r+"/"+action, body, expected, tag(r))
	}
	keyNo := 0
	remote := func(action string, body any) {
		keyNo++
		hdr := tag(r)
		hdr["Idempotency-Key"] = "20000000-0000-4000-8000-00000000000" + strconv.Itoa(keyNo)
		u := testData(manager.call(t, "POST", r+"/"+action, body, 200, hdr))
		if u["status"] != "succeeded" {
			t.Fatal(action, u)
		}
		manager.call(t, "POST", r+"/"+action, body, 200, hdr)
	}
	scope := testData(act("scope-preview", map[string]string{}, 200))
	act("refresh-scope", map[string]string{"digest": scope["token"].(string)}, 200)
	mr := testData(act("select-mr", map[string]string{"repo_id": repoID, "ref": "1"}, 200))["change"].(map[string]any)
	act("start", map[string]string{}, 200)
	manager.call(t, "POST", other+"/start", map[string]string{}, 409, tag(other))
	remote("merge", map[string]string{"change_id": mr["id"].(string), "sha": strings.Repeat("b", 40)})
	remote("create-revert", map[string]string{"change_id": mr["id"].(string), "sha": strings.Repeat("b", 40)})
	flow := testData(manager.call(t, "GET", r+"/workflow", nil, 200, nil))
	rows := flow["changes"].([]any)
	if len(rows) != 2 || rows[0].(map[string]any)["status"] != "revert_pending" {
		t.Fatal("revert MR link missing")
	}
	remote("merge", map[string]string{"change_id": rows[1].(map[string]any)["id"].(string), "sha": strings.Repeat("c", 40)})
	stalePreview := testData(act("freeze-preview", map[string]string{}, 200))
	manager.call(t, "PATCH", r, map[string]string{"name": "报表发布"}, 200, tag(r))
	act("freeze", map[string]string{"digest": stalePreview["preview_token"].(string)}, 409)
	freeze := func() map[string]any {
		v := testData(act("freeze-preview", map[string]string{}, 200))
		return testData(act("freeze", map[string]string{"digest": v["preview_token"].(string)}, 200))
	}
	m := freeze()
	if m["header"].(map[string]any)["name"] != "报表发布" {
		t.Fatal("release name missing from frozen manifest")
	}
	manager.call(t, "PATCH", r, map[string]string{"name": "审核中改名"}, 409, tag(r))
	act("review", map[string]string{"manifest_id": m["id"].(string), "digest": m["digest"].(string), "decision": "return", "note": "补充说明"}, 200)
	manager.call(t, "PATCH", r, map[string]string{"name": "报表与修复", "description_md": "重新验收"}, 200, tag(r))
	oldZIP := manager.send(t, "GET", r+"/manifests/"+m["id"].(string)+"/download", nil, nil)
	verifyReleaseZIPTitle(t, oldZIP.Body.Bytes(), "报表发布")
	m = freeze()
	if m["header"].(map[string]any)["name"] != "报表与修复" {
		t.Fatal("new manifest did not freeze renamed release")
	}
	act("review", map[string]string{"manifest_id": m["id"].(string), "digest": m["digest"].(string), "decision": "pass", "note": "通过"}, 200)
	remote("archive", map[string]string{"manifest_id": m["id"].(string), "digest": m["digest"].(string)})
	if testData(manager.call(t, "GET", r, nil, 200, nil))["status"] != "archived" {
		t.Fatal("not archived")
	}
	z := manager.send(t, "GET", r+"/manifests/"+m["id"].(string)+"/download", nil, nil)
	archive, e := zip.NewReader(bytes.NewReader(z.Body.Bytes()), int64(z.Body.Len()))
	if e != nil || len(archive.File) != 2 {
		t.Fatal("empty material ZIP invalid", e)
	}
	verifyReleaseZIPTitle(t, z.Body.Bytes(), "报表与修复")
	// A waiting draft must explicitly accept the latest archived SHA.
	manager.call(t, "POST", other+"/start", map[string]string{}, 409, tag(other))
	r = other
	repo = testData(manager.call(t, "GET", r+"/items", nil, 200, nil))["repositories"].([]any)[0].(map[string]any)
	act("baseline", map[string]string{"repo_id": repo["id"].(string)}, 200)
	act("start", map[string]string{}, 200)
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	if e = writer.WriteField("metadata", `{"kind":"config","filename":"application.yaml","config_format":"yaml","config_mode":"delta","target_path":"config/application.yaml"}`); e != nil {
		t.Fatal(e)
	}
	f, e := writer.CreateFormFile("file", "application.yaml")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Write([]byte("report:\n  enabled: true")); e != nil {
		t.Fatal(e)
	}
	if e = writer.Close(); e != nil {
		t.Fatal(e)
	}
	if res := manager.sendBytes(t, "POST", r+"/items", upload.Bytes(), writer.FormDataContentType(), tag(r)); res.Code != 201 {
		t.Fatal(res.Code, res.Body.String())
	}
	m = freeze()
	body := map[string]string{"manifest_id": m["id"].(string), "digest": m["digest"].(string)}
	act("review", map[string]string{"manifest_id": body["manifest_id"], "digest": body["digest"], "decision": "pass"}, 200)
	h := tag(r)
	h["Idempotency-Key"] = "20000000-0000-4000-8000-000000000099"
	unknown := testData(manager.call(t, "POST", r+"/archive", body, 200, h))
	if unknown["status"] != "unknown" {
		t.Fatal("lost response reported as settled", unknown)
	}
	act("terminate", map[string]string{"note": "pending remote effect"}, 409)
	act("reconcile", map[string]string{"operation_id": unknown["id"].(string)}, 200)
	if testData(manager.call(t, "GET", r, nil, 200, nil))["status"] != "archived" {
		t.Fatal("failed to reconcile existing tag")
	}
	z = manager.send(t, "GET", r+"/manifests/"+m["id"].(string)+"/download", nil, nil)
	archive, e = zip.NewReader(bytes.NewReader(z.Body.Bytes()), int64(z.Body.Len()))
	if e != nil || len(archive.File) != 3 {
		t.Fatal("config revision missing from ZIP", e)
	}

}

func verifyReleaseZIPTitle(t *testing.T, content []byte, title string) {
	t.Helper()
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	readme, err := archive.Open("README.md")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = readme.Close() }()
	data, err := io.ReadAll(readme)
	if err != nil || !strings.HasPrefix(string(data), "# "+title+"\n") {
		t.Fatal("ZIP changed its frozen release title", string(data), err)
	}
}
