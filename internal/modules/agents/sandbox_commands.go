package agents

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Workload identity is a property of the verified runtime image. It cannot be
// selected by model arguments. A UID switch alone is not a security boundary:
// admission additionally requires the deployment's verified execution support.
const sandboxWorkloadUID uint32 = 10001

type CommandRequest struct {
	Command        string `json:"command"`
	Background     bool   `json:"background"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	MaxOutputBytes int    `json:"max_output_bytes"`
}

type SandboxExecutionMetadata struct {
	ExecutionID uint64 `json:"execution_id,string"`
	ComputerID  uint64 `json:"cloud_computer_id,string"`
	Command     string `json:"command"`
	CWD         string `json:"cwd"`
	Background  bool   `json:"background"`
	State       string `json:"state"`
	ExitCode    *int   `json:"exit_code"`
	Stdout      string `json:"stdout"`
	Stderr      string `json:"stderr"`
	Truncated   bool   `json:"truncated"`
}

type CommandResult struct {
	Execution SandboxExecutionMetadata `json:"cloud_execution"`
	Cursor    string                   `json:"cursor,omitempty"`
	Executed  *bool                    `json:"-"`
	Reason    string                   `json:"-"`
}
type processArguments struct {
	ExecutionID    uint64 `json:"execution_id,string"`
	Cursor         string `json:"cursor"`
	MaxOutputBytes int    `json:"max_output_bytes"`
}

func matchesProcessArguments(raw string, expected processArguments) bool {
	var frozen processArguments
	return json.Unmarshal([]byte(raw), &frozen) == nil && frozen == expected
}
func observedCommand(meta SandboxExecutionMetadata) CommandResult {
	yes := true
	return CommandResult{Execution: meta, Executed: &yes}
}

type commandClaim struct {
	Row        CloudExecutionRow
	Access     *SandboxAccess
	Connection CloudConnection
	Spec       sandboxcore.ExecSpec
	Metadata   SandboxExecutionMetadata
}

func normalizeCommandRequest(w CommandRequest) (CommandRequest, error) {
	if len(strings.TrimSpace(w.Command)) == 0 || len(w.Command) > 32<<10 || !utf8.ValidString(w.Command) || strings.ContainsRune(w.Command, 0) {
		return w, httpx.Invalid("command", "invalid")
	}
	encoded, _ := json.Marshal(w.Command)
	if len(encoded) > 32<<10 {
		return w, httpx.Invalid("command", "encoded_content_too_large")
	}
	if w.TimeoutSeconds == 0 {
		w.TimeoutSeconds = 60
	}
	if w.MaxOutputBytes == 0 {
		w.MaxOutputBytes = 32 << 10
	}
	if w.TimeoutSeconds < 1 || w.TimeoutSeconds > 600 {
		return w, httpx.Invalid("timeout_seconds", "out_of_range")
	}
	if w.MaxOutputBytes < 4 || w.MaxOutputBytes > 64<<10 {
		return w, httpx.Invalid("max_output_bytes", "out_of_range")
	}
	return w, nil
}

func commandTool(st StateRepository, ref agentcore.ExecutionRef, id uint64, key string) (*ToolCallRow, error) {
	call, e := st.ToolCall(id, true)
	if e != nil {
		return nil, e
	}
	if call == nil || call.RunID != uint64(ref.RunID) || call.RootRunID != uint64(ref.RootRunID) || call.ToolKey != key || call.ResultEventSeq != nil || call.DispatchToken == nil || call.ExecutorEpoch != ref.Epoch || call.FenceVersion != ref.Fence || !time.Now().Before(call.DeadlineAt) {
		return nil, httpx.E(409, "TOOL_NOT_DISPATCHING", "工具尚未派发或已结束")
	}
	return call, nil
}

func currentCommandPermission(r Repository, st StateRepository, agentID uint64, call *ToolCallRow) error {
	frozen, e := readRunContext(st, call.RootRunID)
	if e != nil {
		return e
	}
	bindings := make([]ToolBinding, 0, len(frozen.Tools))
	for _, tool := range frozen.Tools {
		bindings = append(bindings, tool.Binding)
	}
	for _, binding := range bindings {
		if binding.ToolKey != call.ToolKey || call.ToolBindingID == nil || binding.ID != *call.ToolBindingID {
			continue
		}
		if binding.Policy == "allow" {
			return nil
		}
		if binding.Policy == "confirm" && call.InteractionID != nil {
			interaction, e := st.Interaction(*call.InteractionID, true)
			if e != nil {
				return e
			}
			if interaction != nil && interaction.Status == "approved_once" && interaction.ApprovalConsumedAt != nil {
				return nil
			}
		}
		break
	}
	return httpx.E(409, "TOOL_PERMISSION_REVOKED", "工具当前权限不允许派发")
}

func (s *CloudService) reserveCommand(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, w CommandRequest) (commandClaim, error) {
	var out commandClaim
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, e := s.Host.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		call, e := commandTool(st, ref, callID, "exec_command")
		if e != nil {
			return e
		}
		if e = currentCommandPermission(r, st, x.Agent.ID, call); e != nil {
			return e
		}
		prepared, e := preparedCall(st, ref, call)
		if e != nil {
			return e
		}
		var frozen CommandRequest
		if json.Unmarshal([]byte(prepared.Call.Arguments), &frozen) != nil {
			return integrity()
		}
		frozen, e = normalizeCommandRequest(frozen)
		if e != nil {
			return e
		}
		if frozen != w {
			return integrity()
		}
		binding, e := repo.Lease(x.Root.ID, false)
		if e != nil {
			return e
		}
		if binding == nil || binding.ComputerID == 0 {
			return httpx.E(409, "SANDBOX_NOT_READY", "当前执行没有可用沙箱")
		}
		out.Access, out.Connection, e = s.accessRows(repo, binding.ComputerID, binding)
		if e != nil {
			return e
		}
		out.Access.CWD = x.Context.Row.CWD
		locked, e := repo.Lease(binding.RootRunID, true)
		if e != nil {
			return e
		}
		if locked == nil || locked.FenceVersion != binding.FenceVersion || locked.State != "active" {
			return httpx.E(409, "BINDING_CHANGED", "运行绑定已变化")
		}
		computer, e := repo.Computer(out.Access.ComputerID, false)
		if e != nil {
			return e
		}
		if computer == nil || computerCapabilities(computer).Execution != "supported" {
			return httpx.E(409, "SANDBOX_EXECUTION_UNVERIFIED", "沙箱执行安全能力尚未验证")
		}
		existing, e := repo.LeaseExecutions(binding.RootRunID)
		if e != nil {
			return e
		}
		for _, row := range existing {
			if row.ToolCallID == callID {
				return httpx.E(409, "SANDBOX_EXECUTION_ALREADY_EXISTS", "已有执行意图，不能重复派发")
			}
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		deadline := now.Add(time.Duration(w.TimeoutSeconds) * time.Second)
		if deadline.After(x.Root.DeadlineAt) {
			deadline = x.Root.DeadlineAt
		}
		if !w.Background && deadline.After(call.DeadlineAt) {
			deadline = call.DeadlineAt
		}
		if !deadline.After(now) {
			return httpx.E(409, "DEADLINE_EXCEEDED", "执行期限已到")
		}
		uid, gid := sandboxWorkloadUID, sandboxWorkloadUID
		out.Spec = sandboxcore.ExecSpec{Command: w.Command, CWD: out.Access.CWD, UID: &uid, GID: &gid, Background: w.Background, Timeout: deadline.Sub(now), MaxOutputBytes: w.MaxOutputBytes}
		encoded, e := json.Marshal(out.Spec)
		if e != nil {
			return e
		}
		hash := sha256.Sum256(encoded)
		out.Row = CloudExecutionRow{ComputerID: out.Access.ComputerID, BackendGeneration: out.Access.BackendGeneration, RuntimeGeneration: out.Access.RuntimeGeneration, RootRunID: x.Root.ID, RunID: x.Run.ID, ToolCallID: callID, ExecutionOrdinal: 1, ExecutionToken: NewStorageKey(), IsBackground: w.Background, Status: "prepared", CommandEventSeq: call.ArgumentsEventSeq, CWD: out.Access.CWD, ExecutionSpecHash: hash[:], ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, DeadlineAt: deadline, LastObservation: json.RawMessage(`{}`)}
		if e = repo.InsertCloudExecution(&out.Row); e != nil {
			return e
		}
		out.Metadata = SandboxExecutionMetadata{ExecutionID: out.Row.ID, ComputerID: out.Access.ComputerID, Command: w.Command, CWD: out.Row.CWD, Background: w.Background, State: "running"}
		out.Row.LastObservation, e = json.Marshal(out.Metadata)
		if e != nil {
			return e
		}
		if e = repo.SaveCloudExecution(&out.Row); e != nil {
			return e
		}
		out.Access.Execution = &ref
		return s.acquireReferences(st, repo, out.Access, "cloud_execution", strconv.FormatUint(out.Row.ID, 10))
	})
	return out, e
}

func (s *CloudService) ExecuteCommand(ctx context.Context, ref agentcore.ExecutionRef, callID uint64, w CommandRequest) (CommandResult, error) {
	no := false
	out := CommandResult{Executed: &no}
	w, e := normalizeCommandRequest(w)
	if e != nil {
		return out, e
	}
	claim, e := s.reserveCommand(ctx, ref, callID, w)
	if e != nil {
		return out, e
	}
	out.Execution = claim.Metadata
	claim.Access.Provider, e = s.openProvider(ctx, claim.Connection)
	if e != nil {
		out.Execution.State = "completed"
		out.Reason = remoteSandboxError(e)
		if settle := s.settleCommand(ctx, claim.Row, claim.Access, out.Execution, sandboxcore.ExecResult{}, e, false); settle != nil {
			return out, settle
		}
		return out, e
	}
	// A second short authorization transaction closes the preparation window.
	// Once dispatching is durable, a crash never authorizes replay.
	e = s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, err := s.Host.lockExecution(tx, r, st, ref, true)
		if err != nil {
			return err
		}
		call, err := commandTool(st, ref, callID, "exec_command")
		if err != nil {
			return err
		}
		if err = currentCommandPermission(r, st, x.Agent.ID, call); err != nil {
			return err
		}
		row, err := lockCommandRows(repo, claim.Row, claim.Access)
		if err != nil {
			return err
		}
		if row.Status != "prepared" {
			return httpx.E(409, "SANDBOX_EXECUTION_ALREADY_EXISTS", "已有执行意图，不能重复派发")
		}
		binding, err := repo.Lease(row.RootRunID, false)
		if err != nil {
			return err
		}
		if binding == nil || binding.FenceVersion != claim.Access.BindingFence || binding.State != "active" {
			return httpx.E(409, "BINDING_CHANGED", "运行绑定已变化")
		}
		computer, err := repo.Computer(claim.Access.ComputerID, false)
		if err != nil {
			return err
		}
		if computer == nil || computerCapabilities(computer).Execution != "supported" {
			return httpx.E(409, "SANDBOX_EXECUTION_UNVERIFIED", "沙箱执行安全能力尚未验证")
		}
		claim.Spec.Timeout = time.Until(row.DeadlineAt)
		if claim.Spec.Timeout <= 0 {
			return httpx.E(409, "DEADLINE_EXCEEDED", "执行期限已到")
		}
		encoded, err := json.Marshal(claim.Spec)
		if err != nil {
			return err
		}
		hash := sha256.Sum256(encoded)
		row.ExecutionSpecHash = hash[:]
		row.Status = "dispatching"
		return repo.SaveCloudExecution(row)
	})
	if e != nil {
		out.Execution.State = "completed"
		out.Reason = remoteSandboxError(e)
		if settle := s.settleCommand(ctx, claim.Row, claim.Access, out.Execution, sandboxcore.ExecResult{}, e, false); settle != nil {
			return out, settle
		}
		return out, e
	}
	result, e := claim.Access.Provider.Exec(ctx, claim.Access.Resource, claim.Spec, sandboxcore.ExecCallbacks{
		Started: func(callbackCtx context.Context, handle sandboxcore.ExecutionHandle) error {
			return s.recordCommandHandle(callbackCtx, claim, handle)
		},
		Output: func(_ context.Context, output sandboxcore.Output) error {
			remaining := w.MaxOutputBytes - len(out.Execution.Stdout) - len(out.Execution.Stderr)
			if len(output.Text) > remaining {
				output.Text = output.Text[:remaining]
				for len(output.Text) > 0 && !utf8.ValidString(output.Text) {
					output.Text = output.Text[:len(output.Text)-1]
				}
				out.Execution.Truncated = true
			}
			switch output.Stream {
			case "stdout":
				out.Execution.Stdout += output.Text
			case "stderr":
				out.Execution.Stderr += output.Text
			default:
				return integrity()
			}
			return nil
		},
	})
	out.Execution.Truncated = out.Execution.Truncated || result.OutputTruncated
	out.Execution.State, out.Execution.ExitCode = commandProjection(result, e, true)
	out.Reason = remoteSandboxError(e)
	if result.Handle != nil {
		yes := true
		out.Executed = &yes
	} else if mayHaveExecuted(e, true) {
		out.Executed = nil
	}
	if settle := s.settleCommand(ctx, claim.Row, claim.Access, out.Execution, result, e, true); settle != nil {
		out.Execution.State = "outcome_unknown"
		out.Execution.ExitCode = nil
		out.Reason = "SANDBOX_SETTLEMENT_FAILED"
		return out, settle
	}
	return out, e
}

func lockCommandRows(repo CloudRepository, expected CloudExecutionRow, access *SandboxAccess) (*CloudExecutionRow, error) {
	w, e := repo.Computer(access.ComputerID, true)
	if e != nil {
		return nil, e
	}
	if w == nil {
		return nil, integrity()
	}
	v, e := repo.Computer(access.ComputerID, true)
	if e != nil {
		return nil, e
	}
	if v == nil || v.ID != w.ID || v.BackendGeneration != access.BackendGeneration || v.RuntimeGeneration != access.RuntimeGeneration {
		return nil, integrity()
	}
	b, e := repo.Lease(access.BindingID, true)
	if e != nil {
		return nil, e
	}
	if b == nil || b.ComputerID == 0 || b.ComputerID != w.ID {
		return nil, integrity()
	}
	row, e := repo.CloudExecution(expected.ID, true)
	if e != nil {
		return nil, e
	}
	if row == nil || row.RootRunID != b.RootRunID || row.ExecutorEpoch != expected.ExecutorEpoch || row.FenceVersion != expected.FenceVersion || row.ExecutionToken != expected.ExecutionToken {
		return nil, httpx.E(409, "EXECUTION_FENCED", "执行观察已过期")
	}
	return row, nil
}

func (s *CloudService) recordCommandHandle(ctx context.Context, claim commandClaim, handle sandboxcore.ExecutionHandle) error {
	if handle.Resource != claim.Access.Resource || handle.ID == "" {
		return integrity()
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		row, e := lockCommandRows(repo, claim.Row, claim.Access)
		if e != nil {
			return e
		}
		if row.RemoteExecutionID != nil && *row.RemoteExecutionID != handle.ID {
			return integrity()
		}
		if row.FinishedAt != nil {
			return httpx.E(409, "EXECUTION_FENCED", "执行已结束")
		}
		row.RemoteExecutionID = &handle.ID
		now := time.Now().UTC().Truncate(time.Millisecond)
		row.StartedAt = &now
		row.LastObservedAt = &now
		if row.CancelRequestedAt == nil {
			row.Status = "running"
		}
		return repo.SaveCloudExecution(row)
	})
}

func mayHaveExecuted(cause error, dispatched bool) bool {
	if !dispatched {
		return false
	}
	if cause == nil {
		return true
	}
	var remote *sandboxcore.Error
	if errors.As(cause, &remote) {
		return remote.Unknown
	}
	return true
}

func commandProjection(result sandboxcore.ExecResult, cause error, dispatched bool) (string, *int) {
	if cause == nil && result.Handle != nil && !result.Running && result.ExitCode != nil {
		exit := int(*result.ExitCode)
		return "completed", &exit
	}
	if cause == nil && result.Handle != nil && result.Running {
		return "running", nil
	}
	if !mayHaveExecuted(cause, dispatched) && result.Handle == nil {
		return "completed", nil
	}
	return "outcome_unknown", nil
}

func (s *CloudService) settleCommand(ctx context.Context, expected CloudExecutionRow, access *SandboxAccess, meta SandboxExecutionMetadata, result sandboxcore.ExecResult, cause error, dispatched bool) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		row, e := lockCommandRows(repo, expected, access)
		if e != nil {
			return e
		}
		if row.FinishedAt != nil {
			return releaseCommandReferences(st, repo, row.ID, time.Now().UTC(), json.RawMessage(`{"terminal_execution":true}`))
		}
		if result.Handle != nil {
			if result.Handle.Resource != access.Resource || row.RemoteExecutionID != nil && *row.RemoteExecutionID != result.Handle.ID {
				return integrity()
			}
			row.RemoteExecutionID = &result.Handle.ID
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		row.LastObservedAt = &now
		state, exit := commandProjection(result, cause, dispatched)
		meta.State, meta.ExitCode = state, exit
		terminal := state == "completed"
		switch state {
		case "completed":
			row.Status = "exited"
			if exit == nil {
				row.Status = "failed"
			}
			row.ExitCode = exit
			row.FinishedAt = &now
		case "running":
			row.Status = "running"
			if row.CancelRequestedAt != nil {
				row.Status = "cancelling"
				meta.State = "cancel_requested"
			}
		default:
			row.Status = "outcome_unknown"
		}
		if cause != nil {
			code := remoteSandboxError(cause)
			row.ErrorCode = &code
		} else {
			row.ErrorCode = nil
		}
		row.LastObservation, e = json.Marshal(meta)
		if e != nil {
			return e
		}
		if e = repo.SaveCloudExecution(row); e != nil {
			return e
		}
		if terminal {
			return releaseCommandReferences(st, repo, row.ID, now, json.RawMessage(`{"terminal_execution":true}`))
		}
		if state == "outcome_unknown" {
			return unknownCommandReferences(st, repo, row.ID, now)
		}
		return nil
	})
}

func releaseCommandReferences(st StateRepository, repo CloudRepository, executionID uint64, now time.Time, evidence json.RawMessage) error {
	refs, e := repo.HolderReferences("cloud_execution", strconv.FormatUint(executionID, 10), true)
	if e != nil {
		return e
	}
	for i := range refs {
		ref := &refs[i]
		if ref.State == "released" {
			continue
		}
		ref.State = "released"
		ref.FenceVersion++
		ref.UpdatedAt = now
		ref.ReleasedAt = &now
		ref.LastVerifiedAt = &now
		reason := "execution_terminal_verified"
		ref.ReleaseReason = &reason
		ref.ReleaseEvidence = evidence
		if e = st.SaveResourceReference(ref); e != nil {
			return e
		}
	}
	return nil
}
func unknownCommandReferences(st StateRepository, repo CloudRepository, executionID uint64, now time.Time) error {
	refs, e := repo.HolderReferences("cloud_execution", strconv.FormatUint(executionID, 10), true)
	if e != nil {
		return e
	}
	for i := range refs {
		ref := &refs[i]
		if ref.State == "released" {
			continue
		}
		ref.State = "unknown"
		ref.FenceVersion++
		ref.UpdatedAt = now
		reason := "execution_result_unconfirmed"
		ref.ReleaseReason = &reason
		ref.ReleaseEvidence = json.RawMessage(`{"physical_completion_verified":false}`)
		if e = st.SaveResourceReference(ref); e != nil {
			return e
		}
	}
	return nil
}

func metadataFromCommand(row *CloudExecutionRow) (SandboxExecutionMetadata, error) {
	var meta SandboxExecutionMetadata
	if json.Unmarshal(row.LastObservation, &meta) != nil || meta.ExecutionID != row.ID {
		return meta, integrity()
	}
	meta.ExitCode = row.ExitCode
	switch row.Status {
	case "exited", "failed":
		meta.State = "completed"
	case "cancelling":
		meta.State = "cancel_requested"
		meta.ExitCode = nil
	case "outcome_unknown":
		meta.State = "outcome_unknown"
		meta.ExitCode = nil
	default:
		meta.State = "running"
		meta.ExitCode = nil
	}
	return meta, nil
}

// Access is intentionally root-family scoped. A model cannot inspect or cancel
// another Run's process by guessing a local execution ID, even for the same user.
func (s *CloudService) commandAccess(ctx context.Context, ref agentcore.ExecutionRef, callID, executionID uint64, key string, arguments processArguments) (*SandboxAccess, *CloudExecutionRow, error) {
	var row *CloudExecutionRow
	e := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, err := s.Host.lockExecution(tx, r, st, ref, true)
		if err != nil {
			return err
		}
		call, err := commandTool(st, ref, callID, key)
		if err != nil {
			return err
		}
		if err = currentCommandPermission(r, st, x.Agent.ID, call); err != nil {
			return err
		}
		prepared, err := preparedCall(st, ref, call)
		if err != nil {
			return err
		}
		if !matchesProcessArguments(prepared.Call.Arguments, arguments) {
			return integrity()
		}
		row, err = repo.CloudExecution(executionID, false)
		if err != nil {
			return err
		}
		if row == nil || row.RootRunID != uint64(ref.RootRunID) {
			return missing()
		}
		return nil
	})
	if e != nil {
		return nil, nil, e
	}
	access, e := s.AcquireExecutionComputer(ctx, ref, callID, "tool_call", strconv.FormatUint(callID, 10))
	if e != nil {
		return nil, nil, e
	}
	if row.RootRunID != access.BindingID {
		_ = s.ReleaseReferences(ctx, access, json.RawMessage(`{"physical_request_started":false}`))
		return nil, nil, missing()
	}
	return access, row, nil
}

func (s *CloudService) ProcessStatus(ctx context.Context, ref agentcore.ExecutionRef, callID, executionID uint64) (CommandResult, error) {
	access, row, e := s.commandAccess(ctx, ref, callID, executionID, "process_status", processArguments{ExecutionID: executionID})
	if e != nil {
		return CommandResult{}, e
	}
	defer func() { _ = s.ReleaseReferences(ctx, access, json.RawMessage(`{"observation_finished":true}`)) }()
	meta, e := metadataFromCommand(row)
	if e != nil {
		return CommandResult{}, e
	}
	if row.FinishedAt != nil {
		return observedCommand(meta), nil
	}
	if row.RemoteExecutionID == nil {
		meta.State = "outcome_unknown"
		return observedCommand(meta), nil
	}
	result, e := access.Provider.InspectExecution(ctx, sandboxcore.ExecutionHandle{Resource: access.Resource, ID: *row.RemoteExecutionID})
	meta.State, meta.ExitCode = commandProjection(result, e, true)
	if settle := s.settleCommand(ctx, *row, access, meta, result, e, true); settle != nil {
		return CommandResult{Execution: meta}, settle
	}
	if e == nil {
		return observedCommand(meta), nil
	}
	return CommandResult{Execution: meta, Reason: remoteSandboxError(e)}, e
}

func (s *CloudService) ProcessOutput(ctx context.Context, ref agentcore.ExecutionRef, callID, executionID uint64, cursor string, maxBytes int) (CommandResult, error) {
	arguments := processArguments{ExecutionID: executionID, Cursor: cursor, MaxOutputBytes: maxBytes}
	if cursor == "" {
		cursor = "0"
	}
	offset, e := strconv.ParseInt(cursor, 10, 64)
	if e != nil || offset < 0 {
		return CommandResult{}, httpx.Invalid("cursor", "invalid")
	}
	if maxBytes == 0 {
		maxBytes = 32 << 10
	}
	if maxBytes < 4 || maxBytes > 64<<10 {
		return CommandResult{}, httpx.Invalid("max_bytes", "out_of_range")
	}
	access, row, e := s.commandAccess(ctx, ref, callID, executionID, "process_output", arguments)
	if e != nil {
		return CommandResult{}, e
	}
	defer func() { _ = s.ReleaseReferences(ctx, access, json.RawMessage(`{"observation_finished":true}`)) }()
	meta, e := metadataFromCommand(row)
	if e != nil {
		return CommandResult{}, e
	}
	if !row.IsBackground {
		return CommandResult{Execution: meta}, httpx.E(409, "PROCESS_OUTPUT_UNAVAILABLE", "前台输出已记录在原工具结果中")
	}
	if row.RemoteExecutionID == nil {
		return CommandResult{Execution: meta}, httpx.E(409, "PROCESS_ID_UNKNOWN", "远端执行句柄尚未确认")
	}
	meta.Stdout, meta.Stderr = "", ""
	base, _ := json.Marshal(map[string]any{"cloud_execution": meta})
	// Each original byte can require up to six bytes when JSON escaped. Read
	// only what the public metadata budget can represent, keeping the remote
	// byte cursor aligned with returned output even for control characters.
	available := ((64 << 10) - len(base) - 128) / 6
	if available < 4 {
		return CommandResult{Execution: meta}, integrity()
	}
	if maxBytes > available {
		maxBytes = available
	}
	output, e := access.Provider.ReadExecutionOutput(ctx, sandboxcore.ExecutionHandle{Resource: access.Resource, ID: *row.RemoteExecutionID}, offset, maxBytes)
	if e != nil {
		return CommandResult{Execution: meta}, e
	}
	// The provider exposes one combined log, not independently labeled streams.
	// Preserve it in stdout and leave stderr empty; do not fabricate separation.
	meta.Stdout, meta.Stderr, meta.Truncated = output.Text, "", output.Truncated
	out := observedCommand(meta)
	out.Cursor = strconv.FormatInt(output.Cursor, 10)
	return out, nil
}

func (s *CloudService) ProcessCancel(ctx context.Context, ref agentcore.ExecutionRef, callID, executionID uint64) (CommandResult, error) {
	access, row, e := s.commandAccess(ctx, ref, callID, executionID, "process_cancel", processArguments{ExecutionID: executionID})
	if e != nil {
		return CommandResult{}, e
	}
	defer func() { _ = s.ReleaseReferences(ctx, access, json.RawMessage(`{"cancel_request_finished":true}`)) }()
	meta, e := metadataFromCommand(row)
	if e != nil {
		return CommandResult{}, e
	}
	if row.FinishedAt != nil {
		return observedCommand(meta), nil
	}
	e = s.cancelCommand(ctx, *row, access)
	meta.State = "cancel_requested"
	if e != nil {
		meta.State = "outcome_unknown"
	}
	if e == nil {
		return observedCommand(meta), nil
	}
	return CommandResult{Execution: meta, Reason: remoteSandboxError(e)}, e
}

func (s *CloudService) cancelCommand(ctx context.Context, expected CloudExecutionRow, access *SandboxAccess) error {
	var handle *sandboxcore.ExecutionHandle
	unknown := false
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		row, err := lockCommandRows(repo, expected, access)
		if err != nil {
			return err
		}
		if row.FinishedAt != nil || row.CancelRequestedAt != nil {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		row.Status = "cancelling"
		if row.RemoteExecutionID != nil {
			row.CancelRequestedAt = &now
			h := sandboxcore.ExecutionHandle{Resource: access.Resource, ID: *row.RemoteExecutionID}
			handle = &h
		} else {
			row.Status = "outcome_unknown"
			unknown = true
		}
		return repo.SaveCloudExecution(row)
	})
	if e != nil {
		return e
	}
	if unknown {
		return &sandboxcore.Error{Code: "SANDBOX_EXECUTION_UNCONFIRMED", Unknown: true}
	}
	if handle == nil {
		return nil
	}
	// Persisting cancellation intent precedes the one remote request. Neither
	// a lost acknowledgment nor a successful acknowledgment releases occupancy.
	return access.Provider.CancelExecution(ctx, *handle)
}

// ReconcileExecutions reads known remote handles, never repeats a launch. It
// runs without user credentials because it only observes/cancels already
// authorized physical work and releases proven-terminal resource references.
func (s *CloudService) ReconcileExecutions(ctx context.Context, bindingID uint64) error {
	var rows []CloudExecutionRow
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		var err error
		rows, err = repo.LeaseExecutions(bindingID)
		return err
	})
	if e != nil {
		return e
	}
	var failures []error
	for _, row := range rows {
		if ctx.Err() != nil {
			failures = append(failures, ctx.Err())
			break
		}
		if e = s.reconcileCommand(ctx, row); e != nil {
			failures = append(failures, e)
		} else if e = s.reconcileCommandTool(ctx, row.ID); e != nil {
			failures = append(failures, e)
		}
	}
	if err := s.reconcileCommandReadReferences(ctx, bindingID); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

// Command inspection is independent from the logical tool result. Reconcile
// an ended command even when Stop or a lost callback committed unknown first.
func (s *CloudService) reconcileCommandTool(ctx context.Context, executionID uint64) error {
	var evidence *agentcore.ReconciliationEvidence
	err := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, cr CloudRepository) error {
		row, err := cr.CloudExecution(executionID, false)
		if err != nil || row == nil || row.FinishedAt == nil {
			return err
		}
		call, err := st.ToolCall(row.ToolCallID, false)
		if err != nil || call == nil || call.ResultEventSeq == nil || call.Status != "outcome_unknown" || call.ReconciledOutcome != nil {
			return err
		}
		if call.RunID != row.RunID || call.RootRunID != row.RootRunID || call.ToolKey != "exec_command" {
			return integrity()
		}
		status := "cancelled"
		var executed *bool
		if row.RemoteExecutionID != nil {
			executed = new(true)
			if row.ExitCode != nil && row.CancelRequestedAt == nil {
				status = "failed"
				if *row.ExitCode == 0 {
					status = "succeeded"
				}
			}
		} else if row.ErrorCode != nil && *row.ErrorCode == "EXECUTION_NOT_DISPATCHED" {
			executed = new(false)
		}
		evidence = &agentcore.ReconciliationEvidence{Ref: agentcore.ExecutionRef{SessionID: agentcore.ID(call.SessionID), RunID: agentcore.ID(call.RunID), RootRunID: agentcore.ID(call.RootRunID), Epoch: call.ExecutorEpoch, Fence: call.FenceVersion}, CallID: agentcore.ID(call.ID), ObservedStatus: status, Executed: executed, Reason: "physical_execution_ended", ObservedAt: *row.FinishedAt}
		return nil
	})
	if err != nil || evidence == nil {
		return err
	}
	receipt, err := s.Host.RecordReconciliation(ctx, *evidence)
	if err == nil && s.Host.Committed != nil {
		s.Host.Committed(ctx, receipt)
	}
	return err
}

func (s *CloudService) reconcileCommandReadReferences(ctx context.Context, bindingID uint64) error {
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		binding, e := repo.Lease(bindingID, false)
		if e != nil {
			return e
		}
		if binding == nil || binding.ComputerID == 0 {
			return nil
		}
		if _, e = repo.Computer(binding.ComputerID, true); e != nil {
			return e
		}
		refs, e := repo.ActiveResourceReferences("cloud_lease", bindingID)
		if e != nil {
			return e
		}
		for _, ref := range refs {
			if ref.HolderKind != "tool_call" {
				continue
			}
			id, e := strconv.ParseUint(ref.HolderID, 10, 64)
			if e != nil {
				return integrity()
			}
			call, e := st.ToolCall(id, false)
			if e != nil {
				return e
			}
			if call == nil || call.ResultEventSeq == nil || call.RootRunID != binding.RootRunID {
				continue
			}
			if call.ToolKey != "process_status" && call.ToolKey != "process_output" && call.ToolKey != "process_cancel" {
				continue
			}
			// These calls only observe or request cancellation. The actual process
			// keeps independent sandbox_execution references until its exit is known.
			held, e := repo.HolderReferences("tool_call", ref.HolderID, true)
			if e != nil {
				return e
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			for i := range held {
				v := &held[i]
				if v.State == "released" {
					continue
				}
				v.State = "released"
				v.FenceVersion++
				v.UpdatedAt = now
				v.ReleasedAt = &now
				v.LastVerifiedAt = &now
				reason := "observational_tool_terminal"
				v.ReleaseReason = &reason
				v.ReleaseEvidence = json.RawMessage(`{"observational_tool_terminal":true}`)
				if e = st.SaveResourceReference(v); e != nil {
					return e
				}
			}
		}
		return nil
	})
}

func (s *CloudService) reconcileCommand(ctx context.Context, initial CloudExecutionRow, forceCancel ...bool) error {
	var row *CloudExecutionRow
	var access *SandboxAccess
	var connection CloudConnection
	mustCancel := false
	observeRuntime := false
	e := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		binding, err := repo.Lease(initial.RootRunID, false)
		if err != nil {
			return err
		}
		if binding == nil || binding.ComputerID == 0 || binding.RuntimeGeneration == nil {
			return integrity()
		}
		w, err := repo.Computer(binding.ComputerID, true)
		if err != nil {
			return err
		}
		if w == nil {
			return integrity()
		}
		instance, err := repo.Computer(binding.ComputerID, true)
		if err != nil {
			return err
		}
		if instance == nil {
			return integrity()
		}
		binding, err = repo.Lease(binding.RootRunID, true)
		if err != nil {
			return err
		}
		if binding == nil {
			return integrity()
		}
		row, err = repo.CloudExecution(initial.ID, true)
		if err != nil {
			return err
		}
		if row == nil {
			return integrity()
		}
		if row.ComputerID != instance.ID || row.BackendGeneration != instance.BackendGeneration || row.RuntimeGeneration != instance.RuntimeGeneration {
			return httpx.E(409, "CLOUD_EXECUTION_FENCED", "执行所属环境代次已变化")
		}
		access = &SandboxAccess{BindingID: binding.RootRunID, ComputerID: w.ID, BackendGeneration: instance.BackendGeneration, RuntimeGeneration: instance.RuntimeGeneration, StorageGeneration: instance.StorageGeneration, BindingFence: binding.FenceVersion, CWD: row.CWD}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if row.FinishedAt != nil {
			return releaseCommandReferences(st, repo, row.ID, now, json.RawMessage(`{"terminal_execution":true}`))
		}
		if instance.DeletedAt != nil {
			row.Status = "failed"
			row.FinishedAt = &now
			row.LastObservedAt = &now
			reason := "SANDBOX_TERMINATED"
			row.ErrorCode = &reason
			if err = repo.SaveCloudExecution(row); err != nil {
				return err
			}
			return releaseCommandReferences(st, repo, row.ID, now, json.RawMessage(`{"sandbox_termination_verified":true}`))
		}
		root, err := st.Run(row.RootRunID, false)
		if err != nil {
			return err
		}
		if root == nil {
			return integrity()
		}
		mustCancel = len(forceCancel) > 0 && forceCancel[0] || agentcore.RunStatus(root.Status).Terminal() || root.Status == "stopping" || !now.Before(row.DeadlineAt) || !now.Before(root.DeadlineAt)
		if row.Status == "prepared" && (row.ExecutorEpoch != s.Epoch || mustCancel) {
			row.Status = "failed"
			row.FinishedAt = &now
			reason := "EXECUTION_NOT_DISPATCHED"
			row.ErrorCode = &reason
			if err = repo.SaveCloudExecution(row); err != nil {
				return err
			}
			return releaseCommandReferences(st, repo, row.ID, now, json.RawMessage(`{"physical_request_started":false}`))
		}
		takeover := row.ExecutorEpoch != s.Epoch
		if takeover {
			row.ExecutorEpoch = s.Epoch
			row.FenceVersion++
			if err = repo.SaveCloudExecution(row); err != nil {
				return err
			}
		}
		if row.RemoteExecutionID == nil {
			if !takeover && (row.Status == "prepared" || row.Status == "dispatching" && !mustCancel) {
				return nil
			}
			row.Status = "outcome_unknown"
			if err = repo.SaveCloudExecution(row); err != nil {
				return err
			}
			if err = unknownCommandReferences(st, repo, row.ID, now); err != nil {
				return err
			}
		}
		observeRuntime = true
		provider, err := repo.Connection(false)
		if err != nil {
			return err
		}
		if provider == nil {
			return integrity()
		}
		connection, err = s.runtimeConnection(provider)
		if err != nil {
			return err
		}
		access.Resource, err = s.resource(instance)
		return err
	})
	if e != nil || row == nil || row.FinishedAt != nil || !observeRuntime {
		return e
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	access.Provider, e = s.openProvider(bounded, connection)
	if e != nil {
		return e
	}
	actual, inspectErr := access.Provider.Inspect(bounded, access.Resource)
	if inspectErr == nil && (actual.State == "absent" || actual.State == "terminated") {
		return s.settleAbsentCommand(ctx, row, access)
	}
	// Losing an execution handle is not proof that the command stopped.
	// Runtime absence is sufficient proof, and can be verified without a handle.
	if row.RemoteExecutionID == nil {
		return inspectErr
	}
	if mustCancel {
		if e = s.cancelCommand(bounded, *row, access); e != nil {
			return e
		}
	}
	result, remoteErr := access.Provider.InspectExecution(bounded, sandboxcore.ExecutionHandle{Resource: access.Resource, ID: *row.RemoteExecutionID})
	meta, e := metadataFromCommand(row)
	if e != nil {
		return e
	}
	return s.settleCommand(ctx, *row, access, meta, result, remoteErr, true)
}

func (s *CloudService) settleAbsentCommand(ctx context.Context, observed *CloudExecutionRow, access *SandboxAccess) error {
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, cr CloudRepository) error {
		computer, err := cr.Computer(observed.ComputerID, true)
		if err != nil {
			return err
		}
		row, err := cr.CloudExecution(observed.ID, true)
		if err != nil {
			return err
		}
		if computer == nil || row == nil {
			return integrity()
		}
		ref, err := s.resource(computer)
		if err != nil {
			return err
		}
		if ref != access.Resource || computer.BackendGeneration != observed.BackendGeneration || computer.RuntimeGeneration != observed.RuntimeGeneration || row.FenceVersion != observed.FenceVersion || row.ExecutorEpoch != observed.ExecutorEpoch {
			return httpx.E(409, "CLOUD_EXECUTION_FENCED", "执行所属环境代次已变化")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if row.FinishedAt == nil {
			code := "CLOUD_RUNTIME_MISSING"
			row.Status, row.ErrorCode, row.FinishedAt, row.LastObservedAt = "failed", &code, &now, &now
			row.LastObservation = json.RawMessage(`{"runtime_absence_verified":true}`)
			if err = cr.SaveCloudExecution(row); err != nil {
				return err
			}
			computer.State, computer.ErrorCode, computer.LastObservedAt, computer.UpdatedAt = "unavailable", &code, &now, now
			computer.RowVersion++
			if err = cr.SaveComputer(computer); err != nil {
				return err
			}
		}
		return releaseCommandReferences(st, cr, row.ID, now, json.RawMessage(`{"runtime_absence_verified":true}`))
	})
}
