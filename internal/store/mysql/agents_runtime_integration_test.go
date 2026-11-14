package mysql

import (
	"context"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"runtime_transactions", agentRuntimeTransactions})
}

func agentRuntimeTransactions(t *testing.T, f *agentIntegrationFixture) {
	svc := f.Agents
	oldCatalog, oldEpoch := svc.Catalog, svc.Epoch
	t.Cleanup(func() { svc.Catalog, svc.Epoch = oldCatalog, oldEpoch })
	svc.Epoch = "runtime-integration-epoch"
	svc.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		class := "backend"
		if key == "delegate" {
			class = "child"
		}
		if key == "ask_user_question" {
			class = "question"
		}
		policies := []string{"allow", "deny", "confirm"}
		if class == "question" {
			policies = []string{"allow", "deny"}
		}
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: class, ParallelSafe: true, SupportedPolicies: policies, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, Description: "Test controlled tool", InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}, AuthorizeTool: func(context.Context, identity.Tx, core.ExecutionContext, a.ToolDescriptor, json.RawMessage, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{"authorized":true}`), nil
	}}
	agent := runtimeTestAgent(t, f)
	t.Run("session_titles", func(t *testing.T) { runtimeSessionTitles(t, f, agent.ID) })
	t.Run("turn_lifecycle", func(t *testing.T) { runtimeTurnLifecycle(t, f, agent.ID) })
	t.Run("tool_and_question_lifecycle", func(t *testing.T) { runtimeToolsAndQuestions(t, f, agent.ID) })
	t.Run("approval_rechecks_next_turn_permission", func(t *testing.T) { runtimeApproval(t, f, agent.ID) })
	t.Run("child_atomic_result_and_recovery", func(t *testing.T) { runtimeChildren(t, f, agent.ID) })
	t.Run("current_epoch_uncommitted_model_result", func(t *testing.T) { runtimeUncommittedModel(t, f, agent.ID) })
	t.Run("stop_publishes_queue_transition", func(t *testing.T) { runtimeStopQueue(t, f, agent.ID) })
	t.Run("attachment_read_lease_and_archive_race", func(t *testing.T) { runtimeFiles(t, f, agent.ID) })
	t.Run("compaction_success_failure_restart", func(t *testing.T) { runtimeCompaction(t, f, agent.ID) })
	t.Run("debug_admission_atomicity", func(t *testing.T) { runtimeDebug(t, f, agent.ID) })
	t.Run("skill_without_source_does_not_block_chat", func(t *testing.T) {
		bindings, err := svc.GetToolBindings(f.Context, f.AdminToken, agent.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = svc.PutToolBindings(f.Context, f.AdminToken, agent.ID, bindings.Tag, a.ToolBindingsWrite{Items: []a.ToolBindingWrite{{ToolKey: "skill", Policy: "allow", Constraints: json.RawMessage(`{}`)}}})
		if err != nil {
			t.Fatal(err)
		}
		session := runtimeSession(t, f, agent.ID)
		x := runtimeClaim(t, f, session.Configuration.ID, "Continue without a skill source")
		prepared, err := svc.PrepareStep(f.Context, x, 1)
		if err != nil {
			t.Fatal(err)
		}
		for _, tool := range prepared.Tools {
			if tool.Key == "skill" {
				t.Fatal("skill exposed without source")
			}
		}
		var content string
		if err = f.Store.db.GetContext(f.Context, &content, "SELECT JSON_EXTRACT(payload,'$.public.entries') FROM agent_event WHERE session_id=? AND event_type='context/skills' ORDER BY seq DESC LIMIT 1", session.Configuration.ID); err != nil || content != "[]" {
			t.Fatal("missing explicit empty directory", content, err)
		}
		if _, err = svc.StopRun(f.Context, f.AdminToken, uint64(x.Ref.RunID), cryptox.ID(), a.StopRunWrite{}); err != nil {
			t.Fatal(err)
		}
	})
}

func runtimeTestAgent(t *testing.T, f *agentIntegrationFixture) *a.Definition {
	t.Helper()
	var modelID uint64
	if e := f.Store.db.GetContext(f.Context, &modelID, "SELECT id FROM model_definition WHERE model_id='agent-test' LIMIT 1"); e != nil {
		t.Fatal(e)
	}
	created, e := f.Agents.CreateDefinition(f.Context, f.AdminToken, cryptox.ID(), a.DefinitionCreate{Name: "运行事务测试", Mode: "interactive", ScopeKind: "platform"})
	if e != nil {
		t.Fatal(e)
	}
	agent := created.Data.(*a.Definition)
	b, e := f.Agents.GetModelBindings(f.Context, f.AdminToken, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	id := strconv.FormatUint(modelID, 10)
	_, e = f.Agents.PutModelBindings(f.Context, f.AdminToken, agent.ID, b.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: id, ThinkingOptions: []string{"standard"}, DefaultThinking: "standard", GenerationOverrides: json.RawMessage(`{}`)}}, DefaultModelID: id, DefaultThinking: "standard"})
	if e != nil {
		t.Fatal(e)
	}
	runtimeToolPolicies(t, f, agent.ID, "confirm")
	current, e := f.Agents.GetDefinition(f.Context, f.AdminToken, agent.ID)
	if e != nil {
		t.Fatal(e)
	}
	policy := current.Data.(*a.Definition).RuntimePolicy
	policy.QuestionTimeout = 5
	_, e = f.Agents.PatchDefinition(f.Context, f.AdminToken, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}, RuntimePolicy: a.Field[a.RuntimePolicy]{Set: true, Value: policy}})
	if e != nil {
		t.Fatal(e)
	}
	return agent
}

func runtimeToolPolicies(t *testing.T, f *agentIntegrationFixture, id uint64, effectPolicy string) {
	t.Helper()
	current, e := f.Agents.GetToolBindings(f.Context, f.AdminToken, id)
	if e != nil {
		t.Fatal(e)
	}
	items := []a.ToolBindingWrite{}
	for _, key := range []string{"echo", "ask_user_question", "delegate", "effect"} {
		policy := "allow"
		if key == "effect" {
			policy = effectPolicy
		}
		items = append(items, a.ToolBindingWrite{ToolKey: key, Policy: policy, Constraints: json.RawMessage(`{}`)})
	}
	if _, e = f.Agents.PutToolBindings(f.Context, f.AdminToken, id, current.Tag, a.ToolBindingsWrite{Items: items}); e != nil {
		t.Fatal(e)
	}
}

func runtimeSession(t *testing.T, f *agentIntegrationFixture, agent uint64) a.SessionDetail {
	t.Helper()
	r, e := f.Agents.CreateSession(f.Context, f.AdminToken, cryptox.ID(), a.SessionCreate{AgentID: strconv.FormatUint(agent, 10)})
	if e != nil {
		t.Fatal(e)
	}
	return r.Data.(a.SessionDetail)
}

func runtimeClaim(t *testing.T, f *agentIntegrationFixture, session uint64, text string) core.ExecutionContext {
	t.Helper()
	detail, e := f.Agents.GetSession(f.Context, f.AdminToken, session)
	if e != nil {
		t.Fatal(e)
	}
	input, e := f.Agents.SubmitInput(f.Context, f.AdminToken, session, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: text}}, ExpectedHash: detail.Data.(a.SessionDetail).Selection.Hash})
	if e != nil {
		t.Fatal(e)
	}
	claim, e := claimCloudRoot(t, f, f.Agents.Sandboxes, core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session), InputID: core.ID(input.Data.(a.InputAccepted).InputID)}, Epoch: f.Agents.Epoch})
	if e != nil || !claim.Claimed {
		if e == nil {
			var reason string
			_ = f.Store.db.GetContext(f.Context, &reason, "SELECT CONCAT(i.status,':',COALESCE(i.end_reason,''),':',COALESCE(c.state,''),':',COALESCE(c.error_code,'')) FROM agent_input i JOIN agent_session s ON s.id=i.session_id LEFT JOIN cloud_computer c ON c.id=s.cloud_computer_id WHERE i.id=?", input.Data.(a.InputAccepted).InputID)
			t.Log("unclaimed input:", reason)
		}
		t.Fatal("claim", e)
	}
	return claim.Execution
}

func runtimeAttempt(t *testing.T, f *agentIntegrationFixture, execution core.ExecutionContext, step uint32, message modelcore.Message) core.AttemptCommit {
	t.Helper()
	prepared, e := f.Agents.PrepareStep(f.Context, execution, step)
	if e != nil {
		t.Fatal("prepare", e)
	}
	hash, e := core.ContentHash(prepared.Request)
	if e != nil {
		t.Fatal(e)
	}
	frozen, e := f.Agents.FreezeAttempt(f.Context, execution.Ref, core.AttemptDraft{Step: prepared, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now().UTC(), 30, execution.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}})
	if e != nil {
		t.Fatal("freeze", e)
	}
	in, out := int64(20), int64(10)
	result := core.AttemptResult{Permit: frozen.Permit, Outcome: core.AttemptOutcome{Response: modelcore.Response{Message: message, Usage: modelcore.Usage{InputTokens: &in, OutputTokens: &out, RawNumericFields: map[string]int64{"prompt_tokens": 20, "completion_tokens": 10, "secret": 4}}, ReturnedModel: "agent-test"}}}
	committed, e := f.Agents.CompleteAttempt(f.Context, execution.Ref, result)
	if e != nil || committed.Failure != nil {
		t.Fatal("complete", e, committed.Failure)
	}
	var raw string
	if e = f.Store.db.GetContext(f.Context, &raw, "SELECT usage_raw FROM agent_model_call WHERE id=?", uint64(frozen.Permit.CallID)); e != nil || strings.Contains(raw, "secret") || !strings.Contains(raw, "prompt_tokens") {
		t.Fatal("raw usage whitelist", raw, e)
	}
	return committed
}

func runtimeEnd(t *testing.T, f *agentIntegrationFixture, execution core.ExecutionContext) {
	t.Helper()
	if _, e := f.Agents.EndRoot(f.Context, execution.Ref, core.RunEnd{Status: core.Succeeded}); e != nil {
		t.Fatal(e)
	}
}

const runtimeQuestionArgs = `{"questions":[{"question_id":"q1","prompt":"请选择继续方式","type":"single_choice","options":[{"id":"yes","label":"继续","description":"继续检查"}],"allow_text":false}]}`

func runtimeToolsAndQuestions(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "执行工具并请求补充")
	commit := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-echo", Name: "echo", Arguments: `{}`}, {ID: "call-question", Name: "ask_user_question", Arguments: runtimeQuestionArgs}}})
	if len(commit.Calls) != 2 {
		t.Fatal("all tool intentions were not committed")
	}
	through := uint64(commit.AssistantSeq)
	_, historyErr := f.Agents.History(f.Context, f.AdminToken, session.Configuration.ID, a.HistoryQuery{Through: &through, Limit: 1})
	modelsExpectCode(t, historyErr, "HISTORY_GROUP_BOUNDARY")
	before := through + uint64(len(commit.Calls)) + 1
	history, historyErr := f.Agents.History(f.Context, f.AdminToken, session.Configuration.ID, a.HistoryQuery{Before: &before, Limit: 1})
	if historyErr != nil {
		t.Fatal("complete tool declaration page", historyErr)
	}
	records := history.Data.(a.HistoryPage).Records
	if len(records) != 3 || records[0].Type != "assistant/message" || records[1].Type != "tool/call" || records[2].Type != "tool/call" {
		t.Fatalf("tool declaration split by page limit: %+v", records)
	}
	permit, e := f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID)
	if e != nil || permit.Kind != "execute" {
		t.Fatal("dispatch", e, permit.Kind)
	}
	yes := true
	tool, e := f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: commit.Calls[0], Observation: core.DispatchObservation{Status: "succeeded", Executed: &yes, Content: strings.Repeat("\x01", 64<<10)}})
	if e != nil || !tool.Result.Truncated {
		t.Fatal("encoded result truncation", e)
	}
	again, e := f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: commit.Calls[0], Observation: core.DispatchObservation{Status: "failed", Content: "must not replace"}})
	if e != nil || again.Result.Content != tool.Result.Content {
		t.Fatal("immutable result", e)
	}
	q, e := f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[1].ID)
	if e != nil || q.InteractionID == nil {
		t.Fatal("question admission", e)
	}
	view, e := f.Agents.GetInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID))
	if e != nil {
		t.Fatal(e)
	}
	answer := core.QuestionAnswer{Answers: []core.AnswerItem{{QuestionID: "q1", OptionIDs: []string{"yes"}}}}
	key := cryptox.ID()
	answered, e := f.Agents.AnswerInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID), view.Tag, key, answer)
	if e != nil || answered.Data.(map[string]any)["delivery"] != "tool_result" {
		t.Fatal("timely answer returned to tool", e, answered)
	}
	_, e = f.Agents.AnswerInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID), view.Tag, cryptox.ID(), answer)
	modelsExpectCode(t, e, "INTERACTION_ALREADY_ANSWERED")
	if repeated, e := f.Agents.AnswerInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID), view.Tag, key, answer); e != nil || !repeated.Replayed {
		t.Fatal("answer replay", e)
	}
	completion, e := f.Agents.LookupCompletion(f.Context, commit.Calls[1].ID)
	if e != nil || !strings.Contains(completion.Result.Content, `"status":"answered"`) {
		t.Fatal("timely answer missing from tool result", e)
	}
	if answered.Data.(map[string]any)["input_id"].(*core.ID) != nil {
		t.Fatal("timely answer created an input")
	}
	runtimeAttempt(t, f, x, 2, modelcore.Message{Role: "assistant", Content: "工具与答复完成"})
	runtimeEnd(t, f, x)

	x = runtimeClaim(t, f, session.Configuration.ID, "等待一个可以迟答的问题")
	commit = runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-late", Name: "ask_user_question", Arguments: runtimeQuestionArgs}}})
	q, e = f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID)
	if e != nil || q.InteractionID == nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.ConvergeDue(f.Context, time.Now().UTC().Add(6*time.Second), 100); e != nil {
		t.Fatal("timeout", e)
	}
	old, e := f.Agents.LookupCompletion(f.Context, commit.Calls[0].ID)
	if e != nil || old.Result.Status != "succeeded" {
		t.Fatal("timeout settled", e)
	}
	if _, e = f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Succeeded}); e != nil {
		t.Fatal(e)
	}
	view, e = f.Agents.GetInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID))
	if e != nil || view.Data.(a.InteractionView).Status != "continued" {
		t.Fatal("continued question", e)
	}
	late, e := f.Agents.AnswerInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID), view.Tag, cryptox.ID(), answer)
	if e != nil {
		t.Fatal("late answer", e)
	}
	inputID := *late.Data.(map[string]any)["input_id"].(*core.ID)
	claim, e := f.Agents.ClaimRoot(f.Context, core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(session.Configuration.ID), InputID: inputID}, Epoch: f.Agents.Epoch})
	if e != nil || !claim.Claimed || claim.Execution.Ref.RunID == x.Ref.RunID {
		t.Fatal("late answer starts new run", e)
	}
	unchanged, e := f.Agents.LookupCompletion(f.Context, commit.Calls[0].ID)
	if e != nil || unchanged.Result.Content != old.Result.Content {
		t.Fatal("late answer changed old result", e)
	}
	runtimeEnd(t, f, claim.Execution)
}

func runtimeApproval(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "请求一次性批准")
	commit := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-effect", Name: "effect", Arguments: `{}`}}})
	q, e := f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID)
	if e != nil || q.InteractionID == nil {
		t.Fatal("approval", e)
	}
	view, e := f.Agents.GetInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.DecideInteraction(f.Context, f.AdminToken, uint64(*q.InteractionID), view.Tag, cryptox.ID(), a.DecisionWrite{Decision: "approve_once"}); e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.WaitingInput}); e != nil {
		t.Fatal(e)
	}
	runtimeToolPolicies(t, f, agent, "deny")
	if _, e = f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID); e == nil {
		t.Fatal("approval revived old intent")
	}
	next := claimQueuedTurn(t, f, session.Configuration.ID, turnPendingResponse(t, f, *q.InteractionID))
	prepared, e := f.Agents.PrepareStep(f.Context, next, 1)
	if e != nil {
		t.Fatal(e)
	}
	for _, tool := range prepared.Tools {
		if tool.Key == "effect" {
			t.Fatal("approval bypassed current turn permission")
		}
	}
	runtimeEnd(t, f, next)
	runtimeToolPolicies(t, f, agent, "confirm")
}

func runtimeChildren(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	for _, interrupt := range []bool{false, true} {
		session := runtimeSession(t, f, agent)
		x := runtimeClaim(t, f, session.Configuration.ID, "委派独立分析")
		commit := runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: "call-child", Name: "delegate", Arguments: `{"task":"分析一个问题","file_refs":[]}`}}})
		permit, e := f.Agents.PrepareDispatch(f.Context, x.Ref, commit.Calls[0].ID)
		if e != nil || permit.Kind != "execute" {
			t.Fatal(e)
		}
		request := core.ChildRequest{Parent: commit.Calls[0], Content: []core.TextBlock{{Type: "text", Text: "分析一个问题"}}}
		child, e := f.Agents.CreateChild(f.Context, request)
		if e != nil || !child.Created || child.Execution.Principal != x.Principal || child.Execution.Ref.RootRunID != x.Ref.RunID {
			t.Fatal("child inheritance", e)
		}
		if duplicate, e := f.Agents.CreateChild(f.Context, request); e != nil || duplicate.Created {
			t.Fatal("child duplicate", e)
		}
		if interrupt {
			if _, e = f.Agents.Recover(f.Context, "replacement-process", 100); e != nil {
				t.Fatal("recover", e)
			}
			if _, e = f.Agents.PrepareStep(f.Context, child.Execution, 1); e == nil {
				t.Fatal("restarted child still executable")
			}
			result, e := f.Agents.LookupCompletion(f.Context, commit.Calls[0].ID)
			if e != nil || !strings.Contains(result.Result.Content, "interrupted") {
				t.Fatal("family recovery result", e)
			}
			continue
		}
		runtimeAttempt(t, f, child.Execution, 1, modelcore.Message{Role: "assistant", Content: "子任务证据已核实"})
		result, e := f.Agents.EndChild(f.Context, child.Execution.Ref, core.ChildEnd{End: core.RunEnd{Status: core.Succeeded}, Summary: "untrusted caller summary"})
		if e != nil || len(result.Receipt.Ranges) != 2 || !strings.Contains(result.Result.Content, "子任务证据已核实") || strings.Contains(result.Result.Content, "untrusted") {
			t.Fatal("atomic child settlement", e, result.Result.Content)
		}
		if duplicate, e := f.Agents.EndChild(f.Context, child.Execution.Ref, core.ChildEnd{End: core.RunEnd{Status: core.Succeeded}}); e != nil || duplicate.Result.Content != result.Result.Content {
			t.Fatal("child end replay", e)
		}
		runtimeAttempt(t, f, x, 2, modelcore.Message{Role: "assistant", Content: "完成父任务"})
		runtimeEnd(t, f, x)
	}
}

func runtimeStopQueue(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "正在执行的任务")
	pending, e := f.Agents.SubmitInput(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "保留的下一轮任务"}}})
	if e != nil {
		t.Fatal(e)
	}
	oldCommitted := f.Agents.Committed
	t.Cleanup(func() { f.Agents.Committed = oldCommitted })
	commits := []core.CommitReceipt{}
	f.Agents.Committed = func(_ context.Context, receipt core.CommitReceipt) { commits = append(commits, receipt) }
	key := cryptox.ID()
	stopped, e := f.Agents.StopRun(f.Context, f.AdminToken, uint64(x.Ref.RunID), key, a.StopRunWrite{})
	if e != nil || stopped.Status != 202 {
		t.Fatal("stop admission", e)
	}
	var queueSeq uint64
	if e = f.Store.db.GetContext(f.Context, &queueSeq, "SELECT seq FROM agent_event WHERE session_id=? AND event_type='input/cancelled'", session.Configuration.ID); e != nil {
		t.Fatal("stop omitted durable queue event", e)
	}
	covered := false
	for _, receipt := range commits {
		for _, eventRange := range receipt.Ranges {
			if uint64(eventRange.SessionID) == session.Configuration.ID && uint64(eventRange.From) <= queueSeq && uint64(eventRange.Through) >= queueSeq {
				covered = true
			}
		}
	}
	if !covered {
		t.Fatal("stop notification omitted queue event from committed range")
	}
	if _, e = f.Agents.StopRun(f.Context, f.AdminToken, uint64(x.Ref.RunID), key, a.StopRunWrite{}); e != nil {
		t.Fatal("stop replay", e)
	}
	var count int
	if e = f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_event WHERE session_id=? AND event_type='input/cancelled'", session.Configuration.ID); e != nil || count != 1 {
		t.Fatal("stop replay duplicated queue transition", e)
	}
	if _, e = f.Agents.EndRoot(f.Context, x.Ref, core.RunEnd{Status: core.Cancelled, Reason: "user_stopped"}); e != nil {
		t.Fatal(e)
	}
	input, e := f.Agents.GetInput(f.Context, f.AdminToken, session.Configuration.ID, pending.Data.(a.InputAccepted).InputID)
	if e != nil || input.Data.(a.InputView).State != "cancelled" {
		t.Fatal("stop left queued task executable", e)
	}
	terminal, e := f.Agents.StopRun(f.Context, f.AdminToken, uint64(x.Ref.RunID), cryptox.ID(), a.StopRunWrite{})
	if e != nil || terminal.Status != 200 {
		t.Fatal("terminal stop", e)
	}
	detail, e := f.Agents.GetSession(f.Context, f.AdminToken, session.Configuration.ID)
	if e != nil || detail.Data.(a.SessionDetail).State.QueuePaused {
		t.Fatal("old terminal run paused resumed queue", e)
	}
	// End this fixture with its pending input cancelled, without dispatching it.
	configuration, e := f.Agents.GetSessionConfiguration(f.Context, f.AdminToken, session.Configuration.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.ArchiveSession(f.Context, f.AdminToken, session.Configuration.ID, configuration.Tag, cryptox.ID()); e != nil {
		t.Fatal(e)
	}
}

func runtimeUncommittedModel(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	x := runtimeClaim(t, f, session.Configuration.ID, "模型结果提交失败后不得重发")
	step, e := f.Agents.PrepareStep(f.Context, x, 1)
	if e != nil {
		t.Fatal(e)
	}
	hash, e := core.ContentHash(step.Request)
	if e != nil {
		t.Fatal(e)
	}
	call, e := f.Agents.FreezeAttempt(f.Context, x.Ref, core.AttemptDraft{Step: step, Attempt: 1, Purpose: "generation", RequestHash: hash, Deadline: core.BoundedDeadline(time.Now().UTC(), 30, x.Deadline), Reservation: core.Budget{ModelCalls: 1, InputTokens: 100, OutputTokens: 100}})
	if e != nil {
		t.Fatal(e)
	}
	// This is the durable state left when external IO finished but its result
	// transaction never committed. Advancing the stored deadline avoids sleeps.
	if _, e = f.Store.db.ExecContext(f.Context, "UPDATE agent_model_call SET deadline_at=? WHERE id=?", time.Now().UTC().Add(-time.Minute), uint64(call.Permit.CallID)); e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.ConvergeDue(f.Context, time.Now().UTC(), 100); e != nil {
		t.Fatal(e)
	}
	var status string
	if e = f.Store.db.GetContext(f.Context, &status, "SELECT status FROM agent_run WHERE id=?", uint64(x.Ref.RunID)); e != nil || status != "interrupted" {
		t.Fatal("current-epoch orphan was not closed", status, e)
	}
	_, e = f.Agents.CompleteAttempt(f.Context, x.Ref, core.AttemptResult{Permit: call.Permit, Outcome: core.AttemptOutcome{Response: modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: "late result must not replace history"}}}})
	if e == nil {
		t.Fatal("late model callback bypassed execution fence")
	}
	var count int
	if e = f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_model_call WHERE run_id=?", uint64(x.Ref.RunID)); e != nil || count != 1 {
		t.Fatal("recovery replayed external model call", e)
	}
}

type archiveOnRead struct {
	reader io.Reader
	first  func()
	called bool
}

func (r *archiveOnRead) Read(p []byte) (int, error) {
	if !r.called {
		r.called = true
		r.first()
	}
	return r.reader.Read(p)
}

func runtimeFiles(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	session := runtimeSession(t, f, agent)
	key := cryptox.ID()
	upload, e := f.Agents.UploadAttachment(f.Context, f.AdminToken, session.Configuration.ID, key, "notes.txt", strings.NewReader("durable attachment"))
	if e != nil {
		t.Fatal("upload", e)
	}
	attachment := upload.Data.(a.AttachmentView)
	if replay, e := f.Agents.UploadAttachment(f.Context, f.AdminToken, session.Configuration.ID, key, "notes.txt", strings.NewReader("durable attachment")); e != nil || !replay.Replayed {
		t.Fatal("upload replay", e)
	}
	read, e := f.Agents.GetFileContent(f.Context, f.AdminToken, attachment.FileID)
	if e != nil {
		t.Fatal("download", e)
	}
	stream := read.Data.(*a.FileContent)
	t.Cleanup(func() { _ = stream.Reader.Close() })
	_, e = f.Agents.DeleteAttachment(f.Context, f.AdminToken, session.Configuration.ID, attachment.ID, upload.Tag, cryptox.ID())
	modelsExpectCode(t, e, "FILE_IN_USE")
	data, e := io.ReadAll(stream.Reader)
	if e != nil || string(data) != "durable attachment" {
		t.Fatal("attachment bytes", e)
	}
	if e = stream.Reader.Close(); e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.DeleteAttachment(f.Context, f.AdminToken, session.Configuration.ID, attachment.ID, upload.Tag, cryptox.ID()); e != nil {
		t.Fatal("lease not released", e)
	}
	if e = f.Agents.ProcessFileMaintenance(f.Context, 100); e != nil {
		t.Fatal(e)
	}
	var state string
	if e = f.Store.db.GetContext(f.Context, &state, "SELECT state FROM agent_file WHERE id=?", attachment.FileID); e != nil || state != "deleted" {
		t.Fatal("orphan bytes not reclaimed", state, e)
	}
	tracing := runtimeSession(t, f, agent)
	reader := &archiveOnRead{reader: strings.NewReader("must not attach after archive"), first: func() {
		configuration, e := f.Agents.GetSessionConfiguration(f.Context, f.AdminToken, tracing.Configuration.ID)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.Agents.ArchiveSession(f.Context, f.AdminToken, tracing.Configuration.ID, configuration.Tag, cryptox.ID()); e != nil {
			t.Fatal(e)
		}
	}}
	_, e = f.Agents.UploadAttachment(f.Context, f.AdminToken, tracing.Configuration.ID, cryptox.ID(), "raced.txt", reader)
	modelsExpectCode(t, e, "SESSION_ARCHIVED")
	var count int
	if e = f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_attachment WHERE content_session_id=?", tracing.Configuration.ID); e != nil || count != 0 {
		t.Fatal("archive/upload race published attachment", e)
	}
}

type runtimeSummaryModel struct {
	text    string
	calls   int
	request modelcore.Request
}

func (m *runtimeSummaryModel) Open(context.Context, core.LockedModel) (modelcore.Client, error) {
	return m, nil
}
func (m *runtimeSummaryModel) Generate(_ context.Context, request modelcore.Request, _ modelcore.Emit) (modelcore.Response, error) {
	m.calls++
	m.request = request
	in, out := int64(30), int64(3)
	return modelcore.Response{Message: modelcore.Message{Role: "assistant", Content: m.text}, Usage: modelcore.Usage{InputTokens: &in, OutputTokens: &out, RawNumericFields: map[string]int64{"prompt_tokens": 30}}}, nil
}

type runtimeTokenCounter struct{}

func (runtimeTokenCounter) Count(request modelcore.Request) (uint64, error) {
	var n uint64
	for _, m := range request.Messages {
		n += uint64(len(m.Content))
	}
	return n, nil
}

func runtimeCompaction(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	svc := f.Agents
	oldModels, oldCounter, oldCompactor := svc.RuntimeModels, svc.Tokens, svc.Compactor
	t.Cleanup(func() { svc.RuntimeModels, svc.Tokens, svc.Compactor = oldModels, oldCounter, oldCompactor })
	model := &runtimeSummaryModel{text: "先前已核实基础配置；保留当前任务。"}
	svc.RuntimeModels = model
	svc.Tokens = runtimeTokenCounter{}
	svc.Compactor = &core.Compactor{Store: svc, Models: svc, Tokens: runtimeTokenCounter{}}
	for _, kind := range []string{"success", "invalid", "restarted"} {
		session := runtimeSession(t, f, agent)
		for i := 0; i < 3; i++ {
			x := runtimeClaim(t, f, session.Configuration.ID, strings.Repeat("完整历史证据", 100))
			runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", Content: strings.Repeat("已经检查并确认。", 100)})
			runtimeEnd(t, f, x)
		}
		accepted, e := svc.CompactSession(f.Context, f.AdminToken, session.Configuration.ID, cryptox.ID())
		if e != nil {
			t.Fatal("compact admission", kind, e)
		}
		opID := uint64(accepted.Data.(map[string]any)["id"].(core.ID))
		var revision uint64
		if e = f.Store.db.GetContext(f.Context, &revision, "SELECT surface_revision FROM agent_session WHERE id=?", session.Configuration.ID); e != nil {
			t.Fatal(e)
		}
		beforeCalls := model.calls
		model.text = "摘要：历史证据已核实。"
		if kind == "invalid" {
			model.text = ""
		}
		if kind == "restarted" {
			if _, e = f.Store.db.ExecContext(f.Context, "UPDATE agent_compaction SET status='running', executor_epoch='old-process' WHERE public_operation_id=?", opID); e != nil {
				t.Fatal(e)
			}
		}
		if e = svc.ProcessPendingCompactions(f.Context, 100); e != nil {
			t.Fatal("compaction worker", kind, e)
		}
		op, e := svc.GetOperation(f.Context, f.AdminToken, opID)
		if e != nil {
			t.Fatal(e)
		}
		status := op.Data.(map[string]any)["status"].(string)
		want := map[string]string{"success": "succeeded", "invalid": "failed", "restarted": "interrupted"}[kind]
		if status != want {
			public, _ := json.Marshal(op.Data)
			t.Fatal("compaction result", kind, string(public))
		}
		var active *uint64
		if e = f.Store.db.GetContext(f.Context, &active, "SELECT active_compaction_id FROM agent_session WHERE id=?", session.Configuration.ID); e != nil || active != nil {
			t.Fatal("maintenance slot leaked", e)
		}
		var after uint64
		if e = f.Store.db.GetContext(f.Context, &after, "SELECT surface_revision FROM agent_session WHERE id=?", session.Configuration.ID); e != nil {
			t.Fatal(e)
		}
		if kind == "success" {
			if after <= revision || len(model.request.Tools) == 0 || model.request.Messages[0].Role != "system" {
				t.Fatal("summary did not retain head/tools or replace surface")
			}
			var persisted string
			if e = f.Store.db.GetContext(f.Context, &persisted, "SELECT request_config FROM agent_model_call WHERE session_id=? AND purpose='compaction'", session.Configuration.ID); e != nil {
				t.Fatal(e)
			}
			var snapshot struct {
				System []modelcore.Message `json:"system"`
				Suffix []modelcore.Message `json:"suffix"`
				Tools  []modelcore.Tool    `json:"model_tools"`
			}
			if e = json.Unmarshal([]byte(persisted), &snapshot); e != nil || len(snapshot.System) == 0 || len(snapshot.Suffix) != 1 || len(snapshot.Tools) != len(model.request.Tools) {
				t.Fatal("persisted summary omitted deterministic prompt/tools", e)
			}
			x := runtimeClaim(t, f, session.Configuration.ID, "继续检查摘要后的上下文")
			prepared, e := svc.PrepareStep(f.Context, x, 1)
			if e != nil {
				t.Fatal("surface after replacement", e)
			}
			encoded, _ := json.Marshal(prepared.Request.Messages)
			if !strings.Contains(string(encoded), "摘要：历史证据已核实") {
				t.Fatal("summary absent from next model input")
			}
			runtimeEnd(t, f, x)
		} else if after != revision {
			t.Fatal("failed compaction replaced history")
		}
		if kind == "restarted" && model.calls != beforeCalls {
			t.Fatal("recovery reissued summary model request")
		}
	}
	// Automatic compaction uses the same real transaction ports but keeps the
	// running root and its shared budget, then rebuilds this step exactly once.
	svc.Tokens = nil
	model.text = "自动摘要：早期证据已核实，继续最新任务。"
	session := runtimeSession(t, f, agent)
	for i := 0; i < 3; i++ {
		x := runtimeClaim(t, f, session.Configuration.ID, strings.Repeat("早期证据", 600))
		runtimeAttempt(t, f, x, 1, modelcore.Message{Role: "assistant", Content: strings.Repeat("已完成验证", 600)})
		runtimeEnd(t, f, x)
	}
	svc.Tokens = runtimeTokenCounter{}
	x := runtimeClaim(t, f, session.Configuration.ID, "当前任务必须保留并在压缩后继续")
	step, e := svc.PrepareStep(f.Context, x, 1)
	if e != nil {
		t.Fatal("automatic compaction", e)
	}
	var compacted int
	if e = f.Store.db.GetContext(f.Context, &compacted, "SELECT COUNT(*) FROM agent_compaction WHERE run_id=? AND status='completed'", uint64(x.Ref.RunID)); e != nil || compacted != 1 {
		t.Fatal("automatic replacement not committed", e, compacted)
	}
	content, _ := json.Marshal(step.Request.Messages)
	if !strings.Contains(string(content), "自动摘要") || !strings.Contains(string(content), "当前任务必须保留") {
		t.Fatal("automatic compression lost current task or summary")
	}
	var modelCalls int
	if e = f.Store.db.GetContext(f.Context, &modelCalls, "SELECT COUNT(*) FROM agent_model_call WHERE root_run_id=? AND purpose='compaction'", uint64(x.Ref.RunID)); e != nil || modelCalls != 1 {
		t.Fatal("automatic compaction budget attempt missing", e)
	}
	runtimeEnd(t, f, x)
}

func runtimeDebug(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	current, e := f.Agents.GetDefinition(f.Context, f.AdminToken, agent)
	if e != nil {
		t.Fatal(e)
	}
	options, e := f.Agents.StartOptions(f.Context, f.AdminToken, agent)
	if e != nil {
		t.Fatal(e)
	}
	hash := options.Data.(a.StartOptions).Models[0].Thinking[0].Hash
	w := a.DebugStart{Input: a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "调试一个完整输入"}}, ExpectedHash: hash}}
	key := cryptox.ID()
	r, e := f.Agents.DebugRun(f.Context, f.AdminToken, agent, current.Tag, key, w)
	if e != nil {
		t.Fatal("debug", e)
	}
	session := r.Data.(map[string]any)["session_id"].(core.ID)
	if repeated, e := f.Agents.DebugRun(f.Context, f.AdminToken, agent, current.Tag, key, w); e != nil || !repeated.Replayed {
		t.Fatal("debug replay", e)
	}
	var before int
	if e = f.Store.db.GetContext(f.Context, &before, "SELECT COUNT(*) FROM agent_session WHERE agent_id=?", agent); e != nil {
		t.Fatal(e)
	}
	w.Input.ExpectedHash = "invalid-selection"
	if _, e = f.Agents.DebugRun(f.Context, f.AdminToken, agent, current.Tag, cryptox.ID(), w); e == nil {
		t.Fatal("debug accepted stale model")
	}
	var after int
	if e = f.Store.db.GetContext(f.Context, &after, "SELECT COUNT(*) FROM agent_session WHERE agent_id=?", agent); e != nil || before != after {
		t.Fatal("failed debug left an empty session", e)
	}
	configuration, e := f.Agents.GetSessionConfiguration(f.Context, f.AdminToken, uint64(session))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.ArchiveSession(f.Context, f.AdminToken, uint64(session), configuration.Tag, cryptox.ID()); e != nil {
		t.Fatal(e)
	}
}
