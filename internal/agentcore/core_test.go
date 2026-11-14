package agentcore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func policy() Policy {
	return Policy{MaxSteps: 8, MaxModelCalls: 20, MaxToolCalls: 20, MaxChildren: 2, MaxParallelTools: 2, RunTimeoutSeconds: 120, QueueTimeoutSeconds: 120, QuestionTimeoutSeconds: 5, ApprovalTimeoutSeconds: 15, MaxInputTokens: 10000, MaxOutputTokens: 10000, ApprovalPolicy: "ask"}
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != want {
		t.Fatalf("error=%v want %s", err, want)
	}
}
func pointer[T any](v T) *T { return &v }

func TestIDsAreLosslessStrings(t *testing.T) {
	v := struct {
		ID      ID      `json:"id"`
		Seq     Seq     `json:"seq"`
		Version Version `json:"version"`
	}{ID: ^ID(0), Seq: 9007199254740993, Version: 4}
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"id":"18446744073709551615","seq":"9007199254740993","version":"4"}` {
		t.Fatal(string(b))
	}
	var id ID
	for _, raw := range []string{`1`, `"01"`, `"-1"`, `"18446744073709551616"`, `null`} {
		if json.Unmarshal([]byte(raw), &id) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestAdmissionLocksOnlyValidFirstInputAndDoesNotResetDeadline(t *testing.T) {
	now := time.Now().UTC()
	s := Session{ID: 1, AgentID: 2, Version: 1, NextInputOrder: 1}
	state := AdmissionState{Session: s, Policy: policy(), Candidate: LockedModel{SelectionHash: "hash"}}
	cmd := AdmissionCommand{InputID: 3, Origin: "human", Content: []TextBlock{{Type: "text", Text: "hello"}}, ExpectedModelHash: "stale"}
	_, err := PlanAdmission(state, cmd, now)
	code(t, err, "MODEL_SELECTION_CHANGED")
	cmd.ExpectedModelHash = "hash"
	cmd.Content = nil
	_, err = PlanAdmission(state, cmd, now)
	code(t, err, "VALIDATION_FAILED")
	if s.ModelLockedAt != nil {
		t.Fatal("failed admission mutated session")
	}
	cmd.Content = []TextBlock{{Type: "text", Text: "hello"}}
	plan, err := PlanAdmission(state, cmd, now)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Session.Version != 2 || plan.Session.ModelLockedAt == nil || len(plan.Events) != 2 || plan.Input.AcceptedSeq != 2 {
		t.Fatalf("bad plan %+v", plan)
	}
	deadline := plan.Input.QueueDeadline
	claim, err := PlanClaim(plan.Session, plan.Input, 4, "epoch", policy(), now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if !claim.Input.QueueDeadline.Equal(deadline) || claim.Run.Deadline.Sub(now.Add(time.Second)) != 120*time.Second {
		t.Fatal("deadline changed incorrectly")
	}
	state.Session = plan.Session
	state.Candidate.SelectionHash = "changed"
	cmd.InputID = 5
	cmd.ExpectedModelHash = ""
	next, err := PlanAdmission(state, cmd, now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Session.Model.SelectionHash != "hash" || next.Session.Version != 2 {
		t.Fatal("locked model changed")
	}
}

func TestArchiveCancelsLateAnswerWithoutRevivingOnRestore(t *testing.T) {
	now := time.Now()
	s := Session{ID: 1, Version: 2}
	input := Input{ID: 10, SessionID: 1, State: "pending", Version: 1}
	i := Interaction{ID: 3, SessionID: 1, Kind: "question", Status: "reply_queued", PendingReplyInputID: pointer(ID(10)), Version: 2}
	plan, err := PlanArchive(s, 2, []Input{input}, []Interaction{i}, now)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Inputs[0].State != "cancelled" || plan.Interactions[0].Status != "cancelled" || !plan.Session.QueuePaused {
		t.Fatal("archive left pending work")
	}
	i = CancelPendingReply(plan.Session, plan.Interactions[0], 10, false)
	if i.Status != "cancelled" {
		t.Fatal("late cancellation reopened archived question")
	}
	restored, err := PlanRestore(plan.Session, 3)
	if err != nil {
		t.Fatal(err)
	}
	if restored.QueuePaused || restored.ActiveRunID != nil || restored.ArchivedAt != nil {
		t.Fatal("restore started work")
	}
	active := s
	active.ActiveCompactionID = pointer(ID(9))
	_, err = PlanArchive(active, 2, nil, nil, now)
	code(t, err, "SESSION_NOT_IDLE")
}

func TestQuestionTimeoutVersusApprovalAndLateReply(t *testing.T) {
	now := time.Now()
	s := Session{ID: 1, ExecutionMode: "interactive", ActiveRunID: pointer(ID(2))}
	q := Interaction{ID: 3, SessionID: 1, RunID: 2, Kind: "question", Status: "waiting", Version: 1, Deadline: now, Questions: []Question{{ID: "q", Prompt: "Details?", Type: "text"}}}
	answer := QuestionAnswer{Answers: []AnswerItem{{QuestionID: "q", Text: pointer("details")}}}
	late, err := PlanAnswer(s, q, 1, ActorRef{Kind: "user", ID: pointer(ID(4))}, answer, 5, now)
	if err != nil {
		t.Fatal(err)
	}
	if !late.SettleTool || late.Interaction.Status != "reply_queued" || late.Delivery != "next_step" {
		t.Fatalf("late=%+v", late)
	}
	_, err = PlanAnswer(s, late.Interaction, 2, ActorRef{}, answer, 6, now)
	code(t, err, "INTERACTION_ALREADY_ANSWERED")
	q.Kind = "approval"
	q.Status = "pending"
	expired, err := PlanInteractionExpiry(q, now)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Interaction.Status != "expired" || expired.Executed == nil || *expired.Executed {
		t.Fatal("expired approval executed")
	}
	_, err = PlanDecision(s, q, 1, ActorRef{}, true, now)
	code(t, err, "APPROVAL_EXPIRED")
	q.Kind = "question"
	q.Status = "waiting"
	s.ActiveRunID = nil
	late, err = PlanAnswer(s, q, 1, ActorRef{}, answer, 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if late.Delivery != "next_turn" {
		t.Fatal("idle late answer targets step")
	}
}

func TestStopOldTerminalAndBudgetUnknown(t *testing.T) {
	s := Session{ID: 1, ActiveRunID: pointer(ID(22))}
	r := Run{Ref: ExecutionRef{SessionID: 1, RunID: 2}, Status: Succeeded}
	p, err := PlanStop(s, r, time.Now(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if p.Changed || p.Session.QueuePaused {
		t.Fatal("old stop paused new run")
	}
	b := BudgetLedger{Limit: Budget{ModelCalls: 2, InputTokens: 10}}
	b, reservation, err := b.Reserve(Budget{ModelCalls: 1, InputTokens: 8})
	if err != nil {
		t.Fatal(err)
	}
	unknown, _, err := b.Settle(reservation, nil)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.Reserved.InputTokens != 8 {
		t.Fatal("unknown reservation released")
	}
	_, _, err = unknown.Reserve(Budget{ModelCalls: 1, InputTokens: 3})
	code(t, err, "BUDGET_EXCEEDED")
	actual := Budget{ModelCalls: 1, InputTokens: 11}
	b, reservation, err = b.Settle(reservation, &actual)
	if err != nil {
		t.Fatal(err)
	}
	again, _, err := b.Settle(reservation, &actual)
	if err != nil || again.Used.InputTokens != 11 {
		t.Fatal("double settlement")
	}
	_, _, err = b.Reserve(Budget{ModelCalls: 1})
	code(t, err, "BUDGET_EXCEEDED")
}

func TestSurfaceKeepsNativeAndOrdersToolResults(t *testing.T) {
	native := json.RawMessage(`{"role":"assistant","reasoning_content":"opaque","content":null}`)
	assistant := modelcore.Message{Role: "assistant", NativeProtocol: modelcore.ChatCompletions, Native: native, ToolCalls: []modelcore.ToolCall{{ID: "a", Name: "read", Arguments: `{}`}, {ID: "b", Name: "read", Arguments: `{}`}}}
	a := modelcore.Message{Role: "tool", ToolCallID: "a", Content: "first"}
	b := modelcore.Message{Role: "tool", ToolCallID: "b", Content: "second"}
	facts := map[Seq]HistoryFact{1: {Seq: 1, SchemaVersion: 1, Kind: "assistant/message", Message: &assistant, ModelCallID: 10}, 2: {Seq: 2, SchemaVersion: 1, Kind: "tool/result", Message: &b, ToolCallID: "b", Ordinal: 1, ModelCallID: 10}, 3: {Seq: 3, SchemaVersion: 1, Kind: "tool/result", Message: &a, ToolCallID: "a", Ordinal: 0, ModelCallID: 10}}
	manifest := SurfaceManifest{SchemaVersion: 1, Revision: 1, Entries: []SurfaceEntry{{Kind: "tool_group", Sequences: []Seq{1, 2, 3}}}}
	messages, err := BuildSurface(manifest, facts)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(messages[0].Native, native) || messages[1].ToolCallID != "a" || messages[2].ToolCallID != "b" {
		t.Fatal("surface rewrote history")
	}
	delete(facts, 3)
	_, err = BuildSurface(manifest, facts)
	code(t, err, "SURFACE_INVALID")
	contextFact, err := SkillContext(SkillDirectory{Complete: true, Entries: []SkillEntry{{Name: "z", Description: "Z", Integrity: "verified"}, {Name: "a", Description: "A", Integrity: "verified"}}}, true)
	if err != nil {
		t.Fatal(err)
	}
	changed, _ := ChangedContext([]ContextFact{contextFact}, contextFact)
	if changed {
		t.Fatal("same directory appended")
	}
	changed, _ = ChangedContext(nil, contextFact)
	if !changed {
		t.Fatal("hidden directory not restored")
	}
	_, err = SkillContext(SkillDirectory{}, true)
	code(t, err, "SKILL_DIRECTORY_UNAVAILABLE")
}

func TestChildInheritsIdentityAndCannotDelegateAgain(t *testing.T) {
	now := time.Now()
	s := Session{ID: 1, AgentID: 3, Model: &LockedModel{SelectionHash: "model"}, ModelLockedAt: &now, Principal: PrincipalRef{Kind: "service_agent", ID: 3}}
	r := Run{Ref: ExecutionRef{SessionID: 1, RunID: 2, RootRunID: 2, Epoch: "epoch", Fence: 1}, Status: Running, Deadline: now.Add(time.Minute), Policy: policy(), Budget: BudgetLedger{Limit: LimitFromPolicy(policy())}, Principal: s.Principal}
	req := ChildRequest{Parent: PreparedToolCall{ID: 9, Ref: r.Ref}, SessionID: 4, RunID: 5, Content: []TextBlock{{Type: "text", Text: "investigate"}}}
	p, err := PlanChild(s, r, req, now)
	if err != nil {
		t.Fatal(err)
	}
	if p.Session.Principal != s.Principal || p.Run.Ref.RootRunID != 2 || !p.Run.Deadline.Equal(r.Deadline) || p.Session.Model.SelectionHash != "model" {
		t.Fatal("child changed execution authority")
	}
	req.Parent.Ref = p.Run.Ref
	_, err = PlanChild(p.Session, p.Run, req, now)
	code(t, err, "CHILD_DEPTH_EXCEEDED")
}

func TestToolBatchSerialBarrierAndCancelledWait(t *testing.T) {
	calls := []PreparedToolCall{}
	for n, safe := range []bool{true, true, false, true} {
		calls = append(calls, PreparedToolCall{ID: ID(n + 1), Ordinal: uint32(n), Call: modelcore.ToolCall{ID: string(rune('a' + n)), Name: "tool", Arguments: `{}`}, Spec: ToolSpec{ParallelSafe: safe}})
	}
	b, err := NewToolBatch(calls, 2)
	if err != nil {
		t.Fatal(err)
	}
	_, releaseA, err := b.Acquire(t.Context(), "a", "tool", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	_, releaseB, err := b.Acquire(t.Context(), "b", "tool", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, _, err = b.Acquire(ctx, "c", "tool", `{}`)
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	releaseA()
	releaseB()
	_, releaseC, err := b.Acquire(t.Context(), "c", "tool", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, release, err := b.Acquire(t.Context(), "d", "tool", `{}`)
		if err == nil {
			release()
		}
		result <- err
	}()
	select {
	case <-result:
		t.Fatal("crossed serial barrier")
	case <-time.After(10 * time.Millisecond):
	}
	releaseC()
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	_, _, err = b.Acquire(t.Context(), "a", "tool", `{}`)
	code(t, err, "TOOL_ALREADY_DISPATCHED")
}

func TestStreamSnapshotResumeAndOverflow(t *testing.T) {
	h := NewHub("epoch")
	permit := AttemptPermit{Ref: ExecutionRef{SessionID: 1, RunID: 2, Epoch: "epoch"}, CallID: 3, Step: 1}
	sub, baseline := h.Subscribe(1)
	defer sub.Close()
	if baseline.Revision != 0 {
		t.Fatal("unexpected stream")
	}
	if err := h.Start(permit); err != nil {
		t.Fatal(err)
	}
	if err := h.Emit(t.Context(), permit, modelcore.Delta{Kind: "tool_call", BlockIndex: 5, DraftCallID: "draft", Text: `{"a":`}); err != nil {
		t.Fatal(err)
	}
	_, snapshot := h.Subscribe(1)
	if snapshot.Active.Content[0].Name != nil || snapshot.Active.Content[0].ArgumentsText != `{"a":` {
		t.Fatal("bad partial tool snapshot")
	}
	raw, _ := json.Marshal(snapshot.Active.Content)
	if !strings.Contains(string(raw), `"name":null`) {
		t.Fatal(string(raw))
	}
	if err := h.Emit(t.Context(), permit, modelcore.Delta{Kind: "tool_call", BlockIndex: 5, DraftCallID: "draft", Name: "read", Text: `1}`}); err != nil {
		t.Fatal(err)
	}
	err := h.Emit(t.Context(), permit, modelcore.Delta{Kind: "tool_call", BlockIndex: 5, DraftCallID: "draft", Name: "write"})
	code(t, err, "STREAM_INVALID")
	n, _ := sub.Next(t.Context())
	if n.Stream.Index != 0 || n.Stream.Revision != 1 {
		t.Fatal("bad start")
	}
	n, _ = sub.Next(t.Context())
	if n.Stream.Delta.BlockIndex != 0 {
		t.Fatal("provider block index leaked")
	}
	seq := Seq(9)
	if err = h.End(permit, StreamOutcome{Kind: "committed", EventSeq: &seq}); err != nil {
		t.Fatal(err)
	}
	baseline = sub.Resync()
	if baseline.Active != nil || baseline.Revision != 4 {
		t.Fatalf("snapshot %+v", baseline)
	}
	h.maxNotices = 1
	h.Committed(t.Context(), CommitReceipt{Ranges: []EventRange{{SessionID: 1, From: 9, Through: 9}}})
	h.Committed(t.Context(), CommitReceipt{Ranges: []EventRange{{SessionID: 1, From: 10, Through: 10}}})
	n, _ = sub.Next(t.Context())
	if n.ResyncReason != "buffer_overflow" {
		t.Fatal("did not pause slow subscriber")
	}
}

func TestSnapshotShrinksWithoutSplittingGroup(t *testing.T) {
	groups := []HistoryGroup{{Records: []Event{{Seq: 1, Data: json.RawMessage(`{}`)}, {Seq: 2, Data: json.RawMessage(`{}`)}}}}
	selection, err := TrimSnapshotHistory(groups, 8, func(s HistorySelection) ([]byte, error) {
		size := 2 << 20
		if len(s.Records) > 0 {
			size++
		}
		return make([]byte, size), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(selection.Records) != 0 || !selection.HasMore || selection.Before == nil || *selection.Before != 9 {
		t.Fatal("zero-history backfill cursor lost")
	}
	_, err = SelectHistory(groups, 8, pointer(Seq(2)), 100, MaxHistoryBytes)
	code(t, err, "HISTORY_GROUP_BOUNDARY")
}

func TestEmptyStreamDeltasRetainRequiredPublicFields(t *testing.T) {
	for _, kind := range []string{"text_delta", "reasoning_delta", "tool_call_delta"} {
		raw, e := json.Marshal(StreamDelta{Type: kind, DraftCallID: "draft-0"})
		if e != nil {
			t.Fatal(e)
		}
		var object map[string]any
		if e = json.Unmarshal(raw, &object); e != nil {
			t.Fatal(e)
		}
		key := "text"
		if kind == "tool_call_delta" {
			key = "arguments_fragment"
		}
		if value, present := object[key]; !present || value != "" {
			t.Fatalf("required empty field omitted: %s", raw)
		}
		if kind != "tool_call_delta" {
			if _, exists := object["draft_call_id"]; exists {
				t.Fatal("wrong delta variant")
			}
		}
	}
}
