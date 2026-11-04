package mysql

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// Reuse the authenticated release fixture. Seed read-model states directly;
// release_workflow_test.go separately exercises their actual transitions.
func verifyProjectWorkspace(t *testing.T, db *Store, admin, manager, outsider *apiClient, variantPath, originalRelease string) {
	t.Helper()
	root, _, ok := strings.Cut(variantPath, "/variants/")
	if !ok {
		t.Fatal("missing fixture project path")
	}
	pid := strings.TrimPrefix(root, "/projects/")
	headers := func(tag string) map[string]string { return map[string]string{"If-Match": tag} }
	variants := testData(manager.call(t, "GET", root+"/variants", nil, 200, nil))
	custom := testData(manager.call(t, "POST", root+"/variants", map[string]string{"code": "workspace-customer", "name": "工作区客户版", "main_branch": "customer/workspace"}, 201, headers(variants["mutation_version"].(string))))
	customPath := root + "/variants/" + custom["id"].(string)
	manager.call(t, "PATCH", customPath+"/release-settings", map[string]string{"tag_prefix": "customer-v"}, 200, headers(custom["etag"].(string)))
	customRelease := testData(manager.call(t, "POST", customPath+"/releases", map[string]string{"name": "会员体系升级", "version_label": "workspace-2.0"}, 201, nil))
	if customRelease["name"] != "会员体系升级" {
		t.Fatal("create did not retain the optional name")
	}

	states := []string{"draft", "integrating", "reviewing", "accepted", "tagging", "archived", "terminated", "draft", "integrating", "reviewing", "accepted", "tagging", "draft"}
	ids := make([]int64, len(states))
	for n, status := range states {
		result, err := db.db.Exec(`INSERT INTO project_release(project_id,variant_id,version_label,tag_name,variant_snapshot,description_md,status,actor_user_id,created_at,updated_at)
SELECT project_id,variant_id,?,?,variant_snapshot,'',?,actor_user_id,UTC_TIMESTAMP(3),'2026-01-01 00:00:00.000' FROM project_release WHERE id=?`, fmt.Sprintf("workspace-%02d", n), fmt.Sprintf("qa-workspace_%02d", n), status, originalRelease)
		if err != nil {
			t.Fatal(err)
		}
		ids[n], err = result.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.db.Exec("UPDATE project_release SET name='搜索 %_! 名称' WHERE id=?", ids[0]); err != nil {
		t.Fatal(err)
	}
	for n, operation := range []struct {
		release int64
		status  string
		active  any
	}{{ids[1], "unknown", 1}, {ids[0], "unknown", nil}, {ids[2], "running", 1}} {
		_, err := db.db.Exec(`INSERT INTO project_release_operation(release_id,kind,status,active_slot,idempotency_key,request_digest,actor_user_id,created_at)
SELECT id,'merge',?,?,?,UNHEX(REPEAT('00',32)),actor_user_id,UTC_TIMESTAMP(3) FROM project_release WHERE id=?`, operation.status, operation.active, fmt.Sprintf("workspace-operation-%d", n), operation.release)
		if err != nil {
			t.Fatal(err)
		}
	}
	// A foreign variant must be rejected even when the caller knows its ID.
	adminUser := testData(admin.call(t, "GET", "/auth/session", nil, 200, nil))["user"].(map[string]any)
	foreignProject := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "workspace-foreign", "name": "其他项目", "admin_user_ids": []string{adminUser["id"].(string)}}, 201, nil))
	foreignRoot := "/projects/" + foreignProject["id"].(string)
	foreignVariants := testData(admin.call(t, "GET", foreignRoot+"/variants", nil, 200, nil))
	foreignID := foreignVariants["items"].([]any)[0].(map[string]any)["id"].(string)
	manager.call(t, "GET", root+"/releases?variant_id="+foreignID, nil, 404, nil)
	outsider.call(t, "GET", root+"/workspace", nil, 404, nil)
	outsider.call(t, "GET", root+"/releases?status=all", nil, 404, nil)
	outsider.call(t, "GET", root+"/releases?variant_id="+custom["id"].(string), nil, 404, nil)

	read := func(query string) map[string]any {
		t.Helper()
		return testData(manager.call(t, "GET", root+"/releases?"+query, nil, 200, nil))
	}
	all := read("status=all&page_size=10")
	if all["total"] != float64(15) || len(all["items"].([]any)) != 10 {
		t.Fatalf("bounded release page lost total: %v", all)
	}
	seen := map[string]bool{}
	for _, page := range []map[string]any{all, read("status=all&page_size=10&page=2")} {
		for _, item := range page["items"].([]any) {
			row := item.(map[string]any)
			id := row["id"].(string)
			if _, ok := row["name"].(string); !ok {
				t.Fatal("project release DTO omitted name", row)
			}
			if seen[id] {
				t.Fatal("release repeated across stable pages", id)
			}
			seen[id] = true
			if row["variant_id"] == custom["id"] && (row["variant_name"] != custom["name"] || row["variant_code"] != custom["code"]) {
				t.Fatalf("variant context was lost: %v", row)
			}
			if row["needs_attention"] != (id == strconv.FormatInt(ids[1], 10)) {
				t.Fatalf("historical or running operation misclassified as attention: %v", row)
			}
		}
	}
	if len(seen) != 15 || !seen[customRelease["id"].(string)] || !seen[originalRelease] {
		t.Fatal("project release list did not span both variants")
	}
	// Switching from the project list to its variant must preserve the same
	// attention signal, without treating running or historical operations as unknown.
	variantSeen := map[string]bool{}
	for _, page := range []string{"1", "2"} {
		result := testData(manager.call(t, "GET", variantPath+"/releases?status=all&page_size=10&page="+page, nil, 200, nil))
		if result["total"] != float64(14) {
			t.Fatalf("variant attention projection changed the total: %v", result)
		}
		for _, item := range result["items"].([]any) {
			row := item.(map[string]any)
			id := row["id"].(string)
			if row["needs_attention"] != (id == strconv.FormatInt(ids[1], 10)) {
				t.Fatalf("variant attention differs from project attention: %v", row)
			}
			if variantSeen[id] {
				t.Fatal("variant release repeated across stable pages", id)
			}
			variantSeen[id] = true
		}
	}
	if len(variantSeen) != 14 || variantSeen[customRelease["id"].(string)] {
		t.Fatal("variant projection leaked another variant or lost releases")
	}
	for index, id := range ids[:3] {
		result := testData(manager.call(t, "GET", variantPath+"/releases/"+strconv.FormatInt(id, 10), nil, 200, nil))
		if result["needs_attention"] != (index == 1) || result["status"] != states[index] {
			t.Fatalf("release detail conflated phase and attention: %v", result)
		}
	}
	outsider.call(t, "GET", variantPath+"/releases", nil, 404, nil)
	outsider.call(t, "GET", variantPath+"/releases/"+strconv.FormatInt(ids[1], 10), nil, 404, nil)
	for _, tc := range []struct {
		query string
		total int
	}{
		{"", 13}, {"status=active", 13}, {"status=attention", 1},
		{"status=draft", 5}, {"status=integrating", 2}, {"status=reviewing", 2}, {"status=accepted", 2}, {"status=tagging", 2}, {"status=archived", 1}, {"status=terminated", 1},
		{"status=all&variant_id=" + custom["id"].(string), 1},
		{"status=all&q=" + url.QueryEscape("customer-vworkspace-2.0"), 1},
		{"status=all&q=workspace-01", 1},
		{"status=all&q=" + url.QueryEscape("qa-workspace_"), 13},
		{"status=all&q=" + url.QueryEscape("会员体系升级"), 2},
		{"status=all&q=" + url.QueryEscape("%"), 1},
		{"status=all&q=" + url.QueryEscape("%_!"), 1},
		{"status=all&q=" + url.QueryEscape("!' OR 1=1 --"), 0},
	} {
		if result := read(tc.query); result["total"] != float64(tc.total) {
			t.Fatalf("query %q: expected %d releases, got %v", tc.query, tc.total, result)
		}
	}
	for _, tc := range []struct {
		query string
		total int
	}{
		{"会员体系升级", 1}, {"%_!", 1}, {"qa-workspace_", 13}, {"workspace-01", 1}, {"%' OR 1=1 --", 0},
	} {
		result := testData(manager.call(t, "GET", variantPath+"/releases?q="+url.QueryEscape(tc.query), nil, 200, nil))
		if result["total"] != float64(tc.total) {
			t.Fatalf("variant query %q returned %v, want %d", tc.query, result, tc.total)
		}
	}
	if result := read("status=all&page=3&page_size=10"); result["total"] != float64(15) || len(result["items"].([]any)) != 0 {
		t.Fatal("empty page lost full total")
	}
	for _, query := range []string{"status=bogus", "page_size=1", "page=-1", "variant_id=0", "variant_id=01", "q=" + strings.Repeat("a", 101)} {
		manager.call(t, "GET", root+"/releases?"+query, nil, 422, nil)
	}
	work := testData(manager.call(t, "GET", root+"/workspace", nil, 200, nil))
	var repoCount, variantCount int
	if err := db.db.Get(&repoCount, "SELECT COUNT(*) FROM project_repository WHERE project_id=?", pid); err != nil {
		t.Fatal(err)
	}
	if err := db.db.Get(&variantCount, "SELECT COUNT(*) FROM project_variant WHERE project_id=? AND archived_at IS NULL", pid); err != nil {
		t.Fatal(err)
	}
	active := work["releases"].(map[string]any)
	attention := work["attention"].(map[string]any)
	if work["repository_count"] != float64(repoCount) || work["variants"].(map[string]any)["total"] != float64(variantCount) || active["total"] != float64(13) || len(active["items"].([]any)) != 10 || attention["total"] != float64(1) {
		t.Fatalf("workspace counts are not backed by full collections: %v", work)
	}
}
