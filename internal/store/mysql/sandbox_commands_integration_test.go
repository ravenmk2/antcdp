package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"sandbox_commands", sandboxCommandsIntegration})
}

type commandMemoryProvider struct {
	*sandboxMemoryProvider
	executions        map[string]sb.ExecResult
	launches, cancels int
	outputReads       int
	unknownNext       bool
	afterStarted      func(sb.ExecutionHandle)
}

func (p *commandMemoryProvider) Exec(ctx context.Context, ref sb.ResourceRef, spec sb.ExecSpec, callbacks sb.ExecCallbacks) (sb.ExecResult, error) {
	p.launches++
	if p.unknownNext {
		p.unknownNext = false
		return sb.ExecResult{}, &sb.Error{Code: "SANDBOX_TRANSPORT_UNKNOWN", Unknown: true}
	}
	if spec.UID == nil || spec.GID == nil || *spec.UID != 10001 || *spec.GID != 10001 {
		return sb.ExecResult{}, fmt.Errorf("workload identity missing")
	}
	h := sb.ExecutionHandle{Resource: ref, ID: fmt.Sprintf("command-%d", p.launches)}
	if err := callbacks.Started(ctx, h); err != nil {
		return sb.ExecResult{Handle: &h}, err
	}
	if p.afterStarted != nil {
		p.afterStarted(h)
	}
	result := sb.ExecResult{Handle: &h, Running: true}
	p.executions[h.ID] = result
	return result, nil
}
func (p *commandMemoryProvider) InspectExecution(_ context.Context, h sb.ExecutionHandle) (sb.ExecResult, error) {
	result, ok := p.executions[h.ID]
	if !ok {
		return sb.ExecResult{}, &sb.Error{Code: "SANDBOX_EXECUTION_UNCONFIRMED", Unknown: true}
	}
	return result, nil
}
func (p *commandMemoryProvider) CancelExecution(context.Context, sb.ExecutionHandle) error {
	p.cancels++
	return nil // acceptance deliberately does not change the observed process state
}
func (p *commandMemoryProvider) ReadExecutionOutput(_ context.Context, _ sb.ExecutionHandle, cursor int64, maxBytes int) (sb.ExecutionOutput, error) {
	p.outputReads++
	const output = "first\nsecond\n"
	start := min(cursor, int64(len(output)))
	end := min(start+int64(maxBytes), int64(len(output)))
	return sb.ExecutionOutput{Text: output[start:end], Cursor: end, Truncated: end < int64(len(output))}, nil
}

type commandMemoryFactory struct{ provider *commandMemoryProvider }

