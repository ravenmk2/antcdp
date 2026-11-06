package mysql

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func verifyProjectRepositories(t *testing.T, db *Store, admin, member, other *apiClient, adminID, memberID string) {
	branches := map[string]string{"main": strings.Repeat("a", 40)}
	var branchMu sync.Mutex
	releaseFixture := releaseGitFixture()
	fixture := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") == "release-personal-fixture" {
			releaseFixture.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("PRIVATE-TOKEN") != "repository-fixture-token" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		item := map[string]any{"id": json.Number("123"), "name": "remote-service", "path_with_namespace": "engineering/remote-service", "namespace": map[string]string{"full_path": "engineering"}, "web_url": "https://git.example/engineering/remote-service", "default_branch": "main", "archived": false}

		if strings.HasPrefix(r.URL.Path, "/api/v4/projects/123/repository/branches") {
			branchMu.Lock()
			defer branchMu.Unlock()
			name := strings.TrimPrefix(r.URL.Path, "/api/v4/projects/123/repository/branches/")
			branch := func(name, commit string) map[string]any {
				return map[string]any{"name": name, "commit": map[string]string{"id": commit}, "protected": false, "default": name == "main"}
			}
			if r.Method == "POST" {
				if err := r.ParseForm(); err != nil {
					w.WriteHeader(400)
					return
				}
				name = r.Form.Get("branch")
				if _, exists := branches[name]; exists {
					w.WriteHeader(400)
					return
				}
				commit := r.Form.Get("ref")
				if commit != strings.Repeat("a", 40) {
					w.WriteHeader(400)
					return
				}
				branches[name] = commit
				if name == "custom/unknown-response" {
					w.WriteHeader(500)
					return
				}
				w.WriteHeader(201)
				_ = json.NewEncoder(w).Encode(branch(name, commit))
				return
			}
			if r.URL.Path == "/api/v4/projects/123/repository/branches" {
				_ = json.NewEncoder(w).Encode([]any{branch("main", branches["main"])})
				return
			}
			commit, ok := branches[name]
			if !ok {
				w.WriteHeader(404)
				return
			}
			_ = json.NewEncoder(w).Encode(branch(name, commit))
			return
		}
		switch r.URL.Path {
		case "/api/v4/projects/123":
			_ = json.NewEncoder(w).Encode(item)
		case "/api/v4/projects":
			w.Header().Set("X-Next-Page", "2")
			_ = json.NewEncoder(w).Encode([]any{item})
		case "/api/v4/groups":
			_ = json.NewEncoder(w).Encode([]any{map[string]any{"id": 5, "name": "engineering", "full_path": "engineering"}})
		case "/api/v4/groups/5/projects":
			if r.URL.Query().Get("with_shared") != "false" || r.URL.Query().Get("include_subgroups") != "true" {
				w.WriteHeader(400)
				return
			}
			_ = json.NewEncoder(w).Encode([]any{item})
		default:
			w.WriteHeader(404)
		}
	}))
	_ = fixture.Listener.Close()
	listener, e := net.Listen("tcp4", "0.0.0.0:0")
	if e != nil {
		t.Fatal(e)
	}
	fixture.Listener = listener
	fixture.Start()
	defer fixture.Close()
	addresses, e := net.InterfaceAddrs()
	if e != nil {
		t.Fatal(e)
	}
	host := ""
	for _, a := range addresses {
		ip, _, _ := net.ParseCIDR(a.String())
		if ip.To4() != nil && ip.IsPrivate() && !ip.IsLoopback() {
			host = ip.String()
			break
		}
	}
	if host == "" {
		t.Fatal("integration fixture requires private network address")
	}
	remoteURL := "http://" + net.JoinHostPort(host, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	p := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "repo_project", "name": "仓库关联验收", "admin_user_ids": []string{memberID}}, 201, nil))
	pid := p["id"].(string)
	base := "/projects/" + pid + "/repositories"
	catalog := "/admin/projects/" + pid + "/repository-connections"
	cv := testData(admin.call(t, "POST", "/admin/service-connections/gitlab", map[string]any{"name": "仓库专用 GitLab", "config": map[string]any{"base_url": remoteURL}}, 201, nil))
	cid := cv["id"].(string)
	connection := "/admin/service-connections/gitlab/" + cid
	member.call(t, "GET", base, nil, 200, nil)
	other.call(t, "GET", base, nil, 404, nil)
	member.call(t, "GET", catalog, nil, 403, nil)
	member.call(t, "POST", base, map[string]any{"connection_id": cid, "repo_ids": []string{"123"}}, 403, nil)
	admin.call(t, "GET", catalog+"/"+cid+"/repos", nil, 409, nil)
	etag := func(path string) map[string]string {
		admin.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": admin.last.Header().Get("ETag")}
	}
	sys := connection + "/credentials"
	cred := testData(admin.call(t, "POST", sys, map[string]any{"name": "repository token", "authentication": map[string]any{"auth_method": "gitlab_access_token", "identity_config": map[string]any{}, "secret": map[string]string{"token": "repository-fixture-token"}}}, 201, etag(sys)))
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": cred["id"].(string)}, 200, etag(sys+"/preferred"))
	browse := testData(admin.call(t, "GET", catalog+"/"+cid+"/repos?q=remote", nil, 200, nil))
	cursor := browse["next_cursor"].(string)
	admin.call(t, "GET", catalog+"/"+cid+"/repos?page_size=10&cursor="+cursor, nil, 422, nil)
	admin.call(t, "GET", catalog+"/"+cid+"/repos?page_size=0", nil, 422, nil)
	admin.call(t, "GET", catalog+"/"+cid+"/repos?page_size=101", nil, 422, nil)

	admin.call(t, "GET", catalog+"/"+cid+"/repos?q=different&cursor="+cursor, nil, 422, nil)
	admin.call(t, "GET", catalog+"/"+cid+"/containers", nil, 200, nil)
	admin.call(t, "GET", catalog+"/"+cid+"/repos?container_id=5&recursive=true", nil, 200, nil)
	collection := func() string { return testData(admin.call(t, "GET", base, nil, 200, nil))["mutation_version"].(string) }
	admin.call(t, "POST", base, map[string]any{"connection_id": cid, "repo_ids": []string{"123", "404"}}, 502, map[string]string{"If-Match": collection()})
	linked := testData(admin.call(t, "POST", base, map[string]any{"connection_id": cid, "repo_ids": []string{"123"}}, 201, map[string]string{"If-Match": collection()}))
	linkedItem := linked["items"].([]any)[0].(map[string]any)
	admin.call(t, "POST", base, map[string]any{"connection_id": cid, "repo_ids": []string{"123"}}, 409, map[string]string{"If-Match": collection()})
	admin.call(t, "POST", base+"/"+linkedItem["id"].(string)+"/refresh", map[string]any{}, 200, map[string]string{"If-Match": linkedItem["etag"].(string)})
	diagnostic := testData(member.call(t, "GET", base+"/"+linkedItem["id"].(string)+"/diagnostics", nil, 200, nil))
	if diagnostic["latest"].(map[string]any)["status"] != "succeeded" {
		t.Fatal("missing successful sync diagnostic")
	}
	if strings.Contains(fmt.Sprint(diagnostic), "credential_id") {
		t.Fatal("diagnostic leaked credential ID")
	}
	verifyProjectDelivery(t, db, admin, member, other, pid, linkedItem["id"].(string))
	standard := testData(member.call(t, "GET", "/projects/"+pid+"/variants", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	verifyReleaseWorkflow(t, member, "/projects/"+pid+"/variants/"+standard["id"].(string), cid)
	linkedTag := collection()
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{linkedItem["id"].(string)}}, 200, map[string]string{"If-Match": linkedTag})
	// Seed remote snapshots to test storage/authorization independently of remote credentials/network.
	for _, repoID := range []string{"AbC", "abc", "9223372036854775800"} {
		_, e := db.db.Exec(`INSERT INTO project_repository(project_id,connection_id,repo_id,name,namespace_path,full_path,last_synced_at,created_by_user_id,created_at,updated_at) VALUES(?,?,?,'service','org','org/service',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, pid, cid, repoID, adminID)
		if e != nil {
			t.Fatal(e)
		}
	}
	list := func() map[string]any { return testData(admin.call(t, "GET", base, nil, 200, nil)) }
	v := list()
	if v["total"] != float64(3) {
		t.Fatal("case-sensitive platform IDs or list failed")
	}
	items := v["items"].([]any)
	id := items[0].(map[string]any)["id"].(string)
	tag := v["mutation_version"].(string)
	memberData := fmt.Sprint(member.call(t, "GET", base, nil, 200, nil))
	for _, secret := range []string{"secret_ciphertext", "credential_id", "config_version"} {
		if strings.Contains(memberData, secret) {
			t.Fatal("private data leaked")
		}
	}
	member.call(t, "POST", base+"/"+id+"/refresh", map[string]any{}, 403, nil)
	admin.call(t, "GET", connection, nil, 200, nil)
	ct := admin.last.Header().Get("ETag")
	admin.call(t, "PATCH", connection, map[string]any{"config": map[string]any{"base_url": "https://other.example.com"}}, 409, map[string]string{"If-Match": ct})
	admin.call(t, "DELETE", connection, nil, 409, map[string]string{"If-Match": ct})
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{id}}, 428, nil)
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{id, "999999999"}}, 404, map[string]string{"If-Match": tag})
	if list()["total"] != float64(3) {
		t.Fatal("partial batch unlink committed")
	}
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{id}}, 200, map[string]string{"If-Match": tag})
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{id}}, 412, map[string]string{"If-Match": tag})
	admin.call(t, "GET", "/projects/"+pid, nil, 200, nil)
	pt := admin.last.Header().Get("ETag")
	admin.call(t, "POST", "/projects/"+pid+"/archive", map[string]any{}, 204, map[string]string{"If-Match": pt})
	v = list()
	id = v["items"].([]any)[0].(map[string]any)["id"].(string)
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{id}}, 409, map[string]string{"If-Match": v["mutation_version"].(string)})
	member.call(t, "GET", base, nil, 200, nil)
	n, _ := strconv.Atoi(pid)
	var count int
	if e := db.db.Get(&count, "SELECT COUNT(*) FROM audit_event WHERE action='project_repository.unlinked' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.project_id'))=?", fmt.Sprint(n)); e != nil || count != 2 {
		t.Fatalf("audit not atomic: %v count %d", e, count)
	}
}
