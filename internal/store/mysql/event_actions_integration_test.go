package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"testing"

	driver "github.com/go-sql-driver/mysql"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	jobVM "github.com/ravenmk2/antcdp/internal/jobadapters/sobek"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/jobs"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"event_actions", eventActionsIntegration})
}

func eventActionsIntegration(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw := f.Context, f.AdminToken
	robot, replacement := createTestRobot(t, f), createTestRobot(t, f)
	_, admin, err := f.Identity.User(ctx, raw, robot.ID)
	if err != nil {
		t.Fatal(err)
	}
	collab := &collaboration.Service{Identity: f.Identity}
	p, _, err := collab.Create(ctx, raw, collaboration.Project, collaboration.Write{Code: "event_actions", Name: new("Event actions"), Admins: []string{fmt.Sprint(admin.User.ID)}}, identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []*identity.User{robot, replacement} {
		if _, err = f.Store.db.ExecContext(ctx, "INSERT INTO project_member(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'admin',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", p.ID, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("project member delegates to lead robot", func(t *testing.T) {
		member, token := favoriteTestUser(t, f, "lead_requester")
		_, outsider := favoriteTestUser(t, f, "lead_outsider")
		if _, err := f.Store.db.ExecContext(ctx, "INSERT INTO project_member(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'member',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", p.ID, member.ID); err != nil {
			t.Fatal(err)
		}
		created, err := f.Agents.CreateDefinition(ctx, raw, cryptox.ID(), a.DefinitionCreate{Code: "lead_reviewer", Name: "Lead reviewer", Mode: "chat", ExecutorKind: "robot", ScopeKind: "project", ScopeID: new(fmt.Sprint(p.ID)), UsePolicy: "scope"})
		if err != nil {
			t.Fatal(err)
		}
		agent := created.Data.(*a.Definition)
		leadRobotID := *agent.RobotUserID
		if _, err := f.Store.db.ExecContext(ctx, "INSERT INTO project_member(project_id,user_id,role,created_at,updated_at) VALUES(?,?,'admin',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", p.ID, leadRobotID); err != nil {
			t.Fatal(err)
		}
		enableChatTestAgent(t, f, agent)
		create := a.SessionCreate{AgentID: fmt.Sprint(agent.ID)}
		_, err = f.Agents.CreateSession(ctx, outsider, cryptox.ID(), create)
		modelsExpectCode(t, err, "NOT_FOUND")
		opened, err := f.Agents.CreateSession(ctx, token, cryptox.ID(), create)
		if err != nil {
			t.Fatal(err)
		}
		detail := opened.Data.(a.SessionDetail)
		if detail.Configuration.ChatUserID == nil || *detail.Configuration.ChatUserID != member.ID || uint64(detail.Principal.ID) != leadRobotID || !detail.Permissions.Submit {
			t.Fatal("wrong requester or principal", detail.Configuration, detail.Principal)
		}
		_, err = f.Agents.GetSession(ctx, raw, detail.Configuration.ID)
		modelsExpectCode(t, err, "NOT_FOUND")
		accepted, err := f.Agents.SubmitInput(ctx, token, detail.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []agentcore.TextBlock{{Type: "text", Text: "Review MR !42"}}, ExpectedHash: detail.Selection.Hash})
		if err != nil {
			t.Fatal(err)
		}
		claim, err := f.Agents.ClaimRoot(ctx, agentcore.ClaimRequest{Candidate: agentcore.Candidate{SessionID: agentcore.ID(detail.Configuration.ID), InputID: agentcore.ID(accepted.Data.(a.InputAccepted).InputID)}, Epoch: "lead-review-test"})
		if err != nil || !claim.Claimed {
			t.Fatal("claim delegated review", err)
		}
		auth := claim.Execution.Authorization
		if uint64(auth.AccountID) != leadRobotID || auth.AccountType != "robot" || !auth.Allows("project", agentcore.ID(p.ID), "admin") {
			t.Fatal("robot project role", auth)
		}
		if _, err = f.Agents.EndRoot(ctx, claim.Execution.Ref, agentcore.RunEnd{Status: agentcore.Succeeded}); err != nil {
			t.Fatal(err)
		}
		config, err := f.Agents.GetDefinition(ctx, raw, agent.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = f.Agents.PatchDefinition(ctx, raw, agent.ID, config.Tag, a.DefinitionPatch{UsePolicy: a.Field[string]{Set: true, Value: "allowlist"}})
		if err != nil {
			t.Fatal(err)
		}
		_, err = f.Agents.SubmitInput(ctx, token, detail.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []agentcore.TextBlock{{Type: "text", Text: "Try again"}}, ExpectedHash: detail.Selection.Hash})
		modelsExpectCode(t, err, "AGENT_ACCESS_REVOKED")
	})
	jobService := &jobs.Service{Identity: f.Identity, Store: func() (identity.Store, error) { return f.Store, nil }, Executor: jobVM.Executor{}}
	j, _, err := jobService.Save(ctx, raw, p.ID, 0, jobs.Write{Code: "build", Name: "Build", Enabled: true, MaxConcurrency: 1, BusyPolicy: "skip", TimeoutMS: 1000, Config: &jobs.Config{RunAsUserID: robot.ID, Script: `function main(){return 1}`}})
	if err != nil {
		t.Fatal(err)
	}
	start := jobs.AutomationStart{ProjectID: p.ID, ActorID: robot.ID, CallerID: 991, Path: resourcecode.Locator{Code: "build"}, RequestKey: "build:mr:42", Inputs: map[string]json.RawMessage{}}
	first, err := jobService.StartAutomation(ctx, start)
	if err != nil || first.RunID == nil || first.Outcome != "accepted" {
		t.Fatal("job acceptance", first, err)
	}
	start.ActorID = admin.User.ID
	_, err = jobService.StartAutomation(ctx, start)
	modelsExpectCode(t, err, "EXECUTOR_UNAVAILABLE")
	start.ActorID = replacement.ID
	start.Trace = json.RawMessage(`{"attempt":2}`)
	replay, err := jobService.StartAutomation(ctx, start)
	if err != nil || replay.RunID == nil || *replay.RunID != *first.RunID || replay.Actor != robot.ID {
		t.Fatal("identity replacement lost idempotency", replay, err)
	}
	start.Inputs = map[string]json.RawMessage{"branch": json.RawMessage(`"changed"`)}
	_, err = jobService.StartAutomation(ctx, start)
	modelsExpectCode(t, err, "REQUEST_CONFLICT")
	start.RequestKey = "busy"
	start.Inputs = map[string]json.RawMessage{}
	busy, err := jobService.StartAutomation(ctx, start)
	if err != nil || busy.Outcome != "skipped" {
		t.Fatal("busy policy", busy, err)
	}
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE job_run SET status='succeeded',finished_at=UTC_TIMESTAMP(3) WHERE id=?", *first.RunID); err != nil {
		t.Fatal(err)
	}
	accepted, err := jobService.StartAutomation(ctx, start)
	if err != nil || accepted.RunID == nil {
		t.Fatal("busy result occupied request key", accepted, err)
	}
	start.Path = resourcecode.Locator{ScopeKind: "project", ScopeCode: "somewhere_else", Code: "build"}
	_, err = jobService.StartAutomation(ctx, start)
	modelsExpectCode(t, err, "NOT_FOUND")
	if j.Code != "build" {
		t.Fatal("job code missing", j)
	}

	created, err := f.Agents.CreateDefinition(ctx, raw, cryptox.ID(), a.DefinitionCreate{Code: "event_reviewer", Name: "Event reviewer", Mode: "service", ScopeKind: "platform"})
	if err != nil {
		t.Fatal(err)
	}
	agent := created.Data.(*a.Definition)
	var modelID uint64
	if err = f.Store.db.GetContext(ctx, &modelID, "SELECT id FROM model_definition WHERE model_id='agent-test' LIMIT 1"); err != nil {
		t.Fatal(err)
	}
	bindings, err := f.Agents.GetModelBindings(ctx, raw, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	id := strconv.FormatUint(modelID, 10)
	_, err = f.Agents.PutModelBindings(ctx, raw, agent.ID, bindings.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: id, GenerationParameters: json.RawMessage(`{}`)}}, DefaultModelID: id})
	if err != nil {
		t.Fatal(err)
	}
	current, err := f.Agents.GetDefinition(ctx, raw, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Agents.PatchDefinition(ctx, raw, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Agents.CreateSession(ctx, raw, cryptox.ID(), a.SessionCreate{AgentID: fmt.Sprint(agent.ID)})
	modelsExpectCode(t, err, "SERVICE_AUTOMATION_ONLY")
	jobChat := a.AutomationChat{JobRun: true, ActorID: robot.ID, ProjectID: p.ID, CallerID: *accepted.RunID, Path: resourcecode.Locator{ScopeKind: "platform", Code: agent.Code}, Message: "Review", RequestKey: "job-request"}
	_, err = f.Agents.ChatAutomation(ctx, jobChat)
	modelsExpectCode(t, err, "NOT_FOUND")
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE job_run SET status='running' WHERE id=?", *accepted.RunID); err != nil {
		t.Fatal(err)
	}
	wrong := jobChat
	wrong.ActorID = replacement.ID
	_, err = f.Agents.ChatAutomation(ctx, wrong)
	modelsExpectCode(t, err, "NOT_FOUND")
	var jobReceipts [2]a.ChatReceipt
	var jobErrors [2]error
	var concurrent sync.WaitGroup
	for i := range jobReceipts {
		concurrent.Go(func() { jobReceipts[i], jobErrors[i] = f.Agents.ChatAutomation(ctx, jobChat) })
	}
	concurrent.Wait()
	if jobErrors[0] != nil || jobErrors[1] != nil || jobReceipts[0].SessionID == 0 || jobReceipts[0].SessionID != jobReceipts[1].SessionID || jobReceipts[0].Replayed == jobReceipts[1].Replayed {
		t.Fatal("concurrent job replay", jobReceipts, jobErrors)
	}
	chat := a.AutomationChat{ProjectID: p.ID, ActorID: robot.ID, CallerID: 991, ConsumptionID: 101, Path: resourcecode.Locator{ScopeKind: "platform", Code: agent.Code}, Message: "Review this MR", Title: "Review", RequestKey: "review:mr:42"}
	results := make([]a.ChatReceipt, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range results {
		wg.Go(func() { results[i], errs[i] = f.Agents.ChatAutomation(ctx, chat) })
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || results[0].SessionID == 0 || results[0].SessionID != results[1].SessionID || results[0].InputID != results[1].InputID {
		t.Fatal("atomic concurrent chat", results, errs)
	}
	var count int
	if err = f.Store.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM agent_session s JOIN agent_input i ON i.session_id=s.id WHERE s.id=? AND s.run_as_user_id=? AND i.actor_id=? AND i.origin_kind='trigger' AND i.source_kind='event_consumption' AND i.source_id='101'`, results[0].SessionID, *agent.RobotUserID, fmt.Sprint(robot.ID)); err != nil || count != 1 {
		t.Fatal("execution identity/source", count, err)
	}
	chat.ActorID = replacement.ID
	chat.ConsumptionID = 102
	replayed, err := f.Agents.ChatAutomation(ctx, chat)
	if err != nil || !replayed.Replayed || replayed.SessionID != results[0].SessionID {
		t.Fatal("chat receipt changed with retry identity", replayed, err)
	}
	chat.Message = "changed"
	_, err = f.Agents.ChatAutomation(ctx, chat)
	modelsExpectCode(t, err, "REQUEST_CONFLICT")
	// A rejected request leaves neither an empty session nor a receipt behind.
	chat.RequestKey = "unavailable"
	chat.Message = "retry this"
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE `user` SET status='disabled' WHERE id=?", *agent.RobotUserID); err != nil {
		t.Fatal(err)
	}
	_, err = f.Agents.ChatAutomation(ctx, chat)
	modelsExpectCode(t, err, "PRINCIPAL_UNAVAILABLE")
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE `user` SET status='active' WHERE id=?", *agent.RobotUserID); err != nil {
		t.Fatal(err)
	}
	if accepted, err := f.Agents.ChatAutomation(ctx, chat); err != nil || accepted.Replayed {
		t.Fatal("rejected chat occupied key", accepted, err)
	}
	// Exercise a transaction rollback after session/input/receipt writes, then
	// let the store's real retry loop replay the complete command.
	var notifications []agentcore.CommitReceipt
	retrying := &a.Service{Identity: f.Identity, Models: f.Models, Files: f.Agents.Files, ETag: f.Agents.ETag,
		Store: func() (identity.Store, error) { return retryAdmissionStore{f.Store}, nil },
		Committed: func(_ context.Context, receipt agentcore.CommitReceipt) {
			notifications = append(notifications, receipt)
		},
	}
	chat.RequestKey = "transaction-retry"
	retried, err := retrying.ChatAutomation(ctx, chat)
	if err != nil || len(notifications) != 1 || len(notifications[0].Ranges) != 1 || uint64(notifications[0].Ranges[0].SessionID) != retried.SessionID {
		t.Fatal("rolled-back admission leaked a commit notification", retried, notifications, err)
	}

}

type retryAdmissionStore struct{ identity.Store }

func (s retryAdmissionStore) Transact(ctx context.Context, fn func(identity.Tx) error) error {
	first := true
	return s.Store.Transact(ctx, func(tx identity.Tx) error {
		if err := fn(tx); err != nil {
			return err
		}
		if first {
			first = false
			return &driver.MySQLError{Number: 1213, Message: "injected admission rollback"}
		}
		return nil
	})
}
