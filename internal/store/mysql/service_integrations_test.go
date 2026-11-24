package mysql

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func verifyServiceIntegrations(t *testing.T, db *Store, installer *install.Service, admin, member, other *apiClient, adminID, memberID string) {
	t.Run("connection_scopes", func(t *testing.T) { verifyConnectionScopes(t, admin, member, other, memberID) })
	t.Run("message_management", func(t *testing.T) { verifyMessageManagement(t, db, installer, admin, member) })
	t.Run("project_repositories", func(t *testing.T) { verifyProjectRepositories(t, db, admin, member, other, adminID, memberID) })
	verifyJenkinsIntegrations(t, db, installer, admin, member, other, memberID)
	t.Run("remote_hosts", func(t *testing.T) { verifyRemoteHosts(t, db, installer, admin, member, other, memberID) })
	base := "/admin/service-connections/gitlab"
	tag := func(client *apiClient, path string) map[string]string {
		client.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": client.last.Header().Get("ETag")}
	}
	createConnection := func(name, code string) string {
		v := testData(admin.call(t, "POST", base, map[string]any{"name": name, "code": code, "config": map[string]any{"base_url": "https://gitlab.example.com"}}, 201, nil))
		return v["id"].(string)
	}
	const code = "gitlab-main_1"
	id := createConnection("GitLab 重构测试", code)
	path := base + "/" + id
	project := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "service_project", "name": "服务权限测试", "admin_user_ids": []string{memberID}}, 201, nil))
	pid := project["id"].(string)
	grantServiceConnection(t, admin, path, "project", pid, true)
	member.call(t, "GET", path, nil, 403, nil)
	directory := member.call(t, "GET", "/service-connections", nil, 200, nil)
	for _, private := range []string{"base_url", "fallback_credential_id", "created_by_user_id", "credentials_version"} {
		if strings.Contains(fmt.Sprint(directory), private) {
			t.Fatal("directory leaked", private)
		}
	}
	member.call(t, "GET", "/service-types", nil, 200, nil)
	admin.call(t, "GET", "/integrations", nil, 404, nil)
	admin.call(t, "GET", path+"/config", nil, 404, nil)
	admin.call(t, "PATCH", path, map[string]any{"service_type": "redis"}, 422, tag(admin, path))
	admin.call(t, "PATCH", path, map[string]any{"enabled": nil}, 422, tag(admin, path))
	admin.call(t, "PATCH", path, map[string]any{}, 422, tag(admin, path))
	admin.call(t, "PATCH", path, map[string]any{"name": "missing precondition"}, 428, nil)
	admin.call(t, "PATCH", path, map[string]any{"name": "invalid precondition"}, 422, map[string]string{"If-Match": "*"})
	original := testData(admin.call(t, "GET", path, nil, 200, nil))
	oldTag := admin.last.Header().Get("ETag")
	// HTTP is supported; use a forbidden loopback address to exercise rollback.
	admin.call(t, "PATCH", path, map[string]any{"name": "must rollback", "config": map[string]any{"base_url": "http://127.0.0.1"}}, 422, map[string]string{"If-Match": oldTag})
	unchanged := testData(admin.call(t, "GET", path, nil, 200, nil))
	if original["name"] != unchanged["name"] || original["config"].(map[string]any)["base_url"] != unchanged["config"].(map[string]any)["base_url"] || oldTag != admin.last.Header().Get("ETag") {
		t.Fatal("invalid aggregate PATCH committed partial state")
	}
	admin.call(t, "PATCH", path, map[string]any{"name": "GitLab 新连接", "config": map[string]any{"base_url": "https://gitlab.example.com/subpath", "custom_ca_pem": nil}}, 200, map[string]string{"If-Match": oldTag})
	admin.call(t, "PATCH", path, map[string]any{"name": "stale"}, 412, map[string]string{"If-Match": oldTag})
	const httpURL = "http://gitlab.example.com/subpath"
	admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"base_url": httpURL}}, 200, tag(admin, path))
	persistedHTTP := testData(admin.call(t, "GET", path, nil, 200, nil))
	if persistedHTTP["config"].(map[string]any)["base_url"] != httpURL {
		t.Fatal("supported HTTP GitLab URL was not persisted")
	}
	for _, ca := range []any{"", nil} {
		updated := testData(admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"custom_ca_pem": ca}}, 200, tag(admin, path)))
		persisted := testData(admin.call(t, "GET", path, nil, 200, nil))
		if fmt.Sprint(updated) != fmt.Sprint(persisted) {
			t.Fatal("CA null/empty transition was not persisted")
		}
	}
	admin.call(t, "POST", base, map[string]any{"name": "gitlab 新连接", "config": map[string]any{"base_url": "https://other.example.com"}}, 409, nil)

	webhook := path + "/webhook"
	const secondCode = "00042"
	projectBase := "/projects/" + pid + "/service-connections/gitlab"
	projectConn := testData(member.call(t, "POST", projectBase, map[string]any{"name": "项目 GitLab", "code": secondCode, "config": map[string]any{"base_url": "https://gitlab.example.com"}}, 201, nil))
	member.call(t, "GET", projectBase+"/"+projectConn["id"].(string)+"/webhook/receiver", nil, 404, nil)
	secondID := createConnection("第二条连接", secondCode)
	secondWebhook := base + "/" + secondID + "/webhook"
	initial := testData(admin.call(t, "GET", webhook, nil, 200, nil))
	if initial["connection_id"] != id || initial["enabled"] != false || initial["has_secret"] != false || initial["updated_at"] != nil {
		t.Fatal("invalid initial webhook settings")
	}
	for _, removed := range []string{"id", "name", "code", "description", "config"} {
		if _, ok := initial[removed]; ok {
			t.Fatal("endpoint entity field retained", removed)
		}
	}
	admin.call(t, "GET", path+"/webhook-endpoints", nil, 404, nil)
	admin.call(t, "POST", webhook, map[string]any{}, 404, nil)
	admin.call(t, "DELETE", webhook, nil, 404, nil)
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": true}, 422, tag(admin, webhook))
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": nil}, 422, tag(admin, webhook))
	admin.call(t, "PATCH", webhook, map[string]any{}, 422, tag(admin, webhook))
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": false}, 428, nil)
	for _, removed := range []string{"name", "config", "verification_method"} {
		admin.call(t, "PATCH", webhook, map[string]any{removed: "unsupported"}, 422, tag(admin, webhook))
	}
	connectionBefore := tag(admin, path)["If-Match"]
	webhookBefore := tag(admin, webhook)["If-Match"]
	generate := func(p string) string {
		data := testData(admin.call(t, "POST", p+"/verification/generate", map[string]any{}, 200, tag(admin, p)))
		return data["secret"].(map[string]any)["token"].(string)
	}
	secret := generate(webhook)
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": true}, 412, map[string]string{"If-Match": webhookBefore})
	if tag(admin, path)["If-Match"] != connectionBefore {
		t.Fatal("webhook secret changed connection edit version")
	}
	settingsTag := tag(admin, webhook)["If-Match"]
	admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"base_url": "https://gitlab.example.com/new-path"}}, 200, tag(admin, path))
	if tag(admin, webhook)["If-Match"] != settingsTag {
		t.Fatal("connection edit overwrote webhook version")
	}
	secret2 := generate(secondWebhook)
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": true}, 200, tag(admin, webhook))
	admin.call(t, "PATCH", secondWebhook, map[string]any{"enabled": true}, 200, tag(admin, secondWebhook))
	receiver := testData(admin.call(t, "GET", webhook+"/receiver", nil, 200, nil))["receive_url"].(string)
	if receiver != "http://antcdp.test/api/v1/webhooks/gitlab/"+code {
		t.Fatal("untrusted receiver", receiver)
	}
	hookCall := func(target, token, body string, want int, status string, event ...string) {
		req := httptest.NewRequest("POST", "http://antcdp.test/api/v1/webhooks/gitlab/"+target, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Gitlab-Token", token)
		eventName := "Push Hook"
		if len(event) != 0 {
			eventName = event[0]
		}
		req.Header.Set("X-Gitlab-Event", eventName)
		req.Header.Set("Origin", "https://external.example.com")
		w := httptest.NewRecorder()
		admin.handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("webhook %d: %s", w.Code, w.Body.String())
		}
		if status != "" && !strings.Contains(w.Body.String(), status) {
			t.Fatalf("webhook status: %s", w.Body.String())
		}
	}
	body := `{"object_kind":"push","ref":"refs/heads/main","project":{"id":42}}`
	endpointBefore := tag(admin, webhook)["If-Match"]
	listBefore := tag(admin, path)["If-Match"]
	hookCall(id, secret, body, 404, "")
	hookCall(code, "wrong-token", body, 401, "")
	hookCall(code, secret, body, 200, "received_not_dispatched")
	if tag(admin, webhook)["If-Match"] != endpointBefore || tag(admin, path)["If-Match"] != listBefore {
		t.Fatal("receipt changed edit/collection version")
	}
	hookCall(code, secret, `{"object_kind":"push","ref":"refs/heads/main","project":{"id":99}}`, 200, "received_not_dispatched")
	hookCall(code, secret, `{"object_kind":"merge_request","project":{"id":42}}`, 200, "received_not_dispatched")
	hookCall(code, secret, `{}`, 200, "received_not_dispatched", "New GitLab Event")
	hookCall(code, secret, `{"object_kind":"issue"}`, 200, "received_not_dispatched", "Issue Hook")
	hookCall(code, secret, `[]`, 400, "")
	hookCall(code, secret, `null`, 400, "")
	hookCall(code, secret, `{`, 400, "")
	hookCall(code, secret, `{}`, 400, "", "")
	previousSecret := secret
	secret = generate(webhook)
	hookCall(code, previousSecret, body, 401, "")
	hookCall(secondCode, secret2, body, 200, "received_not_dispatched")
	hookCall(code, secret2, body, 401, "")
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": false}, 200, tag(admin, webhook))
	hookCall(code, secret, body, 404, "")
	hookCall(secondCode, secret2, body, 200, "received_not_dispatched")
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": true}, 200, tag(admin, webhook))
	admin.call(t, "PATCH", path, map[string]any{"enabled": false}, 200, tag(admin, path))
	hookCall(code, secret, body, 404, "")
	hookCall(secondCode, secret2, body, 200, "received_not_dispatched")
	admin.call(t, "PATCH", path, map[string]any{"enabled": true}, 200, tag(admin, path))
	hookCall(secondCode, secret2, body, 200, "received_not_dispatched")
	var encrypted string
	if err := db.db.GetContext(context.Background(), &encrypted, "SELECT webhook_secret_ciphertext FROM service_connection_gitlab WHERE connection_id=?", id); err != nil || !strings.HasPrefix(encrypted, "enc:v1:") || strings.Contains(encrypted, secret) {
		t.Fatal("webhook encryption", err)
	}
	otherID := createConnection("Other target", "other-target")
	admin.call(t, "GET", base+"/"+otherID+"/webhook-endpoints/"+id, nil, 404, nil)
	member.call(t, "GET", webhook, nil, 403, nil)

	material := map[string]string{"value": "glpat-private-test-token"}
	create := func(client *apiClient, p, name string) string {
		data := testData(client.call(t, "POST", p, map[string]any{"name": name, "kind": "secret", "material": material}, 201, nil))
		if strings.Contains(fmt.Sprint(data), "glpat-") {
			t.Fatal("secret leaked")
		}
		return data["id"].(string)
	}
	catalog := "/admin/credentials"
	commonBefore := admin.call(t, "GET", path, nil, 200, nil)
	commonTag := admin.last.Header().Get("ETag")
	sys := path + "/credentials"
	one := create(admin, catalog, "系统一")
	two := create(admin, catalog, "系统二")
	commonAfter := admin.call(t, "GET", path, nil, 200, nil)
	if fmt.Sprint(commonBefore) != fmt.Sprint(commonAfter) || admin.last.Header().Get("ETag") != commonTag {
		t.Fatal("credential write altered connection representation")
	}
	for _, code := range []string{"UPPER", "bad space", "-prefix", strings.Repeat("a", 65)} {
		admin.call(t, "POST", catalog, map[string]any{"name": "code test", "code": code, "kind": "secret", "material": material}, 422, tag(admin, sys))
	}
	oneData := testData(admin.call(t, "GET", catalog+"/"+one, nil, 200, nil))
	member.call(t, "POST", "/me/credentials", map[string]any{"name": "duplicate", "code": oneData["code"], "kind": "secret", "material": material}, 201, nil)
	admin.call(t, "POST", catalog, map[string]any{"name": "conflict", "code": oneData["code"], "kind": "access_key_pair", "identifier": "test", "material": material}, 409, nil)
	admin.call(t, "PATCH", catalog+"/"+one, map[string]string{"code": "renamed"}, 422, tag(admin, catalog+"/"+one))
	beforeCredential := tag(admin, catalog+"/"+one)["If-Match"]
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 200, tag(admin, sys+"/preferred"))
	if tag(admin, catalog+"/"+one)["If-Match"] != beforeCredential {
		t.Fatal("preference modified independent credential")
	}
	oldPreferred := tag(admin, sys+"/preferred")
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": two}, 200, oldPreferred)
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 412, oldPreferred)
	admin.call(t, "GET", path+"/fallback-credential", nil, 404, nil)
	admin.call(t, "PATCH", catalog+"/"+two, map[string]bool{"enabled": false}, 200, tag(admin, catalog+"/"+two))

	if testData(admin.call(t, "GET", sys+"/preferred", nil, 200, nil))["credential_id"] != two {
		t.Fatal("disable changed selected identity")
	}
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 200, tag(admin, sys+"/preferred"))
	// Two commands share the same preferred snapshot; only one may commit.
	concurrentTag := tag(admin, sys+"/preferred")["If-Match"]
	statuses := make(chan int, 2)
	for range 2 {
		go func() {
			req := httptest.NewRequest("DELETE", "http://antcdp.test/api/v1"+sys+"/preferred", nil)
			req.Header.Set("Origin", "http://antcdp.test")
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("If-Match", concurrentTag)
			req.Header.Set("X-CSRF-Token", admin.csrf)
			for _, cookie := range admin.cookies {
				copyCookie := *cookie
				req.AddCookie(&copyCookie)
			}
			w := httptest.NewRecorder()
			admin.handler.ServeHTTP(w, req)
			statuses <- w.Code
		}()
	}
	first, second := <-statuses, <-statuses
	if (first != http.StatusNoContent || second != http.StatusPreconditionFailed) && (second != http.StatusNoContent || first != http.StatusPreconditionFailed) {
		t.Fatalf("concurrent selection: %d/%d", first, second)
	}
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 200, tag(admin, sys+"/preferred"))
	// Real encryption and transactions, with only the remote HTTP probe substituted.
	store := func() (identity.Store, error) { return db, nil }
	svc := &integrations.Service{Identity: identity.New(store), Store: store, CredentialCipher: installer.CredentialSecret, Cipher: installer.IntegrationSecret, ETag: installer.IntegrationETag}
	connectionID, _ := strconv.ParseUint(id, 10, 64)
	credentialID, _ := strconv.ParseUint(one, 10, 64)
	raw := admin.cookies["antcdp_session"].Value
	credentialTag := tag(admin, catalog+"/"+one)["If-Match"]
	collectionTag := tag(admin, sys)["If-Match"]
	svc.Probe = func(ctx context.Context, _ *integrations.HTTPConfig, token string, started time.Time) integrations.Diagnostic {
		if token != "glpat-private-test-token" {
			t.Fatal("incorrect decrypted authentication")
		}
		return integrations.Diagnostic{ID: "probe-success", Kind: "credential_verification", StartedAt: started, FinishedAt: time.Now(), Status: "succeeded", Summary: map[string]any{"authentication": "valid"}}
	}
	if _, _, err := svc.Verify(context.Background(), raw, connectionID, credentialID, integrations.CredentialOwnership{Type: "platform"}, credentialTag); err != nil {
		t.Fatal(err)
	}
	if tag(admin, catalog+"/"+one)["If-Match"] != credentialTag || tag(admin, sys)["If-Match"] != collectionTag {
		t.Fatal("diagnostic changed edit versions")
	}
	svc.Probe = func(ctx context.Context, _ *integrations.HTTPConfig, _ string, started time.Time) integrations.Diagnostic {
		// This would time out if Verify held the parent lock across the remote call.
		bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if _, err := db.db.ExecContext(bounded, "UPDATE service_connection SET row_version=row_version+1 WHERE id=?", connectionID); err != nil {
			t.Fatal("external verification held database locks", err)
		}
		return integrations.Diagnostic{ID: "stale-probe", StartedAt: started, FinishedAt: time.Now(), Status: "failed", Summary: map[string]any{}}
	}
	_, _, verifyErr := svc.Verify(context.Background(), raw, connectionID, credentialID, integrations.CredentialOwnership{Type: "platform"}, credentialTag)
	var apiErr *httpx.Error
	if !errors.As(verifyErr, &apiErr) || apiErr.Code != "STATE_CHANGED" {
		t.Fatal("stale verification accepted", verifyErr)
	}
	latest := testData(admin.call(t, "GET", sys+"/"+one+"/diagnostics", nil, 200, nil))["latest"].(map[string]any)
	if latest["id"] != "probe-success" || latest["outdated"] != true {
		t.Fatal("stale result replaced latest diagnostic", latest)
	}
	var sealed string
	if err := db.db.GetContext(context.Background(), &sealed, "SELECT ciphertext FROM credential WHERE id=?", one); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.CredentialSecret("credential/"+two+"/secret/v1", sealed, false); err == nil {
		t.Fatal("material accepted for different credential")
	}
	mine := "/me/credentials"
	personal := create(member, mine, "个人令牌")
	admin.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	other.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	pp := "/projects/" + pid + "/credentials"
	projectCred := create(member, pp, "项目令牌")
	other.call(t, "GET", pp, nil, 403, nil)
	admin.call(t, "GET", pp, nil, 200, nil)
	admin.call(t, "POST", "/projects/"+pid+"/archive", nil, 204, tag(admin, "/projects/"+pid))
	member.call(t, "GET", pp, nil, 200, nil)
	member.call(t, "PATCH", pp+"/"+projectCred, map[string]string{"name": "禁止修改"}, 409, tag(member, pp+"/"+projectCred))
	admin.call(t, "POST", "/projects/"+pid+"/restore", nil, 204, tag(admin, "/projects/"+pid))
	member.call(t, "POST", mine, map[string]any{"name": "非法归属", "user_id": adminID}, 422, tag(member, mine))
	admin.call(t, "DELETE", catalog+"/"+one, nil, 409, tag(admin, catalog+"/"+one))
	admin.call(t, "DELETE", path, nil, 409, tag(admin, path))
	// Connection deletion removes its singleton settings, secret and receiver.
	admin.call(t, "DELETE", base+"/"+secondID, nil, 204, tag(admin, base+"/"+secondID))
	hookCall(secondCode, secret2, body, 404, "")
	var settingsCount int
	if err := db.db.GetContext(context.Background(), &settingsCount, "SELECT COUNT(*) FROM service_connection_gitlab WHERE connection_id=?", secondID); err != nil || settingsCount != 0 {
		t.Fatal("deleted connection retained webhook secret", err)
	}
	admin.call(t, "DELETE", base+"/"+otherID, nil, 204, tag(admin, base+"/"+otherID))
	var constraints int
	if err := db.db.GetContext(context.Background(), &constraints, "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE IN ('FOREIGN KEY','CHECK')"); err != nil || constraints != 0 {
		t.Fatal("unexpected physical constraints", err, constraints)
	}
	// A missing extension must be a controlled integrity error, not an empty config.
	broken := createConnection("完整性检查", "broken")
	if _, err := db.db.ExecContext(context.Background(), "DELETE FROM service_connection_gitlab WHERE connection_id=?", broken); err != nil {
		t.Fatal(err)
	}
	expectCode(t, admin.call(t, "GET", base+"/"+broken, nil, 500, nil), "DATA_INTEGRITY_ERROR")
}
