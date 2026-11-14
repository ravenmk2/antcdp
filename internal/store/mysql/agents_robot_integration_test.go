package mysql

import (
	"fmt"
	"strings"
	"testing"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"robot_identity", agentRobotIdentity})
}

func agentRobotIdentity(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw, svc := f.Context, f.AdminToken, f.Agents
	created, err := svc.CreateDefinition(ctx, raw, cryptox.ID(), a.DefinitionCreate{Name: strings.Repeat("机", 100), Mode: "service", ScopeKind: "platform"})
	if err != nil {
		t.Fatal(err)
	}
	agent := created.Data.(*a.Definition)
	if agent.RobotUserID == nil || agent.PoolCapacity == nil || *agent.PoolCapacity != 1 {
		t.Fatal("service agent did not atomically create a dedicated robot and default pool capacity")
	}
	robot, actor, err := f.Identity.User(ctx, raw, *agent.RobotUserID)
	if err != nil {
		t.Fatal(err)
	}
	if robot.AccountType != "robot" || robot.Status != "disabled" || robot.DisplayName != agent.Name || robot.ManagedAgentID == nil || *robot.ManagedAgentID != agent.ID {
		t.Fatalf("invalid bound robot: %+v", robot)
	}
	var passwords int
	if err = f.Store.db.GetContext(ctx, &passwords, "SELECT COUNT(*) FROM user_password WHERE user_id=?", robot.ID); err != nil || passwords != 0 {
		t.Fatalf("robot received login credentials: %d %v", passwords, err)
	}
	_, _, err = f.Identity.UpdateUser(ctx, raw, robot.ID, identity.UserTag(robot), identity.ProfilePatch{DisplayName: new("independent")}, identity.Metadata{})
	modelsExpectCode(t, err, "ROBOT_MANAGED_BY_AGENT")
	_, err = f.Identity.ResetPassword(ctx, raw, robot.ID, identity.UserTag(robot), "robot-login-forbidden", identity.Metadata{})
	modelsExpectCode(t, err, "ROBOT_MANAGED_BY_AGENT")
	updated, err := svc.PatchDefinition(ctx, raw, agent.ID, created.Tag, a.DefinitionPatch{Name: a.Field[string]{Set: true, Value: "Renamed robot"}})
	if err != nil {
		t.Fatal(err)
	}
	robot, _, err = f.Identity.User(ctx, raw, robot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if robot.DisplayName != "Renamed robot" {
		t.Fatal("agent and robot names diverged")
	}
	users, _, _, err := f.Identity.Users(ctx, raw, identity.Filter{Page: 1, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range users {
		if u.ID == robot.ID {
			t.Fatal("robot leaked into human user list")
		}
	}
	robots, _, _, err := f.Identity.Users(ctx, raw, identity.Filter{Page: 1, PageSize: 100, AccountType: "robot"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, u := range robots {
		found = found || u.ID == robot.ID
	}
	if !found {
		t.Fatal("robot missing from separate directory")
	}
	collab := &collaboration.Service{Identity: f.Identity}
	for _, kind := range []collaboration.Kind{collaboration.Team, collaboration.Project} {
		obj, _, e := collab.Create(ctx, raw, kind, collaboration.Write{Code: cryptox.ID(), Name: new("Robot grant " + string(kind)), Admins: []string{fmt.Sprint(actor.User.ID)}}, identity.Metadata{})
		if e != nil {
			t.Fatal(e)
		}
		_, e = collab.Member(ctx, raw, kind, obj.ID, robot.ID, "member", obj.MembershipETag, "add", identity.Metadata{})
		modelsExpectCode(t, e, "ROBOT_MANAGED_BY_AGENT")
		if _, e = collab.SetRobotMember(ctx, raw, agent.ID, kind, obj.ID, "member", obj.MembershipETag, identity.Metadata{}); e != nil {
			t.Fatal(e)
		}
		page, _, e := collab.RobotResources(ctx, raw, agent.ID, kind, collaboration.Query{Page: 1, Size: 100})
		if e != nil {
			t.Fatal(e)
		}
		var granted *collaboration.Resource
		for i := range page.Items {
			if page.Items[i].ID == obj.ID {
				granted = &page.Items[i]
			}
		}
		if granted == nil || !granted.IsMember || granted.Role != "member" {
			t.Fatal("managed robot grant was not projected")
		}
		_, e = collab.Member(ctx, raw, kind, obj.ID, robot.ID, "", granted.MembershipETag, "remove", identity.Metadata{})
		modelsExpectCode(t, e, "ROBOT_MANAGED_BY_AGENT")
		if _, e = collab.SetRobotMember(ctx, raw, agent.ID, kind, obj.ID, "", granted.MembershipETag, identity.Metadata{}); e != nil {
			t.Fatal(e)
		}
	}
	if _, err = svc.DeleteDefinition(ctx, raw, agent.ID, updated.Tag, cryptox.ID()); err != nil {
		t.Fatal(err)
	}
	var retained bool
	if err = f.Store.db.GetContext(ctx, &retained, "SELECT EXISTS(SELECT 1 FROM agent a JOIN `user` u ON u.id=a.robot_user_id WHERE a.id=? AND a.deleted_at IS NOT NULL AND u.deleted_at IS NOT NULL AND a.robot_user_id=?)", agent.ID, robot.ID); err != nil || !retained {
		t.Fatalf("deleted identity binding was not retained: %v", err)
	}
}
