package mysql

import (
	"fmt"
	"strings"
	"testing"
)

func grantServiceConnection(t *testing.T, admin *apiClient, path, kind, subject string, enabled bool) {
	t.Helper()
	admin.call(t, "GET", path+"/grants", nil, 200, nil)
	admin.call(t, "PUT", path+"/grants/"+kind+"/"+subject, map[string]bool{"enabled": enabled}, 200, map[string]string{"If-Match": admin.last.Header().Get("ETag")})
}

func verifyConnectionScopes(t *testing.T, admin, member, other *apiClient, memberID string) {
	t.Helper()
	tag := func(client *apiClient, path string) map[string]string {
		client.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": client.last.Header().Get("ETag")}
	}
	project := func(code string) string {
		return testData(admin.call(t, "POST", "/projects", map[string]any{"name": code, "code": code, "admin_user_ids": []string{memberID}}, 201, nil))["id"].(string)
	}
	pa, pb := project("connection-scope-a"), project("connection-scope-b")
	create := func(client *apiClient, prefix string) string {
		return testData(client.call(t, "POST", prefix+"/mysql", map[string]any{"name": "测试数据库", "code": "scope-test-db", "config": map[string]any{"host": "db.example.com", "database": "app"}}, 201, nil))["id"].(string)
	}
	platform := "/admin/service-connections"
	projectA := "/projects/" + pa + "/service-connections"
	projectB := "/projects/" + pb + "/service-connections"
	global := create(admin, platform)
	localA, localB := create(member, projectA), create(member, projectB)
	globalPath := platform + "/mysql/" + global
	localPath := projectA + "/mysql/" + localA
	member.call(t, "POST", projectA+"/mysql", map[string]any{"name": "重复编码", "code": "scope-test-db", "config": map[string]any{"host": "db.example.com", "database": "other"}}, 409, nil)
	member.call(t, "GET", projectB+"/mysql/"+localA, nil, 404, nil)
	other.call(t, "GET", localPath, nil, 403, nil)
	member.call(t, "PATCH", localPath, map[string]string{"code": "renamed"}, 422, tag(member, localPath))
	member.call(t, "PATCH", localPath, map[string]any{"config": map[string]any{"database": "changed"}}, 200, tag(member, localPath))
	member.call(t, "GET", projectA+"/mysql/"+global+"/credentials", nil, 404, nil)
	grantServiceConnection(t, admin, globalPath, "project", pa, true)
	member.call(t, "GET", projectA+"/mysql/"+global, nil, 403, nil)
	member.call(t, "PATCH", projectA+"/mysql/"+global, map[string]any{"enabled": false}, 403, nil)
	admin.call(t, "PUT", localPath+"/grants/project/"+pb, map[string]bool{"enabled": true}, 404, nil)
	member.call(t, "GET", globalPath+"/grants", nil, 403, nil)
	admin.call(t, "PUT", globalPath+"/grants/project/"+pb, map[string]bool{"enabled": true}, 428, nil)
	stale := tag(admin, globalPath+"/grants")
	grantServiceConnection(t, admin, globalPath, "project", pb, true)
	admin.call(t, "PUT", globalPath+"/grants/project/"+pa, map[string]bool{"enabled": false}, 412, stale)
	cred := func(prefix string) string {
		p := prefix + "/credentials"
		return testData(member.call(t, "POST", p, map[string]any{"name": "只读", "code": "readonly", "authentication": map[string]any{"auth_method": "mysql_password", "identity_config": map[string]string{"username": "reader"}, "secret": map[string]string{"token": "fixture-password"}}}, 201, tag(member, p)))["id"].(string)
	}
	credentialA := cred(projectA + "/mysql/" + global)
	cred(projectB + "/mysql/" + global)
	cred(localPath)
	cred(projectB + "/mysql/" + localB)
	credentialPath := projectA + "/mysql/" + global + "/credentials/" + credentialA
	member.call(t, "GET", projectB+"/mysql/"+global+"/credentials/"+credentialA, nil, 404, nil)
	grantServiceConnection(t, admin, globalPath, "project", pa, false)
	member.call(t, "GET", credentialPath, nil, 404, nil)
	member.call(t, "POST", credentialPath+"/verify", map[string]any{}, 404, nil)
	grantServiceConnection(t, admin, globalPath, "project", pa, true)
	member.call(t, "GET", credentialPath, nil, 200, nil)
	// Team grants are independent: association with a team never grants a project access.
	team := testData(admin.call(t, "POST", "/teams", map[string]any{"name": "连接授权团队", "code": "connection-scope-team", "admin_user_ids": []string{memberID}}, 201, nil))["id"].(string)
	admin.call(t, "GET", "/projects/"+pa, nil, 200, nil)
	membershipTag := testData(member.call(t, "GET", "/projects/"+pa, nil, 200, nil))["membership_etag"].(string)
	member.call(t, "POST", "/projects/"+pa+"/teams", map[string]string{"team_id": team}, 204, map[string]string{"If-Match": membershipTag})
	grantServiceConnection(t, admin, globalPath, "team", team, true)
	grantServiceConnection(t, admin, globalPath, "project", pa, false)
	grantServiceConnection(t, admin, globalPath, "project", pb, false)
	teamDirectory := fmt.Sprint(member.call(t, "GET", "/teams/"+team+"/service-connections", nil, 200, nil))
	if !strings.Contains(teamDirectory, "scope-test-db") {
		t.Fatal("team grant not visible")
	}
	member.call(t, "GET", projectA+"/mysql/"+global+"/credentials", nil, 404, nil)
	grantServiceConnection(t, admin, globalPath, "team", team, false)
	if strings.Contains(fmt.Sprint(member.call(t, "GET", "/teams/"+team+"/service-connections", nil, 200, nil)), "scope-test-db") {
		t.Fatal("revoked team grant remained visible")
	}
}
