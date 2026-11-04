package mysql

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"strings"
	"testing"
)

func verifyReleaseDraft(t *testing.T, db *Store, admin, manager, outsider *apiClient, variant, tag string) {
	t.Helper()
	headers := func(tag string) map[string]string { return map[string]string{"If-Match": tag} }
	manager.call(t, "PATCH", variant+"/release-settings", map[string]string{"tag_prefix": "qa-v"}, 200, headers(tag))
	created := testData(manager.call(t, "POST", variant+"/releases", map[string]string{"version_label": "1.0.0", "description_md": "步骤"}, 201, nil))
	path := variant + "/releases/" + created["id"].(string)
	if created["tag_name"] != "qa-v1.0.0" {
		t.Fatal("tag prefix not frozen")
	}
	if created["name"] != "" {
		t.Fatal("omitted name must remain empty for version fallback")
	}
	outsider.call(t, "GET", path, nil, 404, nil)
	manager.call(t, "POST", variant+"/releases", map[string]string{"version_label": "1.0.0"}, 409, nil)
	verifyReleaseNames(t, db, admin, manager, outsider, path)
	created = testData(manager.call(t, "GET", path, nil, 200, nil))
	initial := created["etag"].(string)
	submit := func(method, endpoint, filename, body, tag string, status int) map[string]any {
		t.Helper()
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		meta, _ := json.Marshal(map[string]string{"kind": "sql", "filename": filename, "database_name": "orders"})
		if e := w.WriteField("metadata", string(meta)); e != nil {
			t.Fatal(e)
		}
		if body != "" {
			p, e := w.CreateFormFile("file", filename)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = p.Write([]byte(body)); e != nil {
				t.Fatal(e)
			}
		}
		if e := w.Close(); e != nil {
			t.Fatal(e)
		}
		result := manager.sendBytes(t, method, endpoint, buf.Bytes(), w.FormDataContentType(), headers(tag))
		if result.Code != status {
			t.Fatalf("material: %d %s", result.Code, result.Body.String())
		}
		var response map[string]any
		if e := json.Unmarshal(result.Body.Bytes(), &response); e != nil {
			t.Fatal(e)
		}
		return response
	}
	material := testData(submit("POST", path+"/items", "schema.sql", "SELECT 1;", initial, 201))
	updated := manager.last.Header().Get("ETag")
	item := path + "/items/" + material["id"].(string)
	oldFile := item + "/revisions/" + material["revision_id"].(string) + "/file"
	submit("PATCH", item, "schema.sql", "SELECT 2;", initial, 412)
	revised := testData(submit("PATCH", item, "renamed.sql", "", updated, 200))
	next := manager.last.Header().Get("ETag")
	if revised["revision_no"] != float64(2) || revised["sha256"] != material["sha256"] {
		t.Fatal("metadata revision lost bytes")
	}
	manager.call(t, "DELETE", item, nil, 200, headers(next))
	if out := manager.send(t, "GET", oldFile, nil, nil); out.Code != 200 || out.Body.String() != "SELECT 1;" {
		t.Fatal("historical revision inaccessible")
	}
	outsider.call(t, "GET", oldFile, nil, 404, nil)
	rows := testData(manager.call(t, "GET", path+"/items", nil, 200, nil))
	if len(rows["items"].([]any)) != 0 || len(rows["repositories"].([]any)) == 0 {
		t.Fatal("draft material scope")
	}
	verifyProjectWorkspace(t, db, admin, manager, outsider, variant, created["id"].(string))
}

