package mysql

import (
	"strconv"
	"testing"
)

func verifySidebarHTTP(t *testing.T, s *Store, client *apiClient, uid string) {
	t.Helper()
	initial := testData(client.call(t, "GET", "/me/sidebar-shortcuts", nil, 200, nil))
	projects := initial["projects"].(map[string]any)
	teams := initial["teams"].(map[string]any)
	if len(projects["items"].([]any)) != 0 || projects["version"] != "1" || teams["version"] != "1" {
		t.Fatal("new account preferences must be empty at version one")
	}
	var ids []string
	for _, code := range []string{"Shortcut_A", "Shortcut_B", "Shortcut_Private"} {
		r, err := s.db.Exec("INSERT INTO project(code,name,description,created_by_user_id,created_at,updated_at) VALUES (?,?,'',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", code, code, uid)
		if err != nil {
			t.Fatal(err)
		}
		id, err := r.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, strconv.FormatInt(id, 10))
	}
	for _, id := range ids[:2] {
		if _, err := s.db.Exec("INSERT INTO project_member(project_id,user_id,role,created_at,updated_at) VALUES (?,?,'member',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", id, uid); err != nil {
			t.Fatal(err)
		}
	}
	headers := map[string]string{"If-Match": projects["etag"].(string)}
	client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": ids[:2]}, 428, nil)
	client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": []string{ids[2]}}, 422, headers)
	client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": []string{ids[0], ids[0]}}, 422, headers)
	first := testData(client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": ids[:2]}, 200, headers))
	if first["version"] != "2" {
		t.Fatal("pin did not increment version")
	}
	client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": []string{ids[1], ids[0]}}, 412, headers)
	headers["If-Match"] = first["etag"].(string)
	same := testData(client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": ids[:2]}, 200, headers))
	if same["version"] != "2" {
		t.Fatal("no-op changed version")
	}
	reordered := testData(client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": []string{ids[1], ids[0]}}, 200, headers))
	if reordered["items"].([]any)[0].(map[string]any)["id"] != ids[1] {
		t.Fatal("sort order not persisted")
	}
	fresh := testData(client.call(t, "GET", "/me/sidebar-shortcuts", nil, 200, nil))
	if fresh["teams"].(map[string]any)["version"] != "1" {
		t.Fatal("project pin altered team version")
	}
	client.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": []string{}}, 200, map[string]string{"If-Match": reordered["etag"].(string)})
	for _, id := range ids {
		if _, err := s.db.Exec("DELETE FROM project_member WHERE project_id=?", id); err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec("DELETE FROM project WHERE id=?", id); err != nil {
			t.Fatal(err)
		}
	}
}
