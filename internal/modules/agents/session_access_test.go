package agents

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type projectRepository struct {
	Repository
	allowed map[uint64]bool
}

func (r projectRepository) CanUseAgent(_ uint64, userID uint64, admin bool) (bool, error) {
	return admin || r.allowed[userID], nil
}
func TestSessionAgentAdmissionChecksUsageRights(t *testing.T) {
	owner := &identity.User{ID: 7, AccountType: "human"}
	repo := projectRepository{allowed: map[uint64]bool{7: true}}
	agent := &Definition{ID: 9, Mode: "interactive", ScopeKind: "project", ScopeID: new(uint64(23))}
	if err := requireSessionAgent(repo, agent, owner); err != nil {
		t.Fatal(err)
	}
	delete(repo.allowed, 7)
	var denied *httpx.Error
	if err := requireSessionAgent(repo, agent, owner); !errors.As(err, &denied) || denied.Code != "AGENT_ACCESS_REVOKED" {
		t.Fatalf("lost usage rights must prevent a new turn: %v", err)
	}
	owner.Role = "admin"
	if err := requireSessionAgent(repo, agent, owner); err != nil {
		t.Fatal(err)
	}
}

func TestServiceUsesRobotResourceRights(t *testing.T) {
	repo := projectRepository{allowed: map[uint64]bool{7: true}}
	agent := &Definition{ID: 9, Mode: "service", ScopeKind: "platform", RobotUserID: new(uint64(8))}
	robot := &identity.User{ID: 8, AccountType: "robot", Role: "user"}
	if err := requireSessionAgent(repo, agent, robot); err != nil {
		t.Fatal(err)
	}
	robot.AccountType = "human"
	if err := requireSessionAgent(repo, agent, robot); err == nil {
		t.Fatal("service execution accepted a human account")
	}
	if err := requireSessionAgent(repo, agent, nil); err == nil {
		t.Fatal("missing execution account accepted")
	}
}

func TestToolProjectUsesActualTargetAndPrincipal(t *testing.T) {
	repo := projectRepository{allowed: map[uint64]bool{7: true}}
	run := executionRows{Agent: &Definition{Mode: "interactive", ScopeKind: "project", ScopeID: new(uint64(41))}, Execution: agentcore.ExecutionContext{Principal: agentcore.PrincipalRef{Kind: "user", ID: 7}, Authorization: agentcore.Authorization{AccountID: 7, Grants: []agentcore.ResourceGrant{{Kind: "project", ID: 99, Role: "member"}}}}}
	project := uint64(41)
	tool := &ToolDescriptor{ProjectTarget: func(_ context.Context, _ identity.Tx, authorization agentcore.Authorization, _ json.RawMessage) (uint64, error) {
		if authorization.AccountID != run.Execution.Principal.ID {
			t.Fatal("wrong principal")
		}
		return project, nil
	}}
	if id, err := resolveToolProject(t.Context(), nil, repo, run, tool, nil); err != nil || id != 0 {
		t.Fatalf("agent ownership granted resource access: %d %v", id, err)
	}
	project = 99
	if id, err := resolveToolProject(t.Context(), nil, repo, run, tool, nil); err != nil || id != 99 {
		t.Fatalf("authorized target rejected: %d %v", id, err)
	}
}