func verifyReleaseNames(t *testing.T, db *Store, admin, manager, outsider *apiClient, path string) {
	t.Helper()
	head := func() map[string]string {
		t.Helper()
		manager.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": manager.last.Header().Get("ETag")}
	}
	initial := head()
	named := testData(manager.call(t, "PATCH", path, map[string]string{"name": "  会员体系升级\u3000"}, 200, initial))
	if named["name"] != "会员体系升级" || named["tag_name"] != "qa-v1.0.0" {
		t.Fatal("name was not normalized or changed the Tag", named)
	}
	manager.call(t, "PATCH", path, map[string]string{"name": "过期修改"}, 412, initial)
	for _, invalid := range []any{nil, strings.Repeat("名", 121), "第一行\n第二行", "前\u2028后", "前\x00后"} {
		manager.call(t, "PATCH", path, map[string]any{"name": invalid}, 422, head())
	}
	unchanged := testData(manager.call(t, "PATCH", path, map[string]string{"description_md": "步骤"}, 200, head()))
	if unchanged["name"] != "会员体系升级" {
		t.Fatal("omitted name was changed")
	}
	cleared := testData(manager.call(t, "PATCH", path, map[string]string{"name": " \u3000 "}, 200, head()))
	if cleared["name"] != "" || cleared["version_label"] != "1.0.0" {
		t.Fatal("blank name did not preserve version fallback")
	}
	versioned := testData(manager.call(t, "PATCH", path, map[string]string{"version_label": "1.0.1"}, 200, head()))
	if versioned["name"] != "" || versioned["tag_name"] != "qa-v1.0.1" {
		t.Fatal("version change copied a stale display name")
	}
	manager.call(t, "PATCH", path, map[string]string{"version_label": "1.0.0"}, 200, head())
	admin.call(t, "PATCH", path, map[string]string{"name": "会员体系升级"}, 200, head())
	root, _, _ := strings.Cut(path, "/variants/")
	outsiderUser := testData(outsider.call(t, "GET", "/auth/session", nil, 200, nil))["user"].(map[string]any)
	membership := func() map[string]string {
		p := testData(admin.call(t, "GET", root, nil, 200, nil))
		return map[string]string{"If-Match": p["membership_etag"].(string)}
	}
	admin.call(t, "POST", root+"/members", map[string]any{"user_id": outsiderUser["id"], "role": "member"}, 204, membership())
	outsider.call(t, "PATCH", path, map[string]string{"name": "成员不可改名"}, 403, head())
	outsider.call(t, "PATCH", path, map[string]string{"description_md": "步骤"}, 200, head())
	admin.call(t, "DELETE", root+"/members/"+outsiderUser["id"].(string), nil, 204, membership())
	id := named["id"].(string)
	for _, status := range []string{"integrating", "reviewing", "accepted", "tagging", "archived", "terminated"} {
		if _, err := db.db.Exec("UPDATE project_release SET status=? WHERE id=?", status, id); err != nil {
			t.Fatal(err)
		}
		expected := 409
		if status == "integrating" {
			expected = 200
		}
		manager.call(t, "PATCH", path, map[string]string{"name": "会员体系升级"}, expected, head())
		manager.call(t, "PATCH", path, map[string]string{"version_label": "2.0.0"}, 409, head())
	}
	if _, err := db.db.Exec("UPDATE project_release SET status='draft' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	pid := strings.TrimPrefix(root, "/projects/")
	for _, table := range []string{"project", "project_variant"} {
		var target string
		if table == "project" {
			target = pid
		} else {
			variant, _, _ := strings.Cut(strings.TrimPrefix(path, root+"/variants/"), "/")
			target = variant
		}
		if _, err := db.db.Exec("UPDATE "+table+" SET archived_at=UTC_TIMESTAMP(3) WHERE id=?", target); err != nil {
			t.Fatal(err)
		}
		manager.call(t, "PATCH", path, map[string]string{"name": "归档不可修改"}, 409, head())
		if _, err := db.db.Exec("UPDATE "+table+" SET archived_at=NULL WHERE id=?", target); err != nil {
			t.Fatal(err)
		}
	}
	var auditName string
	if err := db.db.Get(&auditName, "SELECT JSON_UNQUOTE(JSON_EXTRACT(detail,'$.name')) FROM audit_event WHERE action='project_release.updated' AND target_id=? ORDER BY id DESC LIMIT 1", id); err != nil || auditName != "会员体系升级" {
		t.Fatal("release rename audit missing", err)
	}
}