func (f commandMemoryFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

func sandboxCommandsIntegration(t *testing.T, f *agentIntegrationFixture) {
	ctx, host := f.Context, f.Agents
	oldCatalog, oldEpoch, oldSandboxes := host.Catalog, host.Epoch, host.Sandboxes
	t.Cleanup(func() { host.Catalog, host.Epoch, host.Sandboxes = oldCatalog, oldEpoch, oldSandboxes })
	host.Epoch = "sandbox-command-test"
	host.Catalog = a.ResourceCatalog{Tool: func(_ context.Context, _ identity.Tx, key string) (*a.ToolDescriptor, error) {
		return &a.ToolDescriptor{Key: key, Name: key, Source: a.ToolSource{Kind: "builtin"}, ExecutionClass: "sandbox", RequiresSandbox: true, ParallelSafe: true, SupportedPolicies: []string{"allow", "deny", "confirm"}, Availability: a.Availability{Available: true}, Definition: modelcore.Tool{Name: key, Description: "Controlled command fixture", InputSchema: json.RawMessage(`{"type":"object"}`)}}, nil
	}, AuthorizeTool: func(context.Context, identity.Tx, core.ExecutionContext, a.ToolDescriptor, json.RawMessage, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{"authorized":true}`), nil
	}}
	remote := &commandMemoryProvider{sandboxMemoryProvider: &sandboxMemoryProvider{resources: map[string]sb.Observation{}}, executions: map[string]sb.ExecResult{}}
	svc := &a.CloudService{Host: host, Epoch: host.Epoch, InstallationID: func() (string, error) { return f.Installation, nil }, Factory: commandMemoryFactory{remote}, Cipher: f.Models.Cipher,
		PrepareWorkspace: func(context.Context, *a.SandboxAccess, uint64, uint64) error { return nil },
		VerifyEnvironment: func(context.Context, *a.SandboxAccess) (a.SandboxCapabilities, []a.DiagnosticCheck, error) {
			return a.SandboxCapabilities{Execution: "supported"}, []a.DiagnosticCheck{{Name: "controlled_test_fixture", Status: "succeeded"}}, nil
		}}
	svc.EndpointTargets = func(string) ([]string, error) { return []string{"192.0.2.18"}, nil }
	host.Sandboxes = svc
	configureTestCloud(t, f, svc)
	var e error
	agent := sandboxServiceAgent(t, f, "per_run")
	commandSetPolicies(t, f, agent.ID, "allow")
	x := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "background process lifecycle")
	binding, e := svc.Acquire(ctx, x)
	if e != nil || binding == nil {
		t.Fatal("acquire command binding", e)
	}
	if _, e = host.ActivateBinding(ctx, x.Ref, *binding); e != nil {
		t.Fatal(e)
	}
	x.Binding = binding
	request := a.CommandRequest{Command: "printf background", Background: true, TimeoutSeconds: 60, MaxOutputBytes: 4096}
	args, _ := json.Marshal(request)
	call := commandDeclare(t, f, x, 1, "exec_command", string(args))
	remote.afterStarted = func(h sb.ExecutionHandle) {
		var persisted string
		if e := f.Store.db.GetContext(ctx, &persisted, "SELECT remote_execution_id FROM cloud_computer_execution WHERE tool_call_id=?", uint64(call.ID)); e != nil || persisted != h.ID {
			t.Fatal("execution ID not durable before output", e)
		}
	}
	launched, e := svc.ExecuteCommand(ctx, x.Ref, uint64(call.ID), request)
	if e != nil || launched.Execution.State != "running" || launched.Executed == nil || !*launched.Executed {
		t.Fatal("background launch", e)
	}
	remote.afterStarted = nil
	executionID := launched.Execution.ExecutionID
	commandAssertHeld(t, f, executionID, true)
	commandComplete(t, f, x, call, launched)
	commandAssertHeld(t, f, executionID, true) // tool success is not process exit
	if _, e = svc.ExecuteCommand(ctx, x.Ref, uint64(call.ID), request); e == nil || remote.launches != 1 {
		t.Fatal("duplicate launch replayed", e)
	}
	statusCall := commandDeclare(t, f, x, 2, "process_status", fmt.Sprintf(`{"execution_id":"%d"}`, executionID))
	status, e := svc.ProcessStatus(ctx, x.Ref, uint64(statusCall.ID), executionID)
	if e != nil || status.Execution.State != "running" {
		t.Fatal("process status", e)
	}
	commandComplete(t, f, x, statusCall, status)
	outputCall := commandDeclare(t, f, x, 3, "process_output", fmt.Sprintf(`{"execution_id":"%d","cursor":"0","max_output_bytes":4096}`, executionID))
	for _, changed := range []struct {
		cursor string
		limit  int
	}{{"1", 4096}, {"0", 8192}} {
		_, e = svc.ProcessOutput(ctx, x.Ref, uint64(outputCall.ID), executionID, changed.cursor, changed.limit)
		modelsExpectCode(t, e, "DATA_INTEGRITY_ERROR")
	}
	if remote.outputReads != 0 {
		t.Fatal("changed frozen output parameters reached provider")
	}
	output, e := svc.ProcessOutput(ctx, x.Ref, uint64(outputCall.ID), executionID, "0", 4096)
	if e != nil || output.Cursor != "13" || output.Execution.Stdout != "first\nsecond\n" || remote.outputReads != 1 {
		t.Fatal("background output cursor", output.Cursor, e)
	}
	commandComplete(t, f, x, outputCall, output)
	cancelCall := commandDeclare(t, f, x, 4, "process_cancel", fmt.Sprintf(`{"execution_id":"%d"}`, executionID))
	cancelled, e := svc.ProcessCancel(ctx, x.Ref, uint64(cancelCall.ID), executionID)
	if e != nil || cancelled.Execution.State != "cancel_requested" || remote.cancels != 1 {
		t.Fatal("cancel acceptance", e)
	}
	commandAssertHeld(t, f, executionID, true)
	commandComplete(t, f, x, cancelCall, cancelled)
	if e = svc.ReconcileExecutions(ctx, uint64(binding.ID)); e != nil {
		t.Fatal(e)
	}
	commandAssertHeld(t, f, executionID, true)
	if remote.cancels != 1 {
		t.Fatal("cancel was automatically repeated")
	}
	for id, result := range remote.executions {
		code := int32(143)
		result.Running = false
		result.ExitCode = &code
		remote.executions[id] = result
	}
	if e = svc.ReconcileExecutions(ctx, uint64(binding.ID)); e != nil {
		t.Fatal(e)
	}
	commandAssertHeld(t, f, executionID, false)
	// Stop can win the race with a foreground command's result. Its immutable
	// unknown result must be reconciled before releasing the root lease.
	stoppedCall := commandDeclare(t, f, x, 5, "exec_command", string(args))
	stopped, e := svc.ExecuteCommand(ctx, x.Ref, uint64(stoppedCall.ID), request)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = host.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Cancelled}); e != nil {
		t.Fatal(e)
	}
	if e = svc.ReconcileExecutions(ctx, uint64(binding.ID)); e != nil {
		t.Fatal(e)
	}
	commandAssertHeld(t, f, stopped.Execution.ExecutionID, true)
	for id, result := range remote.executions {
		result.Running, result.ExitCode = false, new(int32(143))
		remote.executions[id] = result
	}
	if e = svc.ReconcileExecutions(ctx, uint64(binding.ID)); e != nil {
		t.Fatal(e)
	}
	if e = svc.ProcessPending(ctx, 50); e != nil {
		t.Fatal(e)
	}
	if _, e = host.ConvergeDue(ctx, time.Now().UTC(), 100); e != nil {
		t.Fatal(e)
	}
	var settled int
	if e = f.Store.db.GetContext(ctx, &settled, "SELECT COUNT(*) FROM agent_run WHERE id=? AND settled_at IS NOT NULL", uint64(x.Ref.RunID)); e != nil || settled != 1 {
		t.Fatal("verified command exit did not release stopped turn", e)
	}
	// Unknown-without-ID survives root termination and process restart without
	// repeating the POST. Only physical instance termination frees occupancy.
	y := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "uncertain command")
	yBinding, e := svc.Acquire(ctx, y)
	if e != nil || yBinding == nil {
		t.Fatal(e)
	}
	if _, e = host.ActivateBinding(ctx, y.Ref, *yBinding); e != nil {
		t.Fatal(e)
	}
	y.Binding = yBinding
	// Another root cannot observe that execution by guessing its local ID.
	foreignCall := commandDeclare(t, f, y, 1, "process_status", fmt.Sprintf(`{"execution_id":"%d"}`, executionID))
	_, e = svc.ProcessStatus(ctx, y.Ref, uint64(foreignCall.ID), executionID)
	modelsExpectCode(t, e, "NOT_FOUND")
	no := false
	if _, e = host.CompleteTool(ctx, y.Ref, core.ToolResult{Call: foreignCall, Observation: core.DispatchObservation{Status: "failed", Executed: &no, Content: "not found"}}); e != nil {
		t.Fatal(e)
	}
	unknownCall := commandDeclare(t, f, y, 2, "exec_command", string(args))
	remote.unknownNext = true
	unknown, e := svc.ExecuteCommand(ctx, y.Ref, uint64(unknownCall.ID), request)
	if e == nil || unknown.Execution.State != "outcome_unknown" || unknown.Executed != nil {
		t.Fatal("unknown launch collapsed", e)
	}
	commandAssertHeld(t, f, unknown.Execution.ExecutionID, true)
	metadata, e := a.EncodeSandboxExecutionMetadata(unknown.Execution)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = host.CompleteTool(ctx, y.Ref, core.ToolResult{Call: unknownCall, Observation: core.DispatchObservation{Status: "outcome_unknown", Metadata: metadata, Content: "execution unconfirmed"}}); e != nil {
		t.Fatal(e)
	}
	runtimeEnd(t, f, y)
	commandAssertHeld(t, f, unknown.Execution.ExecutionID, true)
	before := remote.launches
	svc.Epoch = "sandbox-command-restarted"
	if e = svc.ReconcileExecutions(ctx, uint64(yBinding.ID)); e != nil {
		t.Fatal(e)
	}
	if remote.launches != before {
		t.Fatal("uncertain launch repeated after restart")
	}
	commandAssertHeld(t, f, unknown.Execution.ExecutionID, true)
	// Losing the actual runtime must settle an unknown command even though
	// the logical computer remains bound and cannot be deleted while busy.
	for id, resource := range remote.resources {
		if resource.Ref.Ownership.ComputerID == uint64(yBinding.ComputerID) {
			delete(remote.resources, id)
		}
	}
	if e = svc.ReconcileExecutions(ctx, uint64(yBinding.ID)); e != nil {
		t.Fatal(e)
	}
	commandAssertHeld(t, f, unknown.Execution.ExecutionID, false)
	var reconciled string
	if e = f.Store.db.GetContext(ctx, &reconciled, "SELECT reconciled_outcome FROM agent_tool_call WHERE id=?", uint64(unknownCall.ID)); e != nil || reconciled != "cancelled" {
		t.Fatal("verified runtime absence left tool result unreconciled", e)
	}
	var unavailable int
	if e = f.Store.db.GetContext(ctx, &unavailable, "SELECT COUNT(*) FROM cloud_computer WHERE id=? AND state='unavailable' AND deleted_at IS NULL", uint64(yBinding.ComputerID)); e != nil || unavailable != 1 {
		t.Fatal("runtime absence changed the logical computer identity", e)
	}
}

func commandSetPolicies(t *testing.T, f *agentIntegrationFixture, agentID uint64, policy string) {
	t.Helper()
	current, e := f.Agents.GetToolBindings(f.Context, f.AdminToken, agentID)
	if e != nil {
		t.Fatal(e)
	}
	items := []a.ToolBindingWrite{}
	for _, key := range []string{"exec_command", "process_status", "process_output", "process_cancel"} {
		items = append(items, a.ToolBindingWrite{ToolKey: key, Policy: policy, Constraints: json.RawMessage(`{}`)})
	}
	if _, e = f.Agents.PutToolBindings(f.Context, f.AdminToken, agentID, current.Tag, a.ToolBindingsWrite{Items: items}); e != nil {
		t.Fatal(e)
	}
}
func commandDeclare(t *testing.T, f *agentIntegrationFixture, x core.ExecutionContext, step uint32, key, args string) core.PreparedToolCall {
	t.Helper()
	commit := runtimeAttempt(t, f, x, step, modelcore.Message{Role: "assistant", ToolCalls: []modelcore.ToolCall{{ID: fmt.Sprintf("cmd-step-%d", step), Name: key, Arguments: args}}})
	if len(commit.Calls) != 1 {
		t.Fatal("missing command declaration")
	}
	call := commit.Calls[0]
	permit, e := f.Agents.PrepareDispatch(f.Context, x.Ref, call.ID)
	if e != nil || permit.Kind != "execute" {
		t.Fatal("command dispatch", e, permit.Kind)
	}
	return call
}
func commandComplete(t *testing.T, f *agentIntegrationFixture, x core.ExecutionContext, call core.PreparedToolCall, result a.CommandResult) {
	t.Helper()
	if result.Executed == nil {
		t.Fatal("successful command/observation omitted its execution fact")
	}
	metadata, e := a.EncodeSandboxExecutionMetadata(result.Execution)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Agents.CompleteTool(f.Context, x.Ref, core.ToolResult{Call: call, Observation: core.DispatchObservation{Status: "succeeded", Content: "Process observation", Executed: result.Executed, Metadata: metadata}}); e != nil {
		t.Fatal("process tool result", e)
	}
}
func commandAssertHeld(t *testing.T, f *agentIntegrationFixture, id uint64, held bool) {
	t.Helper()
	var count int
	if e := f.Store.db.GetContext(f.Context, &count, "SELECT COUNT(*) FROM agent_resource_reference WHERE holder_kind='cloud_execution' AND holder_id=? AND state<>'released'", strconv.FormatUint(id, 10)); e != nil {
		t.Fatal(e)
	}
	if (count > 0) != held {
		t.Fatalf("execution occupancy: got %d, expected held=%v", count, held)
	}
}
