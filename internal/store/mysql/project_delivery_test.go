package mysql

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
)

func verifyProjectDelivery(t *testing.T, db *Store, admin, manager, outsider *apiClient, pid, rid string) {
	root := "/projects/" + pid
	headers := func(tag string) map[string]string { return map[string]string{"If-Match": tag} }
	list := testData(manager.call(t, "GET", root+"/variants", nil, 200, nil))
	if list["total"] != float64(1) {
		t.Fatal("standard variant missing")
	}
	standard := list["items"].([]any)[0].(map[string]any)
	sv := root + "/variants/" + standard["id"].(string)
	outsider.call(t, "GET", root+"/variants", nil, 404, nil)
	manager.call(t, "POST", sv+"/archive", map[string]any{}, 409, headers(standard["etag"].(string)))
	m := testData(manager.call(t, "GET", root+"/branch-model", nil, 200, nil))
	rules := m["rules"].([]any)
	for _, row := range rules {
		r := row.(map[string]any)
		if r["branch_type"] == "custom" || r["branch_type"] == "integration" {
			r["enabled"] = true
		}
	}
	manager.call(t, "PUT", root+"/branch-model", map[string]any{"rules": rules}, 200, headers(m["etag"].(string)))
	scope := map[string]any{"mode": "custom", "repository_ids": []string{rid}, "rules": []any{}}
	create := map[string]any{"code": "customer-qa", "name": "客户验收", "main_branch": "custom/验收", "repository_scope": scope}
	v := testData(manager.call(t, "POST", root+"/variants", create, 201, headers(list["mutation_version"].(string))))
	vp := root + "/variants/" + v["id"].(string)
	manager.call(t, "PATCH", vp, map[string]any{"name": "stale"}, 412, headers(standard["etag"].(string)))
	envlist := testData(manager.call(t, "GET", vp+"/environments", nil, 200, nil))
	env := testData(manager.call(t, "POST", vp+"/environments", map[string]any{"code": "test", "name": "测试", "branch_type": "integration", "branch_name": "integration/qa"}, 201, headers(envlist["mutation_version"].(string))))
	ep := vp + "/environments/" + env["id"].(string)
	manager.call(t, "PATCH", ep, map[string]any{"branch_type": "feature", "branch_name": "feature/a"}, 422, headers(env["etag"].(string)))
	repos := testData(manager.call(t, "GET", vp+"/repositories", nil, 200, nil))
	selection := map[string]any{"repository_ids": []string{rid}, "scope_token": repos["scope_token"]}
	checked := testData(manager.call(t, "POST", vp+"/check-branches", selection, 200, headers(v["etag"].(string))))
	if checked["items"].([]any)[0].(map[string]any)["status"] != "missing" {
		t.Fatalf("expected confirmed missing: %v", checked)
	}
	body := map[string]any{"repository_ids": []string{rid}, "scope_token": repos["scope_token"], "default_source_branch": "main", "source_overrides": []any{}}
	h := headers(v["etag"].(string))
	h["Idempotency-Key"] = "10000000-0000-4000-8000-000000000001"
	plan := testData(manager.call(t, "POST", vp+"/branch-creations", body, 201, h))
	replay := testData(manager.call(t, "POST", vp+"/branch-creations", body, 201, h))
	if replay["id"] != plan["id"] {
		t.Fatal("prepare idempotency failed")
	}
	bp := root + "/branch-creations/" + plan["id"].(string)
	pi := testData(manager.call(t, "GET", bp+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	if pi["preview_state"] != "ready" || pi["source_commit_id"] != strings.Repeat("a", 40) {
		t.Fatalf("source not frozen: %v", pi)
	}
	actions := map[string]any{"items": []any{map[string]any{"id": pi["id"], "action": "create"}}}
	result := testData(manager.call(t, "POST", bp+"/execute", actions, 200, headers(plan["etag"].(string))))
	if result["status"] != "completed" {
		t.Fatalf("creation not completed: %v", result)
	}
	manager.call(t, "POST", bp+"/execute", actions, 200, headers(plan["etag"].(string)))
	// A fresh plan must explicitly adopt an existing target, never create again.
	h["Idempotency-Key"] = "10000000-0000-4000-8000-000000000002"
	existing := testData(manager.call(t, "POST", vp+"/branch-creations", body, 201, h))
	bp2 := root + "/branch-creations/" + existing["id"].(string)
	pi2 := testData(manager.call(t, "GET", bp2+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	if pi2["preview_state"] != "existing" {
		t.Fatal("existing target not detected")
	}
	manager.call(t, "POST", bp2+"/execute", map[string]any{"items": []any{map[string]any{"id": pi2["id"], "action": "create"}}}, 422, headers(existing["etag"].(string)))
	// A lost successful response must remain unknown, even after reconciliation.
	currentList := testData(manager.call(t, "GET", root+"/variants", nil, 200, nil))
	uv := testData(manager.call(t, "POST", root+"/variants", map[string]any{"code": "unknown-response", "name": "响应丢失验收", "main_branch": "custom/unknown-response"}, 201, headers(currentList["mutation_version"].(string))))
	up := root + "/variants/" + uv["id"].(string)
	us := testData(manager.call(t, "GET", up+"/repositories", nil, 200, nil))
	ub := map[string]any{"repository_ids": []string{rid}, "scope_token": us["scope_token"], "default_source_branch": "main"}
	uh := headers(uv["etag"].(string))
	uh["Idempotency-Key"] = "10000000-0000-4000-8000-000000000003"
	unknownPlan := testData(manager.call(t, "POST", up+"/branch-creations", ub, 201, uh))
	ubp := root + "/branch-creations/" + unknownPlan["id"].(string)
	ui := testData(manager.call(t, "GET", ubp+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	unknownPlan = testData(manager.call(t, "POST", ubp+"/execute", map[string]any{"items": []any{map[string]any{"id": ui["id"], "action": "create"}}}, 200, headers(unknownPlan["etag"].(string))))
	ui = testData(manager.call(t, "GET", ubp+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	if ui["status"] != "unknown" {
		t.Fatalf("5xx must be unknown: %v", ui)
	}
	manager.call(t, "POST", ubp+"/reconcile", map[string]any{"item_ids": []string{ui["id"].(string)}}, 200, headers(unknownPlan["etag"].(string)))
	ui = testData(manager.call(t, "GET", ubp+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	if ui["status"] != "unknown" || ui["reconciliation"].(map[string]any)["status"] != "exists" {
		t.Fatalf("reconcile must retain history: %v", ui)
	}
	ub["retry_of_id"] = unknownPlan["id"]
	uh["Idempotency-Key"] = "10000000-0000-4000-8000-000000000004"
	adopt := testData(manager.call(t, "POST", up+"/branch-creations", ub, 201, uh))
	abp := root + "/branch-creations/" + adopt["id"].(string)
	ai := testData(manager.call(t, "GET", abp+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	if ai["preview_state"] != "existing" || adopt["retry_of_id"] != unknownPlan["id"] {
		t.Fatal("retry must preview the existing target and retain string ID")
	}
	manager.call(t, "POST", abp+"/execute", map[string]any{"items": []any{map[string]any{"id": ai["id"], "action": "use_existing"}}}, 200, headers(adopt["etag"].(string)))
	ai = testData(manager.call(t, "GET", abp+"/items", nil, 200, nil))["items"].([]any)[0].(map[string]any)
	if ai["status"] != "used_existing" {
		t.Fatal("explicit adoption failed")
	}
	// Configuration changes invalidate both prepared plans and scope tokens.
	v = testData(manager.call(t, "PATCH", vp, map[string]any{"summary": "updated"}, 200, headers(v["etag"].(string))))
	manager.call(t, "POST", vp+"/check-branches", selection, 409, headers(v["etag"].(string)))
	// Model changes require an explicit impact confirmation; disabling referenced types is forbidden.
	m = testData(manager.call(t, "GET", root+"/branch-model", nil, 200, nil))
	rules = m["rules"].([]any)
	for _, row := range rules {
		r := row.(map[string]any)
		if r["branch_type"] == "custom" {
			r["rule"] = map[string]string{"mode": "glob", "pattern": "customer/**"}
		}
	}
	manager.call(t, "PUT", root+"/branch-model", map[string]any{"rules": rules}, 409, headers(m["etag"].(string)))
	preview := testData(manager.call(t, "POST", root+"/branch-model/preview", map[string]any{"rules": rules, "sample_names": []string{"main", "custom/验收"}}, 200, headers(m["etag"].(string))))
	manager.call(t, "PUT", root+"/branch-model", map[string]any{"rules": rules, "impact_token": preview["impact_token"]}, 200, headers(m["etag"].(string)))
	manager.call(t, "PATCH", vp, map[string]any{"summary": "invalid binding can still edit notes"}, 200, headers(v["etag"].(string)))
	// Recovery only changes local history, and cannot resurrect a stale item.
	if _, e := db.db.Exec("UPDATE project_branch_creation SET status='executing',active_slot=1,lease_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?", existing["id"]); e != nil {
		t.Fatal(e)
	}
	if _, e := db.db.Exec("UPDATE project_branch_creation_item SET status='creating' WHERE id=?", pi2["id"]); e != nil {
		t.Fatal(e)
	}
	if e := d.Clean(context.Background(), db, time.Now().UTC()); e != nil {
		t.Fatal(e)
	}
	r := testData(manager.call(t, "GET", bp2, nil, 200, nil))
	if r["status"] != "interrupted" {
		t.Fatal("lease did not recover")
	}
	raw := fmt.Sprint(manager.call(t, "GET", bp2+"/items", nil, 200, nil))
	for _, secret := range []string{"credential_id", "remote_snapshot", "request_hash", "secret_ciphertext"} {
		if strings.Contains(raw, secret) {
			t.Fatal("private operation metadata leaked")
		}
	}
	// Unlink cleanup is checked through the existing fixture after this function.
	if e := db.Transact(context.Background(), func(tx identity.Tx) error {
		store := tx.(*identityTx)
		return store.unlinkDeliveryRepo(mustUint(t, pid), mustUint(t, rid))
	}); e != nil {
		t.Fatal(e)
	}
	after := testData(manager.call(t, "GET", vp, nil, 200, nil))
	if len(after["repository_scope"].(map[string]any)["repository_ids"].([]any)) != 0 {
		t.Fatal("manual reference not cleared")
	}
	admin.call(t, "GET", root+"/variants?archived=all&q=客户&page_size=20", nil, 200, nil)
	refreshed := testData(manager.call(t, "GET", sv, nil, 200, nil))
	verifyReleaseDraft(t, db, admin, manager, outsider, sv, refreshed["etag"].(string))
	endpoint := "/admin/maintenance/temp-files/"
	manager.call(t, "POST", endpoint+"preview", map[string]string{"source": "releases"}, 403, nil)
	maintenancePreview := testData(admin.call(t, "POST", endpoint+"preview", map[string]string{"source": "releases"}, 200, nil))
	all := maintenancePreview["items"].([]any)
	selected := []map[string]string{}
	for _, item := range all {
		row := item.(map[string]any)
		if strings.HasPrefix(row["id"].(string), "stage-") {
			t.Fatal("bound release file considered temporary")
		}
		selected = append(selected, map[string]string{"id": row["id"].(string), "token": row["token"].(string)})
	}
	if len(selected) == 0 {
		t.Fatal("temporary upload directories were unexpectedly removed")
	}
	admin.call(t, "POST", endpoint+"clean", map[string]any{"source": "releases", "items": selected}, 200, nil)

}
func mustUint(t *testing.T, s string) uint64 {
	t.Helper()
	var n uint64
	if _, e := fmt.Sscan(s, &n); e != nil {
		t.Fatal(e)
	}
	return n
}
