package mysql

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
)

func verifyAgentDingTalk(t *testing.T, store *Store, installer *install.Service, admin *apiClient, adminID string) {
	ctx := t.Context()
	uid, err := strconv.ParseUint(adminID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	auth := agentcore.Authorization{AccountID: agentcore.ID(uid), AgentScopeKind: "project"}
	if err := store.db.GetContext(ctx, &auth.AccountVersion, "SELECT auth_version FROM user WHERE id=?", uid); err != nil {
		t.Fatal(err)
	}
	var targetPath string
	for _, name := range []string{"first", "second"} {
		code := "agent-dingtalk-" + name
		project := testData(admin.call(t, "POST", "/projects", map[string]any{"code": code, "name": code, "admin_user_ids": []string{adminID}}, 201, nil))
		id := project["id"].(string)
		pid, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		auth.Grants = append(auth.Grants, agentcore.ResourceGrant{Kind: "project", ID: agentcore.ID(pid), Role: "admin"})
		path := "/projects/" + id + "/dingtalk/robots"
		row := testData(admin.call(t, "POST", path, map[string]any{"code": "notify", "name": name, "authentication": map[string]string{"access_token": strings.Repeat(name, 5), "secret": "SEC" + strings.Repeat(name, 5)}}, 201, nil))
		if name == "first" {
			auth.AgentScopeID = agentcore.ID(pid)
			targetPath = path + "/" + row["id"].(string)
		}
	}
	sends := 0
	svc := dingtalk.Service{Store: func() (identity.Store, error) { return store, nil }, Cipher: installer.DingTalkSecret,
		Send: func(_ context.Context, a dingtalk.Authentication, input dingtalk.TestInput) dingtalk.Diagnostic {
			if a.Token != strings.Repeat("first", 5) || input.Body != "test" {
				t.Fatal("incorrect project or payload")
			}
			sends++
			return dingtalk.Diagnostic{Status: "accepted"}
		}}
	list := func() dingtalk.AgentRobotPage {
		t.Helper()
		out, err := svc.AgentList(ctx, auth, "notify", 1, 20)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	out := list()
	if out.Total != 1 || len(out.Items) != 1 || out.Items[0].Name != "first" {
		t.Fatalf("project filter: %+v", out)
	}
	message := dingtalk.TestInput{Format: "text", Body: "test"}
	result, err := svc.AgentSend(ctx, auth, "notify", message)
	if err != nil || result.Status != "accepted" || sends != 1 {
		t.Fatalf("send: %+v %v", result, err)
	}
	admin.call(t, "GET", targetPath, nil, 200, nil)
	admin.call(t, "PATCH", targetPath, map[string]any{"enabled": false}, 200, map[string]string{"If-Match": admin.last.Header().Get("ETag")})
	if out := list(); out.Total != 0 || len(out.Items) != 0 {
		t.Fatal("disabled robot listed")
	}
	if _, err := svc.AgentSend(ctx, auth, "notify", message); err == nil {
		t.Fatal("disabled robot used")
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE project SET archived_at=UTC_TIMESTAMP(3) WHERE id=?", auth.AgentScopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AgentList(ctx, auth, "", 1, 20); err == nil {
		t.Fatal("archived project visible")
	}
	if sends != 1 {
		t.Fatal("denied call sent a message")
	}
}
