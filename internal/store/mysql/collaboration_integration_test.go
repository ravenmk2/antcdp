package mysql

import (
	"context"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/media"
)

func verifyCollaborationHTTP(t *testing.T, backend *Store, dataDir string, admin, member, outsider *apiClient, adminID, memberID string) {
	create := func(kind, code, name string, ids []string) map[string]any {
		return testData(admin.call(t, "POST", "/"+kind, map[string]any{"code": code, "name": name, "admin_user_ids": ids}, 201, nil))
	}
	project := create("projects", "QA_Project", "协作测试项目", []string{adminID})
	team := create("teams", "QA_Team", "协作测试团队", []string{memberID})
	p, g := "/projects/"+project["id"].(string), "/teams/"+team["id"].(string)
	get := func(path string) map[string]any { return testData(admin.call(t, "GET", path, nil, 200, nil)) }
	head := func(path, field string) map[string]string {
		return map[string]string{"If-Match": get(path)[field].(string)}
	}
	icon := testData(uploadAt(t, admin, "/icon-uploads", avatarPNG(t), 201))
	iconID := icon["id"].(string)
	outsider.call(t, "GET", "/icons/"+iconID, nil, 404, nil)
	admin.call(t, "PATCH", p, map[string]any{"icon": map[string]any{"type": "upload", "file_id": iconID}}, 200, head(p, "etag"))
	if response := admin.send(t, "GET", "/icons/"+iconID, nil, nil); response.Code != 200 || response.Header().Get("Content-Type") != "image/png" {
		t.Fatal("bound icon unreadable")
	}
	admin.call(t, "PATCH", g, map[string]any{"icon": map[string]any{"type": "upload", "file_id": iconID}}, 409, head(g, "etag"))
	admin.call(t, "DELETE", "/icon-uploads/"+iconID, nil, 409, nil)
	outsider.call(t, "GET", "/icons/"+iconID, nil, 404, map[string]string{"If-None-Match": "*"})
	admin.call(t, "PATCH", p, map[string]any{"icon": map[string]any{"type": "builtin", "key": "code"}}, 200, head(p, "etag"))
	admin.call(t, "GET", "/icons/"+iconID, nil, 404, nil)
	if _, e := backend.db.Exec("UPDATE icon_file SET orphaned_at=? WHERE id=?", time.Now().UTC().Add(-25*time.Hour), iconID); e != nil {
		t.Fatal(e)
	}
	if e := collaboration.CleanIcons(context.Background(), backend, media.NewIcons(dataDir), time.Now().UTC()); e != nil {
		t.Fatal(e)
	}
	var remaining int
	if e := backend.db.Get(&remaining, "SELECT COUNT(*) FROM icon_file WHERE id=?", iconID); e != nil || remaining != 0 {
		t.Fatal("orphan icon was not pruned", e)
	}
	member.call(t, "POST", "/projects", map[string]any{"code": "Denied", "name": "拒绝创建", "admin_user_ids": []string{memberID}}, 403, nil)
	member.call(t, "GET", "/projects?scope=all", nil, 403, nil)
	outsider.call(t, "GET", p, nil, 404, nil)
	expectCode(t, admin.call(t, "POST", "/projects", map[string]any{"code": "qa_project", "name": "另一个名称", "admin_user_ids": []string{adminID}}, 409, nil), "CODE_CONFLICT")
	expectCode(t, admin.call(t, "POST", "/projects", map[string]any{"code": "Unique_Name", "name": "协作测试项目", "admin_user_ids": []string{adminID}}, 409, nil), "NAME_CONFLICT")
	admin.call(t, "PATCH", p, map[string]any{"summary": "首次更新"}, 200, head(p, "etag"))
	admin.call(t, "PATCH", p, map[string]any{"summary": "过期更新"}, 412, map[string]string{"If-Match": project["etag"].(string)})
	admin.call(t, "POST", p+"/teams", map[string]any{"team_id": team["id"]}, 204, head(p, "membership_etag"))
	if testData(member.call(t, "GET", p, nil, 200, nil))["direct_role"] != "" {
		t.Fatal("team grant became direct membership")
	}
	member.call(t, "PATCH", p, map[string]any{"name": "越权"}, 403, head(p, "etag"))
	admin.call(t, "POST", p+"/members", map[string]any{"user_id": memberID, "role": "member"}, 204, head(p, "membership_etag"))
	page := testData(member.call(t, "GET", p+"/members?page_size=1", nil, 200, nil))
	if page["total"] != float64(2) || len(page["items"].([]any)) != 1 || page["membership_etag"] == "" {
		t.Fatal("effective member pagination missing")
	}
	filtered := testData(member.call(t, "GET", p+"/members?q=member", nil, 200, nil))
	if filtered["total"] != float64(1) || len(filtered["items"].([]any)[0].(map[string]any)["sources"].([]any)) != 2 {
		t.Fatal("member sources were not merged before filtering")
	}
	sidebar := testData(member.call(t, "GET", "/me/sidebar-shortcuts", nil, 200, nil))
	member.call(t, "PUT", "/me/sidebar-shortcuts/projects", map[string]any{"ids": []string{project["id"].(string)}}, 200, map[string]string{"If-Match": sidebar["projects"].(map[string]any)["etag"].(string)})
	member.call(t, "POST", p+"/leave", nil, 204, nil)
	member.call(t, "GET", p, nil, 200, nil)
	sidebar = testData(member.call(t, "GET", "/me/sidebar-shortcuts", nil, 200, nil))
	if len(sidebar["projects"].(map[string]any)["items"].([]any)) != 1 {
		t.Fatal("pin removed despite remaining team source")
	}
	member.call(t, "POST", g+"/leave", nil, 204, nil)
	member.call(t, "GET", p, nil, 404, nil)
	member.call(t, "GET", g, nil, 404, nil)
	sidebar = testData(member.call(t, "GET", "/me/sidebar-shortcuts", nil, 200, nil))
	if len(sidebar["projects"].(map[string]any)["items"].([]any)) != 0 {
		t.Fatal("pin retained after last source removed")
	}
	admin.call(t, "POST", g+"/members", map[string]any{"user_id": memberID, "role": "admin"}, 204, head(g, "membership_etag"))
	member.call(t, "GET", p, nil, 200, nil)
	admin.call(t, "POST", p+"/archive", nil, 204, head(p, "etag"))
	member.call(t, "GET", p, nil, 200, nil)
	admin.call(t, "PATCH", p, map[string]any{"summary": "只读"}, 409, head(p, "etag"))
	admin.call(t, "POST", p+"/restore", nil, 204, head(p, "etag"))
	admin.call(t, "POST", g+"/dissolve", nil, 204, head(g, "dissolve_etag"))
	member.call(t, "GET", p, nil, 404, nil)
	if get(p)["member_count"] != float64(1) {
		t.Fatal("dissolved team still contributes members")
	}
}
