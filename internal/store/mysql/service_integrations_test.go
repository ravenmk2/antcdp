package mysql

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func verifyServiceIntegrations(t *testing.T, db *Store, admin, member, other *apiClient, adminID, memberID string) {
	base := "/admin/integrations/gitlab"
	v := testData(admin.call(t, "POST", base, map[string]any{"name": "GitLab 集成测试", "description": "用途说明", "base_url": "https://gitlab.example.com"}, 201, nil))
	id := v["id"].(string)
	path := base + "/" + id
	tag := func(client *apiClient, path string) map[string]string {
		client.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": client.last.Header().Get("ETag")}
	}
	member.call(t, "GET", path, nil, 403, nil)
	public := member.call(t, "GET", "/integrations", nil, 200, nil)
	if strings.Contains(fmt.Sprint(public), "base_url") {
		t.Fatal("directory leaked configuration")
	}
	admin.call(t, "PATCH", path, map[string]any{"service_type": "redis"}, 422, tag(admin, path))
	admin.call(t, "POST", base, map[string]any{"name": "gitlab 集成测试", "base_url": "https://different.example.com"}, 409, nil)
	cfgTag := tag(admin, path+"/config")
	admin.call(t, "PATCH", path+"/config", map[string]any{"webhook_enabled": true}, 422, cfgTag)
	hook := testData(admin.call(t, "POST", path+"/webhook-secret/generate", nil, 200, cfgTag))["token"].(string)
	admin.call(t, "PATCH", path+"/config", map[string]any{"webhook_enabled": true}, 412, cfgTag)
	admin.call(t, "PATCH", path+"/config", map[string]any{"webhook_enabled": true}, 200, tag(admin, path+"/config"))
	hookCall := func(secret, body string, want int) {
		req := httptest.NewRequest("POST", "http://antcdp.test/api/v1/webhooks/gitlab/"+id, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Gitlab-Token", secret)
		req.Header.Set("X-Gitlab-Event", "Push Hook")
		req.Header.Set("Origin", "https://external.example.com")
		w := httptest.NewRecorder()
		admin.handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("webhook got %d: %s", w.Code, w.Body.String())
		}
		if want == 200 && !strings.Contains(w.Body.String(), "received_not_dispatched") {
			t.Fatal("misleading webhook acknowledgement")
		}
	}
	body := `{"object_kind":"push","ref":"refs/heads/main","project":{"id":42}}`
	hookCall("wrong-token", body, 401)
	hookCall(hook, body, 200)
	hookCall(hook, `{"object_kind":"merge_request","project":{"id":42}}`, 400)
	var encrypted string
	if e := db.db.GetContext(context.Background(), &encrypted, "SELECT webhook_secret_ciphertext FROM integration_gitlab WHERE integration_id=?", id); e != nil || !strings.HasPrefix(encrypted, "enc:v1:") || strings.Contains(encrypted, hook) {
		t.Fatal("webhook encryption", e)
	}
	create := func(client *apiClient, p, name string) string {
		data := testData(client.call(t, "POST", p, map[string]any{"name": name, "auth_method": "gitlab_access_token", "identity_config": map[string]string{}, "secret": map[string]string{"token": "glpat-private-test-token"}}, 201, tag(client, p)))
		if strings.Contains(fmt.Sprint(data), "glpat-") || strings.Contains(fmt.Sprint(data), "ciphertext") {
			t.Fatal("secret leaked")
		}
		return data["id"].(string)
	}
	beforeCommon := admin.call(t, "GET", path, nil, 200, nil)
	commonTag := admin.last.Header().Get("ETag")
	sys := path + "/credentials"
	one := create(admin, sys, "系统一")
	two := create(admin, sys, "系统二")
	afterCommon := admin.call(t, "GET", path, nil, 200, nil)
	if fmt.Sprint(beforeCommon) != fmt.Sprint(afterCommon) || admin.last.Header().Get("ETag") != commonTag {
		t.Fatal("credential writes altered common representation")
	}
	oldCollection := tag(admin, sys)
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 200, oldCollection)
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": two}, 412, oldCollection)
	// Competing commands share a snapshot: one commits, the other gets 412.
	concurrentTag := tag(admin, sys)["If-Match"]
	statuses := make(chan int, 2)
	for _, method := range []string{"PUT", "DELETE"} {
		go func(method string) {
			reqBody := ""
			if method == "PUT" {
				reqBody = fmt.Sprintf(`{"credential_id":%q}`, two)
			}
			req := httptest.NewRequest(method, "http://antcdp.test/api/v1"+sys+"/preferred", strings.NewReader(reqBody))
			req.Header.Set("Origin", "http://antcdp.test")
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("If-Match", concurrentTag)
			req.Header.Set("X-CSRF-Token", admin.csrf)
			for _, cookie := range admin.cookies {
				copyCookie := *cookie
				req.AddCookie(&copyCookie)
			}
			response := httptest.NewRecorder()
			admin.handler.ServeHTTP(response, req)
			statuses <- response.Code
		}(method)
	}
	first, second := <-statuses, <-statuses
	if !(first == http.StatusOK && second == http.StatusPreconditionFailed || second == http.StatusOK && first == http.StatusPreconditionFailed) {
		t.Fatalf("concurrent preferred status: %d/%d", first, second)
	}
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 200, tag(admin, sys))
	admin.call(t, "PUT", path+"/default-credential", map[string]string{"credential_id": two}, 200, tag(admin, path+"/default-credential"))
	admin.call(t, "PATCH", sys+"/"+two, map[string]bool{"enabled": false}, 200, tag(admin, sys+"/"+two))
	def := testData(admin.call(t, "GET", path+"/default-credential", nil, 200, nil))
	if def["credential_id"] != nil {
		t.Fatal("disabled default not cleared")
	}
	mine := "/me/integrations/gitlab/" + id + "/credentials"
	personal := create(member, mine, "个人令牌")
	admin.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	other.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	admin.call(t, "PUT", path+"/default-credential", map[string]string{"credential_id": personal}, 404, tag(admin, path+"/default-credential"))
	project := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "Integration_Project", "name": "集成权限测试", "admin_user_ids": []string{memberID}}, 201, nil))
	pid := project["id"].(string)
	pp := "/projects/" + pid + "/integrations/gitlab/" + id + "/credentials"
	projectCred := create(member, pp, "项目令牌")
	other.call(t, "GET", pp, nil, 403, nil)
	admin.call(t, "GET", pp, nil, 200, nil)
	admin.call(t, "POST", "/projects/"+pid+"/archive", nil, 204, tag(admin, "/projects/"+pid))
	member.call(t, "GET", pp, nil, 200, nil)
	member.call(t, "PATCH", pp+"/"+projectCred, map[string]string{"name": "归档禁止修改"}, 409, tag(member, pp+"/"+projectCred))
	admin.call(t, "POST", "/projects/"+pid+"/restore", nil, 204, tag(admin, "/projects/"+pid))
	// A mismatched scope cannot be supplied through a credential request body.
	member.call(t, "POST", mine, map[string]any{"name": "非法归属", "user_id": adminID}, 422, tag(member, mine))
	// An old collection cannot remove a record after a concurrent collection change.
	oldCollection = tag(admin, sys)
	create(admin, sys, "系统三")
	etag := tag(admin, sys+"/"+one)
	admin.call(t, "DELETE", sys+"/"+one, map[string]string{"expected_collection_version": oldCollection["If-Match"]}, 412, etag)
	// Database uniqueness is a last defense, while scopes may reuse names.
	if _, e := db.db.ExecContext(context.Background(), "UPDATE integration_credential SET is_preferred=1 WHERE id=?", two); e == nil {
		t.Fatal("multiple preferred accepted")
	}
	var constraints int
	if e := db.db.GetContext(context.Background(), &constraints, "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('integration','integration_gitlab','integration_credential') AND CONSTRAINT_TYPE IN ('FOREIGN KEY','CHECK')"); e != nil || constraints != 0 {
		t.Fatal("unexpected physical constraints", e)
	}
	// Keep a personal and a project credential to exercise the following account deletion.
	_ = projectCred
	admin.call(t, "DELETE", path, map[string]string{"expected_config_version": tag(admin, path+"/config")["If-Match"]}, 409, tag(admin, path))
}
