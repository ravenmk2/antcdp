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
	base := "/admin/service-connections/gitlab"
	tag := func(client *apiClient, path string) map[string]string {
		client.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": client.last.Header().Get("ETag")}
	}
	createConnection := func(name string) string {
		v := testData(admin.call(t, "POST", base, map[string]any{"name": name, "config": map[string]any{"base_url": "https://gitlab.example.com"}}, 201, nil))
		return v["id"].(string)
	}
	id := createConnection("GitLab 重构测试")
	path := base + "/" + id
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
	admin.call(t, "PATCH", path, map[string]any{"name": "must rollback", "config": map[string]any{"base_url": "http://unsafe.example.com"}}, 422, map[string]string{"If-Match": oldTag})
	unchanged := testData(admin.call(t, "GET", path, nil, 200, nil))
	if original["name"] != unchanged["name"] || oldTag != admin.last.Header().Get("ETag") {
		t.Fatal("invalid aggregate PATCH committed partial state")
	}
	admin.call(t, "PATCH", path, map[string]any{"name": "GitLab 新连接", "config": map[string]any{"base_url": "https://gitlab.example.com/subpath", "custom_ca_pem": nil}}, 200, map[string]string{"If-Match": oldTag})
	admin.call(t, "PATCH", path, map[string]any{"name": "stale"}, 412, map[string]string{"If-Match": oldTag})
	for _, ca := range []any{"", nil} {
		updated := testData(admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"custom_ca_pem": ca}}, 200, tag(admin, path)))
		persisted := testData(admin.call(t, "GET", path, nil, 200, nil))
		if fmt.Sprint(updated) != fmt.Sprint(persisted) {
			t.Fatal("CA null/empty transition was not persisted")
		}
	}
	admin.call(t, "POST", base, map[string]any{"name": "gitlab 新连接", "config": map[string]any{"base_url": "https://other.example.com"}}, 409, nil)

	webhook := path + "/webhook"
	secondID := createConnection("第二条连接")
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
	if receiver != "http://antcdp.test/api/v1/webhooks/gitlab/"+id {
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
	hookCall(id, "wrong-token", body, 401, "")
	hookCall(id, secret, body, 200, "received_not_dispatched")
	if tag(admin, webhook)["If-Match"] != endpointBefore || tag(admin, path)["If-Match"] != listBefore {
		t.Fatal("receipt changed edit/collection version")
	}
	hookCall(id, secret, `{"object_kind":"push","ref":"refs/heads/main","project":{"id":99}}`, 200, "received_not_dispatched")
	hookCall(id, secret, `{"object_kind":"merge_request","project":{"id":42}}`, 200, "received_not_dispatched")
	hookCall(id, secret, `{}`, 200, "received_not_dispatched", "New GitLab Event")
	hookCall(id, secret, `{"object_kind":"issue"}`, 200, "received_not_dispatched", "Issue Hook")
	hookCall(id, secret, `[]`, 400, "")
	hookCall(id, secret, `null`, 400, "")
	hookCall(id, secret, `{`, 400, "")
	hookCall(id, secret, `{}`, 400, "", "")
	previousSecret := secret
	secret = generate(webhook)
	hookCall(id, previousSecret, body, 401, "")
	hookCall(secondID, secret2, body, 200, "received_not_dispatched")
	hookCall(id, secret2, body, 401, "")
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": false}, 200, tag(admin, webhook))
	hookCall(id, secret, body, 404, "")
	hookCall(secondID, secret2, body, 200, "received_not_dispatched")
	admin.call(t, "PATCH", webhook, map[string]any{"enabled": true}, 200, tag(admin, webhook))
	admin.call(t, "PATCH", path, map[string]any{"enabled": false}, 200, tag(admin, path))
	hookCall(id, secret, body, 404, "")
	hookCall(secondID, secret2, body, 200, "received_not_dispatched")
	admin.call(t, "PATCH", path, map[string]any{"enabled": true}, 200, tag(admin, path))
	hookCall(secondID, secret2, body, 200, "received_not_dispatched")
	var encrypted string
	if err := db.db.GetContext(context.Background(), &encrypted, "SELECT webhook_secret_ciphertext FROM service_connection_gitlab WHERE connection_id=?", id); err != nil || !strings.HasPrefix(encrypted, "enc:v1:") || strings.Contains(encrypted, secret) {
		t.Fatal("webhook encryption", err)
	}
	otherID := createConnection("Other target")
	admin.call(t, "GET", base+"/"+otherID+"/webhook-endpoints/"+id, nil, 404, nil)
	member.call(t, "GET", webhook, nil, 403, nil)

	auth := map[string]any{"auth_method": "gitlab_access_token", "identity_config": map[string]any{}, "secret": map[string]string{"token": "glpat-private-test-token"}}
	create := func(client *apiClient, p, name string) string {
		data := testData(client.call(t, "POST", p, map[string]any{"name": name, "authentication": auth}, 201, tag(client, p)))
		if strings.Contains(fmt.Sprint(data), "glpat-") || strings.Contains(fmt.Sprint(data), "ciphertext") {
			t.Fatal("secret leaked")
		}
		code := data["code"].(string)
		if len(code) != 32 || code[12] != '4' {
			t.Fatal("invalid UUID")
		}
		return data["id"].(string)
	}
	commonBefore := admin.call(t, "GET", path, nil, 200, nil)
	commonTag := admin.last.Header().Get("ETag")
	sys := path + "/credentials"
	one := create(admin, sys, "系统一")
	two := create(admin, sys, "系统二")
	commonAfter := admin.call(t, "GET", path, nil, 200, nil)
	if fmt.Sprint(commonBefore) != fmt.Sprint(commonAfter) || admin.last.Header().Get("ETag") != commonTag {
		t.Fatal("credential write altered connection representation")
	}
	for _, code := range []string{"UPPER", "bad space", "-prefix", strings.Repeat("a", 65)} {
		admin.call(t, "POST", sys, map[string]any{"name": "code test", "code": code, "authentication": auth}, 422, tag(admin, sys))
	}
	oneData := testData(admin.call(t, "GET", sys+"/"+one, nil, 200, nil))
	member.call(t, "POST", "/me/service-connections/gitlab/"+id+"/credentials", map[string]any{"name": "duplicate", "code": oneData["code"], "authentication": auth}, 409, tag(member, "/me/service-connections/gitlab/"+id+"/credentials"))
	admin.call(t, "PATCH", sys+"/"+one, map[string]string{"code": "renamed"}, 422, tag(admin, sys+"/"+one))
	admin.call(t, "PUT", sys+"/"+one+"/authentication", map[string]any{"auth_method": "gitlab_access_token", "identity_config": map[string]string{"token_type": "personal"}, "secret": map[string]string{"token": "new-token-value"}}, 422, tag(admin, sys+"/"+one))
	beforeCredential := tag(admin, sys+"/"+one)["If-Match"]
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 200, tag(admin, sys+"/preferred"))
	if tag(admin, sys+"/"+one)["If-Match"] == beforeCredential {
		t.Fatal("preferred failed to update object version")
	}
	oldPreferred := tag(admin, sys+"/preferred")
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": two}, 200, oldPreferred)
	admin.call(t, "PUT", sys+"/preferred", map[string]string{"credential_id": one}, 412, oldPreferred)
	admin.call(t, "PUT", path+"/fallback-credential", map[string]string{"credential_id": two}, 200, tag(admin, path+"/fallback-credential"))
	admin.call(t, "PATCH", sys+"/"+two, map[string]bool{"enabled": false}, 200, tag(admin, sys+"/"+two))
	if testData(admin.call(t, "GET", path+"/fallback-credential", nil, 200, nil))["credential_id"] != nil {
		t.Fatal("disabled fallback not cleared")
	}
	if testData(admin.call(t, "GET", sys+"/preferred", nil, 200, nil))["credential_id"] != nil {
		t.Fatal("disabled preferred not cleared")
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
	admin.call(t, "PUT", sys+"/"+one+"/authentication", auth, 200, tag(admin, sys+"/"+one))
	// Real encryption and transactions, with only the remote HTTP probe substituted.
	store := func() (identity.Store, error) { return db, nil }
	svc := &integrations.Service{Identity: identity.New(store), Store: store, Cipher: installer.IntegrationSecret, ETag: installer.IntegrationETag}
	connectionID, _ := strconv.ParseUint(id, 10, 64)
	credentialID, _ := strconv.ParseUint(one, 10, 64)
	raw := admin.cookies["antcdp_session"].Value
	credentialTag := tag(admin, sys+"/"+one)["If-Match"]
	collectionTag := tag(admin, sys)["If-Match"]
	svc.Probe = func(ctx context.Context, _ *integrations.GitLabConfig, token string, started time.Time) integrations.Diagnostic {
		if token != "glpat-private-test-token" {
			t.Fatal("incorrect decrypted authentication")
		}
		return integrations.Diagnostic{ID: "probe-success", Kind: "credential_verification", StartedAt: started, FinishedAt: time.Now(), Status: "succeeded", Summary: map[string]any{"authentication": "valid"}}
	}
	if _, _, err := svc.Verify(context.Background(), raw, connectionID, credentialID, integrations.CredentialOwnership{Type: "system"}, credentialTag); err != nil {
		t.Fatal(err)
	}
	if tag(admin, sys+"/"+one)["If-Match"] != credentialTag || tag(admin, sys)["If-Match"] != collectionTag {
		t.Fatal("diagnostic changed edit versions")
	}
	svc.Probe = func(ctx context.Context, _ *integrations.GitLabConfig, _ string, started time.Time) integrations.Diagnostic {
		// This would time out if Verify held the parent lock across the remote call.
		bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if _, err := db.db.ExecContext(bounded, "UPDATE service_connection SET row_version=row_version+1 WHERE id=?", connectionID); err != nil {
			t.Fatal("external verification held database locks", err)
		}
		return integrations.Diagnostic{ID: "stale-probe", StartedAt: started, FinishedAt: time.Now(), Status: "failed", Summary: map[string]any{}}
	}
	_, _, verifyErr := svc.Verify(context.Background(), raw, connectionID, credentialID, integrations.CredentialOwnership{Type: "system"}, credentialTag)
	var apiErr *httpx.Error
	if !errors.As(verifyErr, &apiErr) || apiErr.Code != "STATE_CHANGED" {
		t.Fatal("stale verification accepted", verifyErr)
	}
	latest := testData(admin.call(t, "GET", sys+"/"+one+"/diagnostics", nil, 200, nil))["latest"].(map[string]any)
	if latest["id"] != "probe-success" || latest["outdated"] != true {
		t.Fatal("stale result replaced latest diagnostic", latest)
	}
	var sealed string
	if err := db.db.GetContext(context.Background(), &sealed, "SELECT secret_ciphertext FROM service_credential WHERE id=?", one); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.ExecContext(context.Background(), "UPDATE service_credential SET secret_format_version=NULL WHERE id=?", one); err != nil {
		t.Fatal(err)
	}
	expectCode(t, admin.call(t, "GET", sys+"/"+one, nil, 500, nil), "DATA_INTEGRITY_ERROR")
	if _, err := db.db.ExecContext(context.Background(), "UPDATE service_credential SET secret_format_version=1 WHERE id=?", one); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.IntegrationSecret("service-integrations/gitlab/credential/"+id+"/"+two+"/gitlab_access_token/v1", sealed, false); err == nil {
		t.Fatal("secret accepted under another credential")
	}
	mine := "/me/service-connections/gitlab/" + id + "/credentials"
	personal := create(member, mine, "个人令牌")
	admin.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	other.call(t, "GET", mine+"/"+personal, nil, 404, nil)
	admin.call(t, "PUT", path+"/fallback-credential", map[string]string{"credential_id": personal}, 404, tag(admin, path+"/fallback-credential"))
	project := testData(admin.call(t, "POST", "/projects", map[string]any{"code": "Service_Project", "name": "服务权限测试", "admin_user_ids": []string{memberID}}, 201, nil))
	pid := project["id"].(string)
	pp := "/projects/" + pid + "/service-connections/gitlab/" + id + "/credentials"
	projectCred := create(member, pp, "项目令牌")
	other.call(t, "GET", pp, nil, 403, nil)
	admin.call(t, "GET", pp, nil, 200, nil)
	admin.call(t, "POST", "/projects/"+pid+"/archive", nil, 204, tag(admin, "/projects/"+pid))
	member.call(t, "GET", pp, nil, 200, nil)
	member.call(t, "PATCH", pp+"/"+projectCred, map[string]string{"name": "禁止修改"}, 409, tag(member, pp+"/"+projectCred))
	admin.call(t, "POST", "/projects/"+pid+"/restore", nil, 204, tag(admin, "/projects/"+pid))
	member.call(t, "POST", mine, map[string]any{"name": "非法归属", "user_id": adminID}, 422, tag(member, mine))
	oldCollection := tag(admin, sys)["If-Match"]
	create(admin, sys, "系统三")
	headers := tag(admin, sys+"/"+one)
	headers["X-Collection-If-Match"] = oldCollection
	admin.call(t, "DELETE", sys+"/"+one, nil, 412, headers)
	admin.call(t, "DELETE", path, nil, 409, tag(admin, path))
	// Connection deletion removes its singleton settings, secret and receiver.
	admin.call(t, "DELETE", base+"/"+secondID, nil, 204, tag(admin, base+"/"+secondID))
	hookCall(secondID, secret2, body, 404, "")
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
	broken := createConnection("完整性检查")
	if _, err := db.db.ExecContext(context.Background(), "DELETE FROM service_connection_gitlab WHERE connection_id=?", broken); err != nil {
		t.Fatal(err)
	}
	expectCode(t, admin.call(t, "GET", base+"/"+broken, nil, 500, nil), "DATA_INTEGRITY_ERROR")
}
