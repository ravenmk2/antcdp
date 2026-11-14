package mysql

import (
	"errors"
	"fmt"
	"strconv"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

func verifyRepositoryLabels(t *testing.T, db *Store, admin, member, other *apiClient, pid, rid string) {
	base := "/projects/" + pid + "/repository-labels"
	repo := "/projects/" + pid + "/repositories/" + rid
	collection := func() map[string]string {
		v := testData(admin.call(t, "GET", base, nil, 200, nil))
		return map[string]string{"If-Match": v["mutation_version"].(string)}
	}
	object := func() map[string]string {
		admin.call(t, "GET", repo, nil, 200, nil)
		return map[string]string{"If-Match": admin.last.Header().Get("ETag")}
	}
	create := map[string]any{"code": "backend", "name": " 后端服务 ", "color": "#3b82f6"}
	member.call(t, "GET", base, nil, 200, nil)
	other.call(t, "GET", base, nil, 404, nil)
	member.call(t, "POST", base, create, 403, collection())
	admin.call(t, "POST", base, create, 428, nil)
	stale := collection()
	item := testData(admin.call(t, "POST", base, create, 201, stale))["item"].(map[string]any)
	lid := item["id"].(string)
	label := base + "/" + lid
	if item["name"] != "后端服务" || item["color"] != "#3B82F6" {
		t.Fatal("label normalization", item)
	}
	admin.call(t, "POST", base, map[string]any{"code": "another", "name": "另一标签", "color": "#FFFFFF"}, 412, stale)
	admin.call(t, "POST", base, create, 409, collection())
	admin.call(t, "POST", base, map[string]any{"code": "Upper", "name": "错误", "color": "#FFFFFF"}, 422, collection())
	admin.call(t, "PATCH", label, map[string]any{"code": "changed"}, 422, collection())
	admin.call(t, "PATCH", label, map[string]any{"color": "red"}, 422, collection())
	old := object()
	admin.call(t, "PUT", repo+"/labels", map[string]any{}, 422, old)
	member.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid}}, 403, old)
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid, lid}}, 422, old)
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid, "999999999"}}, 422, old)
	bound := testData(admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid}}, 200, old))
	if len(bound["labels"].([]any)) != 1 {
		t.Fatal("missing labels", bound)
	}
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{}}, 412, old)
	auditCount := func() int {
		var n int
		if e := db.db.Get(&n, "SELECT COUNT(*) FROM audit_event WHERE action LIKE 'project_repository%'"); e != nil {
			t.Fatal(e)
		}
		return n
	}
	beforeAudit := auditCount()
	before := collection()["If-Match"]
	same := object()
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid}}, 200, same)
	if before != collection()["If-Match"] || same["If-Match"] != object()["If-Match"] {
		t.Fatal("no-op changed version")
	}
	admin.call(t, "PATCH", label, map[string]any{"name": "后端服务", "color": "#3B82F6"}, 200, collection())
	if beforeAudit != auditCount() || before != collection()["If-Match"] {
		t.Fatal("no-op emitted audit or changed dictionary version")
	}
	// Fail after bindings and row version were written to verify transaction rollback.
	projectID, _ := strconv.ParseUint(pid, 10, 64)
	repositoryID, _ := strconv.ParseUint(rid, 10, 64)
	rollback := errors.New("forced transaction rollback")
	err := db.Transact(t.Context(), func(tx identity.Tx) error {
		store := tx.(*identityTx)
		if e := store.SetRepositoryLabels(projectID, repositoryID, nil); e != nil {
			return e
		}
		if e := store.BumpRepos(projectID); e != nil {
			return e
		}
		return rollback
	})
	if !errors.Is(err, rollback) || same["If-Match"] != object()["If-Match"] || before != collection()["If-Match"] {
		t.Fatal("repository label transaction did not roll back", err)
	}
	rolledBack := testData(admin.call(t, "GET", repo, nil, 200, nil))["labels"].([]any)
	if len(rolledBack) != 1 {
		t.Fatal("rollback lost binding")
	}
	filtered := testData(member.call(t, "GET", "/projects/"+pid+"/repositories?label_code=backend&page_size=1", nil, 200, nil))
	if filtered["total"] != float64(1) || len(filtered["items"].([]any)) != 1 {
		t.Fatal("label filtering", filtered)
	}
	missing := testData(member.call(t, "GET", "/projects/"+pid+"/repositories?label_code=absent", nil, 200, nil))
	if missing["total"] != float64(0) {
		t.Fatal("unknown filter")
	}
	beforeSync := bound["last_synced_at"]
	stale = object()
	admin.call(t, "PATCH", label, map[string]any{"name": "后端", "color": "#10b981"}, 200, collection())
	renamed := testData(member.call(t, "GET", repo, nil, 200, nil))
	if renamed["last_synced_at"] != beforeSync || renamed["labels"].([]any)[0].(map[string]any)["name"] != "后端" {
		t.Fatal("definition projection", renamed)
	}
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{}}, 412, stale)
	refreshed := testData(admin.call(t, "POST", repo+"/refresh", map[string]any{}, 200, object()))
	if len(refreshed["labels"].([]any)) != 1 {
		t.Fatal("remote refresh erased labels")
	}
	// Label writes only need local project access, even when the connection is disabled.
	if _, e := db.db.Exec("UPDATE service_connection c JOIN project_repository r ON r.connection_id=c.id SET c.enabled=0 WHERE r.id=?", rid); e != nil {
		t.Fatal(e)
	}
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{}}, 200, object())
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid}}, 200, object())
	if _, e := db.db.Exec("UPDATE service_connection c JOIN project_repository r ON r.connection_id=c.id SET c.enabled=1 WHERE r.id=?", rid); e != nil {
		t.Fatal(e)
	}
	var creator string
	if e := db.db.Get(&creator, "SELECT created_by_user_id FROM project WHERE id=?", pid); e != nil {
		t.Fatal(e)
	}
	second := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "label_other", "name": "标签隔离项目", "admin_user_ids": []string{creator}}, 201, nil))["id"].(string)
	secondBase := "/projects/" + second + "/repository-labels"
	v := testData(admin.call(t, "GET", secondBase, nil, 200, nil))
	foreign := testData(admin.call(t, "POST", secondBase, create, 201, map[string]string{"If-Match": v["mutation_version"].(string)}))["item"].(map[string]any)["id"].(string)
	beforeRejected := object()["If-Match"]
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{lid, foreign}}, 422, object())
	if object()["If-Match"] != beforeRejected {
		t.Fatal("rejected assignment changed repository version")
	}
	stillBound := testData(admin.call(t, "GET", repo, nil, 200, nil))["labels"].([]any)
	if len(stillBound) != 1 || stillBound[0].(map[string]any)["id"] != lid {
		t.Fatal("rejected assignment changed bindings")
	}
	path := "/projects/" + pid
	admin.call(t, "GET", path, nil, 200, nil)
	projectTag := admin.last.Header().Get("ETag")
	admin.call(t, "POST", path+"/archive", map[string]any{}, 204, map[string]string{"If-Match": projectTag})
	admin.call(t, "PATCH", label, map[string]any{"name": "blocked"}, 409, collection())
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{}}, 409, object())
	admin.call(t, "GET", path, nil, 200, nil)
	projectTag = admin.last.Header().Get("ETag")
	admin.call(t, "POST", path+"/restore", map[string]any{}, 204, map[string]string{"If-Match": projectTag})
	admin.call(t, "DELETE", label, nil, 200, collection())
	cleared := testData(admin.call(t, "GET", repo, nil, 200, nil))
	if len(cleared["labels"].([]any)) != 0 {
		t.Fatal("delete did not unbind")
	}
	var count int
	if e := db.db.Get(&count, "SELECT COUNT(*) FROM project_repository_label_binding WHERE label_id=?", lid); e != nil || count != 0 {
		t.Fatal("orphan binding", count, e)
	}
	// Leave a binding for the caller's unlink regression: definitions must survive unlink.
	retained := testData(admin.call(t, "POST", base, create, 201, collection()))["item"].(map[string]any)["id"].(string)
	admin.call(t, "PUT", repo+"/labels", map[string]any{"label_ids": []string{retained}}, 200, object())
	// Removed delivery routes remain unavailable after creating a project.
	for _, suffix := range []string{"/variants", "/branch-model", "/workspace", "/releases"} {
		admin.call(t, "GET", path+suffix, nil, 404, nil)
	}
	for _, table := range []string{"project_variant", "project_release", "project_environment"} {
		if e := db.db.Get(&count, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", table); e != nil || count != 0 {
			t.Fatal(fmt.Sprint("obsolete table ", table), e)
		}
	}
}
