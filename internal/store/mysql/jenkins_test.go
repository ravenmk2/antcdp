package mysql

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func verifyJenkinsIntegrations(t *testing.T, db *Store, installer *install.Service, admin, member, other *apiClient, memberID string) {
	t.Helper()
	base := "/admin/service-connections/jenkins"
	tag := func(client *apiClient, path string) map[string]string {
		client.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": client.last.Header().Get("ETag")}
	}
	created := testData(admin.call(t, "POST", base, map[string]any{"name": "Jenkins 集成测试", "config": map[string]any{"base_url": "https://jenkins.example.com/jenkins/"}}, 201, nil))
	id := created["id"].(string)
	path := base + "/" + id
	if created["service_type"] != "jenkins" || admin.last.Header().Get("Location") != "/api/v1"+path {
		t.Fatal("incorrect Jenkins representation")
	}
	// Persisted JSON is typed and schema-versioned; reads must reject corruption.
	var savedConfig string
	if err := db.db.GetContext(context.Background(), &savedConfig, "SELECT config FROM service_connection WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	for _, rawConfig := range []string{`{}`, `null`, `[]`, `{"base_url":"https://jenkins.example.com","token":"must-not-be-config"}`, `{"base_url":"https://jenkins.example.com","custom_ca_pem":42}`} {
		if _, err := db.db.ExecContext(context.Background(), "UPDATE service_connection SET config=? WHERE id=?", rawConfig, id); err != nil {
			t.Fatal(err)
		}
		expectCode(t, admin.call(t, "GET", path, nil, 500, nil), "DATA_INTEGRITY_ERROR")
	}
	if _, err := db.db.ExecContext(context.Background(), "UPDATE service_connection SET config=?,config_schema_version=2 WHERE id=?", savedConfig, id); err != nil {
		t.Fatal(err)
	}
	expectCode(t, admin.call(t, "GET", path, nil, 500, nil), "DATA_INTEGRITY_ERROR")
	if _, err := db.db.ExecContext(context.Background(), "UPDATE service_connection SET config_schema_version=1 WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	member.call(t, "GET", path, nil, 403, nil)
	admin.call(t, "GET", "/admin/service-connections/gitlab/"+id, nil, 404, nil)
	admin.call(t, "GET", path+"/webhook", nil, 404, nil)
	admin.call(t, "GET", "/admin/service-connections/gitlab/"+id+"/webhook", nil, 404, nil)
	types := fmt.Sprint(testData(member.call(t, "GET", "/service-types", nil, 200, nil)))
	if !strings.Contains(types, "jenkins_api_token") {
		t.Fatal("Jenkins capability missing")
	}
	old := tag(admin, path)
	admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"base_url": "http://jenkins.example.com/ci"}}, 200, old)
	admin.call(t, "PATCH", path, map[string]any{"name": "stale"}, 412, old)
	admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"job": "forbidden"}}, 422, tag(admin, path))
	sys := path + "/credentials"
	auth := map[string]any{"auth_method": "jenkins_api_token", "identity_config": map[string]string{"username": "build-bot"}, "secret": map[string]string{"token": "jenkins-private-test-token"}}
	create := func(client *apiClient, collection, name string) string {
		result := testData(client.call(t, "POST", collection, map[string]any{"name": name, "authentication": auth}, 201, tag(client, collection)))
		if result["identity_config"].(map[string]any)["username"] != "build-bot" || strings.Contains(fmt.Sprint(result), "jenkins-private-test-token") {
			t.Fatal("incorrect public identity/secret")
		}
		return result["id"].(string)
	}
	cid := create(admin, sys, "系统构建账号")
	cp := sys + "/" + cid
	admin.call(t, "POST", sys, map[string]any{"name": "wrong method", "authentication": map[string]any{"auth_method": "gitlab_access_token", "identity_config": map[string]string{}, "secret": map[string]string{"token": "test-token"}}}, 422, tag(admin, sys))
	admin.call(t, "PUT", cp+"/authentication", map[string]any{"auth_method": "jenkins_api_token", "identity_config": map[string]string{"username": "bot", "extra": "forbidden"}, "secret": map[string]string{"token": "test-token"}}, 422, tag(admin, cp))
	admin.call(t, "GET", "/admin/service-connections/gitlab/"+id+"/credentials/"+cid, nil, 404, nil)
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": cid}, 200, tag(admin, sys+"/preferred"))
	admin.call(t, "PUT", path+"/fallback-credential", map[string]string{"credential_id": cid}, 200, tag(admin, path+"/fallback-credential"))
	store := func() (identity.Store, error) { return db, nil }
	svc := (&integrations.Service{Identity: identity.New(store), Store: store, Cipher: installer.IntegrationSecret, ETag: installer.IntegrationETag}).ForType("jenkins")
	connectionID, _ := strconv.ParseUint(id, 10, 64)
	credentialID, _ := strconv.ParseUint(cid, 10, 64)
	raw := admin.cookies["antcdp_session"].Value
	credentialTag := tag(admin, cp)["If-Match"]
	svc.Probe = func(_ context.Context, cfg *integrations.HTTPConfig, token string, started time.Time) integrations.Diagnostic {
		if token != "jenkins-private-test-token" || cfg.BaseURL != "http://jenkins.example.com/ci" {
			t.Fatal("incorrect decrypted credential/config")
		}
		return integrations.Diagnostic{ID: "jenkins-verified", Kind: "credential_verification", Status: "succeeded", StartedAt: started, FinishedAt: time.Now(), Summary: map[string]any{"authentication": "valid", "permissions": "unknown"}}
	}
	if _, _, err := svc.Verify(context.Background(), raw, connectionID, credentialID, integrations.CredentialOwnership{Type: "system"}, credentialTag); err != nil {
		t.Fatal(err)
	}
	if tag(admin, cp)["If-Match"] != credentialTag {
		t.Fatal("verification changed edit version")
	}
	svc.Probe = func(ctx context.Context, _ *integrations.HTTPConfig, _ string, started time.Time) integrations.Diagnostic {
		bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if _, err := db.db.ExecContext(bounded, "UPDATE service_connection SET row_version=row_version+1 WHERE id=?", id); err != nil {
			t.Fatal("probe held parent lock", err)
		}
		return integrations.Diagnostic{ID: "jenkins-stale", StartedAt: started, FinishedAt: time.Now(), Summary: map[string]any{}}
	}
	_, _, err := svc.Verify(context.Background(), raw, connectionID, credentialID, integrations.CredentialOwnership{Type: "system"}, credentialTag)
	var apiErr *httpx.Error
	if !errors.As(err, &apiErr) || apiErr.Code != "STATE_CHANGED" {
		t.Fatal("stale result accepted", err)
	}
	auth["identity_config"] = map[string]string{"username": "new-bot"}
	admin.call(t, "PUT", cp+"/authentication", auth, 200, tag(admin, cp))
	stored := testData(admin.call(t, "GET", cp, nil, 200, nil))
	if stored["identity_config"].(map[string]any)["username"] != "new-bot" || stored["is_preferred"] != true {
		t.Fatal("authentication replacement lost identity/preferred")
	}
	auth["identity_config"] = map[string]string{"username": "build-bot"}
	var sealed string
	if err := db.db.GetContext(context.Background(), &sealed, "SELECT secret_ciphertext FROM service_credential WHERE id=?", cid); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.IntegrationSecret("service-integrations/gitlab/credential/"+id+"/"+cid+"/jenkins_api_token/v1", sealed, false); err == nil {
		t.Fatal("cross-type decryption succeeded")
	}
	admin.call(t, "PATCH", cp, map[string]any{"enabled": false}, 200, tag(admin, cp))
	if testData(admin.call(t, "GET", sys+"/preferred", nil, 200, nil))["credential_id"] != nil || testData(admin.call(t, "GET", path+"/fallback-credential", nil, 200, nil))["credential_id"] != nil {
		t.Fatal("disabled selections retained")
	}
	admin.call(t, "POST", cp+"/verify", map[string]any{}, 409, tag(admin, cp))
	admin.call(t, "PATCH", path, map[string]any{"enabled": false}, 200, tag(admin, path))
	admin.call(t, "POST", path+"/test", map[string]any{}, 409, tag(admin, path))
	mine := "/me/service-connections/jenkins/" + id + "/credentials"
	personal := create(member, mine, "个人构建账号")
	admin.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	other.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	project := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "Jenkins_Project", "name": "Jenkins 项目权限", "admin_user_ids": []string{memberID}}, 201, nil))
	projectPath := "/projects/" + project["id"].(string)
	pp := projectPath + "/service-connections/jenkins/" + id + "/credentials"
	pc := create(member, pp, "项目构建账号")
	other.call(t, "GET", pp, nil, 403, nil)
	admin.call(t, "POST", projectPath+"/archive", nil, 204, tag(admin, projectPath))
	member.call(t, "GET", pp, nil, 200, nil)
	member.call(t, "PUT", pp+"/"+pc+"/authentication", auth, 409, tag(member, pp+"/"+pc))
	admin.call(t, "POST", projectPath+"/restore", nil, 204, tag(admin, projectPath))
	admin.call(t, "DELETE", path, nil, 409, tag(admin, path))
	for _, item := range []struct {
		client         *apiClient
		collection, id string
	}{{admin, sys, cid}, {member, mine, personal}, {member, pp, pc}} {
		headers := tag(item.client, item.collection+"/"+item.id)
		headers["X-Collection-If-Match"] = tag(item.client, item.collection)["If-Match"]
		item.client.call(t, "DELETE", item.collection+"/"+item.id, nil, 204, headers)
	}
	admin.call(t, "DELETE", path, nil, 204, tag(admin, path))
	var count int
	if err := db.db.GetContext(context.Background(), &count, "SELECT COUNT(*) FROM service_connection WHERE id=?", id); err != nil || count != 0 {
		t.Fatal("Jenkins connection retained", err)
	}
}
