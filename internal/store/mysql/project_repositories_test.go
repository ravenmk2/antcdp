package mysql

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const repositoryTestProjectCode = "292001"

// Return a check to repeat after the existing fixture unlinks the repository.
func verifyAgentRepositoryAccess(t *testing.T, db *Store, user, project, connection, repository string) func() {
	t.Helper()
	id := func(value string) uint64 {
		v, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	checkCode := func(err error, want string) {
		t.Helper()
		var failure *httpx.Error
		if !errors.As(err, &failure) || failure.Code != want {
			t.Fatalf("want %s, got %v", want, err)
		}
	}
	svc := integrations.Service{Store: func() (identity.Store, error) { return db, nil }}
	auth := agentcore.Authorization{AccountID: agentcore.ID(id(user))}
	if err := db.db.Get(&auth.AccountVersion, "SELECT auth_version FROM user WHERE id=?", user); err != nil {
		t.Fatal(err)
	}
	query := integrations.RepoQuery{Page: 1, Size: 1}
	_, err := svc.AgentRepoList(t.Context(), auth, repositoryTestProjectCode, query)
	checkCode(err, "NOT_FOUND")
	auth.Grants = []agentcore.ResourceGrant{{Kind: "project", ID: agentcore.ID(id(project)), Role: "member"}}
	page, err := svc.AgentRepoList(t.Context(), auth, repositoryTestProjectCode, query)
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != id(repository) || page.Items[0].Connection != id(connection) {
		t.Fatalf("repository page: %+v, %v", page, err)
	}
	for _, code := range []string{project, "missing-project-code"} {
		_, err := svc.AgentRepoList(t.Context(), auth, code, query)
		checkCode(err, "NOT_FOUND")
	}
	_, err = svc.AgentRepoList(t.Context(), auth, "Invalid code", query)
	checkCode(err, "VALIDATION_FAILED")
	_, err = svc.AgentGitCredential(t.Context(), auth, id(connection), true)
	checkCode(err, "PERSONAL_PREFERRED_REQUIRED") // A project credential is configured.
	return func() {
		_, err := svc.AgentGitRemote(t.Context(), auth, id(repository))
		checkCode(err, "NOT_FOUND")
	}
}

func verifyProjectRepositories(t *testing.T, db *Store, admin, member, other *apiClient, adminID, memberID string) {
	fixture := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") != "repository-fixture-token" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		item := map[string]any{"id": json.Number("123"), "name": "remote-service", "path_with_namespace": "engineering/remote-service", "namespace": map[string]string{"full_path": "engineering"}, "web_url": "https://git.example/engineering/remote-service", "default_branch": "main", "archived": false}

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
	p := testData(admin.call(t, "POST", "/projects", map[string]any{"code": repositoryTestProjectCode, "name": "仓库关联验收", "admin_user_ids": []string{memberID}}, 201, nil))
	pid := p["id"].(string)
	base := "/projects/" + pid + "/repositories"
	catalog := "/admin/projects/" + pid + "/repository-connections"
	cv := testData(admin.call(t, "POST", "/admin/service-connections/gitlab", map[string]any{"name": "仓库专用 GitLab", "config": map[string]any{"base_url": remoteURL}}, 201, nil))
	cid := cv["id"].(string)
	connection := "/admin/service-connections/gitlab/" + cid
	grantServiceConnection(t, admin, connection, "project", pid, true)
	member.call(t, "GET", base, nil, 200, nil)
	other.call(t, "GET", base, nil, 404, nil)
	member.call(t, "GET", catalog, nil, 200, nil)
	member.call(t, "POST", base, map[string]any{"connection_id": cid, "repo_ids": []string{"123"}}, 409, nil)
	admin.call(t, "GET", catalog+"/"+cid+"/repos", nil, 409, nil)
	etag := func(path string) map[string]string {
		admin.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": admin.last.Header().Get("ETag")}
	}
	sys := "/projects/" + pid + "/service-connections/gitlab/" + cid + "/credentials"
	cred := testData(admin.call(t, "POST", "/projects/"+pid+"/credentials", map[string]any{"name": "repository token", "kind": "secret", "material": map[string]string{"value": "repository-fixture-token"}}, 201, nil))
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
	requireUnlinked := verifyAgentRepositoryAccess(t, db, memberID, pid, cid, linkedItem["id"].(string))
	verifyRepositoryLabels(t, db, admin, member, other, pid, linkedItem["id"].(string))
	linkedTag := collection()
	admin.call(t, "POST", base+"/batch-unlink", map[string]any{"ids": []string{linkedItem["id"].(string)}}, 200, map[string]string{"If-Match": linkedTag})
	requireUnlinked()
	labelsAfterUnlink := testData(admin.call(t, "GET", "/projects/"+pid+"/repository-labels", nil, 200, nil))["items"].([]any)
	if len(labelsAfterUnlink) != 1 || labelsAfterUnlink[0].(map[string]any)["repository_count"] != float64(0) {
		t.Fatal("unlink must retain dictionary and remove bindings", labelsAfterUnlink)
	}
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
	member.call(t, "POST", base+"/"+id+"/refresh", map[string]any{}, 428, nil)
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
