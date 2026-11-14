package agents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type attemptSnapshot struct {
	SchemaVersion int                        `json:"schema_version"`
	Model         string                     `json:"model"`
	Protocol      modelcore.Protocol         `json:"protocol"`
	Connection    json.RawMessage            `json:"connection"`
	System        []modelcore.Message        `json:"system"`
	Suffix        []modelcore.Message        `json:"suffix"`
	ModelTools    []modelcore.Tool           `json:"model_tools"`
	Tools         []agentcore.ToolSpec       `json:"tools"`
	Parameters    map[string]json.RawMessage `json:"parameters"`
	SystemHash    string                     `json:"system_hash"`
}

// The manifest remains the sole source of conversation messages. The request
// snapshot retains every other deterministic input, including the exact prompt
// and actual model tools. Connection is the non-secret locked runtime route;
// ImagePart's JSON contract excludes hydrated bytes even from message fields.
func snapshotRequest(request modelcore.Request, model agentcore.LockedModel, tools []agentcore.ToolSpec, suffix int) (attemptSnapshot, error) {
	config := attemptSnapshot{SchemaVersion: 1, Model: request.Model, Protocol: request.Protocol, Connection: model.Connection, System: []modelcore.Message{}, Suffix: []modelcore.Message{}, ModelTools: slices.Clone(request.Tools), Tools: append([]agentcore.ToolSpec{}, tools...), Parameters: request.Parameters}
	if suffix < 0 || suffix > len(request.Messages) {
		return config, integrity()
	}
	for _, message := range request.Messages[:len(request.Messages)-suffix] {
		if message.Role != "system" {
			break
		}
		config.System = append(config.System, message)
	}
	config.Suffix = append(config.Suffix, request.Messages[len(request.Messages)-suffix:]...)
	var e error
	config.SystemHash, e = agentcore.ContentHash(config.System)
	return config, e
}

func (s *Service) FreezeAttempt(ctx context.Context, ref agentcore.ExecutionRef, d agentcore.AttemptDraft) (agentcore.AttemptRecord, error) {
	var out agentcore.AttemptRecord
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if d.Step.Ref != ref || d.Attempt == 0 || d.Purpose != "generation" || d.CompactionID != nil || uint64(d.Step.Step) != x.Run.CurrentStepNo || d.Step.Manifest.Revision != agentcore.Version(x.Session.SurfaceRevision) {
			return httpx.E(409, "SURFACE_CHANGED", "模型请求源已变化")
		}
		if !now.Before(d.Deadline) || d.Deadline.After(x.Run.DeadlineAt) {
			return httpx.E(409, "DEADLINE_EXCEEDED", "模型调用期限无效")
		}
		hash, e := agentcore.ContentHash(d.Step.Request)
		if e != nil {
			return e
		}
		if hash != d.RequestHash {
			return integrity()
		}
		m, facts, e := loadSurface(st, x.Session)
		if e != nil {
			return e
		}
		if !same(m, d.Step.Manifest) {
			return httpx.E(409, "SURFACE_CHANGED", "模型请求源已变化")
		}
		if _, e = agentcore.BuildSurface(m, facts); e != nil {
			return coreError(e)
		}
		previous, e := st.AttemptForStep(x.Run.ID, uint64(d.Step.Step), uint64(d.Attempt))
		if e != nil {
			return e
		}
		if previous != nil {
			return httpx.E(409, "ATTEMPT_ALREADY_STARTED", "模型尝试已经登记，不允许再次外发")
		}
		budget, e := ledger(x.Root)
		if e != nil {
			return e
		}
		d.Reservation.ModelCalls = 1
		budget, res, e := budget.Reserve(d.Reservation)
		if e != nil {
			return coreError(e)
		}
		config, e := snapshotRequest(d.Step.Request, x.Execution.Model, d.Step.Tools, 0)
		if e != nil {
			return e
		}
		requestConfig, e := json.Marshal(config)
		if e != nil {
			return e
		}
		manifest, e := surfaceBytes(m)
		if e != nil {
			return e
		}
		reserved, e := json.Marshal(res)
		if e != nil {
			return e
		}
		capabilities, e := json.Marshal(x.Execution.Model.Capabilities)
		if e != nil {
			return e
		}
		thinking, e := json.Marshal(map[string]string{"option_key": x.Execution.Model.ThinkingKey})
		if e != nil {
			return e
		}
		digest, e := hex.DecodeString(hash)
		if e != nil {
			return e
		}
		runID, rootID := x.Run.ID, x.Root.ID
		call := &ModelCallRow{SessionID: x.Session.ID, RunID: &runID, RootRunID: &rootID, StepNo: uint64(d.Step.Step), AttemptNo: uint64(d.Attempt), Purpose: "generation", Status: "running", ProviderID: uint64(x.Execution.Model.ProviderID), ModelDefinitionID: uint64(x.Execution.Model.DefinitionID), Protocol: string(x.Execution.Model.Protocol), RequestedModelID: x.Execution.Model.RemoteModelID, Thinking: thinking, RequestConfig: requestConfig, SurfaceManifest: manifest, RequestHash: digest, CapabilitySnapshot: capabilities, BudgetReservation: reserved, ExecutorEpoch: ref.Epoch, FenceVersion: ref.Fence, UsageCompleteness: "unknown", CreatedAt: now, StartedAt: &now, DeadlineAt: d.Deadline.UTC().Truncate(time.Millisecond)}
		if e = st.InsertModelCall(call); e != nil {
			return e
		}
		if e = saveLedger(st, x.Root, budget); e != nil {
			return e
		}
		out.Permit = agentcore.AttemptPermit{Ref: ref, CallID: agentcore.ID(call.ID), Step: d.Step.Step, Attempt: d.Attempt, Deadline: call.DeadlineAt}
		return nil
	})
	return out, e
}

func validateToolArguments(spec agentcore.ToolSpec, call modelcore.ToolCall) error {
	if call.ID == "" || len(call.ID) > 255 || len(call.Arguments) > modelcore.MaxToolArgumentsBytes || call.Name != spec.Definition.Name {
		return modelcore.ErrInvalidResponse
	}
	var object map[string]any
	if json.Unmarshal([]byte(call.Arguments), &object) != nil || object == nil {
		return modelcore.ErrInvalidResponse
	}
	var schema jsonschema.Schema
	if json.Unmarshal(spec.Definition.InputSchema, &schema) != nil {
		return modelcore.ErrInvalidResponse
	}
	resolved, e := schema.Resolve(nil)
	if e != nil {
		return modelcore.ErrInvalidResponse
	}
	if resolved.Validate(object) != nil {
		return modelcore.ErrInvalidResponse
	}
	return nil
}

func modelOutcomeReason(out agentcore.AttemptOutcome) string {
	if out.Cancelled || errors.Is(out.Err, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(out.Err, modelcore.ErrTransportTimeout) {
		return "MODEL_REQUEST_TIMEOUT"
	}
	var executionError *agentcore.Error
	if errors.As(out.Err, &executionError) && executionError.Code == "MODEL_ATTEMPT_TIMEOUT" {
		return "MODEL_ATTEMPT_TIMEOUT"
	}
	if errors.Is(out.Err, context.DeadlineExceeded) {
		return "DEADLINE_EXCEEDED"
	}
	if errors.Is(out.Err, modelcore.ErrOutputLimit) {
		return "OUTPUT_LIMIT_EXCEEDED"
	}
	if errors.Is(out.Err, modelcore.ErrInvalidResponse) {
		return "MODEL_RESPONSE_INVALID"
	}
	if errors.Is(out.Err, modelcore.ErrIncompleteStream) {
		return "MODEL_STREAM_INCOMPLETE"
	}
	if errors.Is(out.Err, modelcore.ErrRateLimited) {
		return "MODEL_RATE_LIMITED"
	}
	if errors.Is(out.Err, modelcore.ErrAuthenticationFailed) {
		return "MODEL_AUTHENTICATION_FAILED"
	}
	if errors.Is(out.Err, modelcore.ErrRequestRejected) {
		return "MODEL_REQUEST_REJECTED"
	}
	if errors.Is(out.Err, modelcore.ErrRemoteService) {
		return "MODEL_REMOTE_SERVICE_ERROR"
	}
	if errors.Is(out.Err, modelcore.ErrTransport) {
		return "MODEL_CONNECTION_FAILED"
	}
	if out.Err != nil {
		return "MODEL_REQUEST_FAILED"
	}
	return ""
}
func boundedPartial(text string) string {
	const n = 48 << 10
	if len(text) <= n {
		return text
	}
	text = text[:n]
	for !utf8.ValidString(text) {
		text = text[:len(text)-1]
	}
	return text
}
func uiAssistant(message modelcore.Message, ids []agentcore.ID, duration ...*int64) []agentcore.ContentBlock {
	blocks := []agentcore.ContentBlock{}
	if message.Reasoning != "" {
		blocks = append(blocks, agentcore.ContentBlock{Type: "reasoning", Text: message.Reasoning})
		if len(duration) > 0 {
			blocks[0].DurationMS = duration[0]
		}
	}
	if message.Content != "" {
		blocks = append(blocks, agentcore.ContentBlock{Type: "text", Text: message.Content})
	}
	for _, id := range ids {
		value := id
		blocks = append(blocks, agentcore.ContentBlock{Type: "tool_reference", ToolCallID: &value})
	}
	return blocks
}

func attemptValidation(snapshot attemptSnapshot, response modelcore.Response) ([]agentcore.ToolSpec, error) {
	if response.Message.Role != "assistant" {
		return nil, modelcore.ErrInvalidResponse
	}
	specs := make([]agentcore.ToolSpec, len(response.Message.ToolCalls))
	known := map[string]agentcore.ToolSpec{}
	for _, t := range snapshot.Tools {
		known[t.Definition.Name] = t
	}
	seen := map[string]bool{}
	ids := []agentcore.ID{}
	for i, call := range response.Message.ToolCalls {
		spec, ok := known[call.Name]
		if !ok || seen[call.ID] {
			return nil, modelcore.ErrInvalidResponse
		}
		seen[call.ID] = true
		if e := validateToolArguments(spec, call); e != nil {
			return nil, e
		}
		specs[i] = spec
		ids = append(ids, agentcore.ID(^uint64(0)))
	}
	public, _ := json.Marshal(map[string]any{"attempt_id": agentcore.ID(^uint64(0)), "model_call_id": agentcore.ID(^uint64(0)), "content": uiAssistant(response.Message, ids), "finish_reason": response.FinishReason})
	envelope, _ := json.Marshal(StoredEvent{Public: public, Message: &response.Message, ModelCallID: agentcore.ID(^uint64(0))})
	if len(envelope) > agentcore.MaxEventBytes {
		return nil, modelcore.ErrOutputLimit
	}
	group := len(envelope)
	for _, call := range response.Message.ToolCalls {
		group += len(call.Arguments) + 2048
	}
	if group > agentcore.MaxHistoryBytes {
		return nil, modelcore.ErrOutputLimit
	}
	return specs, nil
}

func usageNumber(v *int64) *uint64 {
	if v == nil || *v < 0 {
		return nil
	}
	n := uint64(*v)
	return &n
}
func settleModelBudget(st StateRepository, root *RunRow, call *ModelCallRow, usage modelcore.Usage) error {
	call.InputTokens = usageNumber(usage.InputTokens)
	call.OutputTokens = usageNumber(usage.OutputTokens)
	call.CacheReadTokens = usageNumber(usage.CacheReadTokens)
	call.CacheWriteTokens = usageNumber(usage.CacheWriteTokens)
	if usage.NormalizationVersion != "" {
		version := usage.NormalizationVersion
		call.UsageSemanticsVersion = &version
	}
	call.UsageRaw, _ = json.Marshal(modelcore.FilterRawUsage(modelcore.Protocol(call.Protocol), usage.RawNumericFields))
	var reservation agentcore.Reservation
	if json.Unmarshal(call.BudgetReservation, &reservation) != nil {
		return integrity()
	}
	l, e := ledger(root)
	if e != nil {
		return e
	}
	// Missing token counts retain their reserved amount. A response never turns
	// unknown usage into a fictional zero, even when the logical call is closed.
	actual := agentcore.Budget{ModelCalls: 1}
	release := agentcore.Budget{ModelCalls: reservation.Amount.ModelCalls}
	if call.InputTokens != nil {
		actual.InputTokens = *call.InputTokens
		release.InputTokens = reservation.Amount.InputTokens
	}
	if call.OutputTokens != nil {
		actual.OutputTokens = *call.OutputTokens
		release.OutputTokens = reservation.Amount.OutputTokens
	}
	l, _, e = l.Settle(agentcore.Reservation{Amount: release}, &actual)
	if e != nil {
		return coreError(e)
	}
	settlement := struct {
		Actual   agentcore.Budget `json:"actual"`
		Released agentcore.Budget `json:"released"`
	}{actual, release}
	call.BudgetSettlement, e = json.Marshal(settlement)
	if e != nil {
		return e
	}
	call.UsageCompleteness = "unknown"
	if call.InputTokens != nil && call.OutputTokens != nil {
		call.UsageCompleteness = "complete"
	} else if call.InputTokens != nil || call.OutputTokens != nil {
		call.UsageCompleteness = "partial"
	}
	if call.UsageCompleteness != "complete" {
		root.UsageCompleteness = call.UsageCompleteness
	}
	return saveLedger(st, root, l)
}

func (s *Service) CompleteAttempt(ctx context.Context, ref agentcore.ExecutionRef, result agentcore.AttemptResult) (agentcore.AttemptCommit, error) {
	var out agentcore.AttemptCommit
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		out = agentcore.AttemptCommit{}
		x, e := s.lockExecution(tx, r, st, ref, false)
		if e != nil {
			return e
		}
		call, e := st.ModelCall(uint64(result.Permit.CallID), true)
		if e != nil {
			return e
		}
		if call == nil || call.RunID == nil || *call.RunID != x.Run.ID || call.ExecutorEpoch != ref.Epoch || call.FenceVersion != ref.Fence {
			return httpx.E(409, "EXECUTION_FENCED", "模型结果所属执行已经失效")
		}
		if call.ResponseEventSeq != nil {
			return s.replayAttempt(st, ref, call, &out)
		}
		if call.Status != "running" {
			return httpx.E(409, "ATTEMPT_ALREADY_SETTLED", "模型尝试已经结算")
		}
		var snapshot attemptSnapshot
		if json.Unmarshal(call.RequestConfig, &snapshot) != nil || snapshot.SchemaVersion != 1 {
			return integrity()
		}
		outcome := result.Outcome
		specs := []agentcore.ToolSpec{}
		if outcome.Err == nil {
			specs, e = attemptValidation(snapshot, outcome.Response)
			if e != nil {
				outcome.Err = e
				out.Failure = e
			}
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		from := x.Session.LastSeq + 1
		reason := modelOutcomeReason(outcome)
		message := outcome.Response.Message
		if reason != "" {
			message = modelcore.Message{Role: "assistant", Content: boundedPartial(message.Content), Reasoning: boundedPartial(message.Reasoning)}
			partial := message.Content != "" || message.Reasoning != ""
			status := "failed"
			if outcome.Cancelled || reason == "CANCELLED" || reason == "DEADLINE_EXCEEDED" {
				status = "interrupted"
			}
			seq, e := appendEvent(st, x.Session, &x.Run.ID, "assistant/attempt", "model-result:"+strconv.FormatUint(call.ID, 10), map[string]any{"attempt_id": agentcore.ID(call.ID), "model_call_id": agentcore.ID(call.ID), "step_no": call.StepNo, "attempt_no": call.AttemptNo, "status": status, "content": uiAssistant(message, nil, result.ReasoningDurationMS), "partial": partial, "reason_code": reason}, &StoredEvent{Message: &message, ModelCallID: agentcore.ID(call.ID), Interrupted: partial}, now)
			if e != nil {
				return e
			}
			call.ResponseEventSeq = &seq
			call.Status = status
			call.ErrorCode = &reason
			out.AssistantSeq = agentcore.Seq(seq)
		} else {
			bindingIDs := map[string]uint64{}
			for _, frozen := range x.Context.Tools {
				bindingIDs[frozen.Binding.ToolKey] = frozen.Binding.ID
			}
			ids := []agentcore.ID{}
			rows := make([]*ToolCallRow, len(message.ToolCalls))
			zero, _ := json.Marshal(agentcore.Reservation{})
			for i, c := range message.ToolCalls {
				spec := specs[i]
				specJSON, e := json.Marshal(spec)
				if e != nil {
					return e
				}
				canonical, e := agentcore.CanonicalJSON(json.RawMessage(c.Arguments))
				if e != nil {
					return e
				}
				digest := sha256.Sum256(canonical)
				row := &ToolCallRow{SessionID: x.Session.ID, RunID: x.Run.ID, RootRunID: x.Root.ID, ModelCallID: call.ID, StepNo: call.StepNo, CallOrdinal: uint64(i), ProviderCallID: c.ID, ToolKey: spec.Key, ExecutionClass: spec.ExecutionClass, Status: "prepared", ArgumentsHash: digest[:], ToolDefinitionSnapshot: specJSON, AuthorizationSnapshot: json.RawMessage(`{}`), BudgetReservation: zero, AgentConfigVersion: x.Agent.RowVersion, ResourceConfigVersion: x.Agent.RowVersion, ExecutorEpoch: ref.Epoch, FenceVersion: ref.Fence, CreatedAt: now, DeadlineAt: x.Run.DeadlineAt, UpdatedAt: now}
				if id, ok := bindingIDs[spec.Key]; ok {
					row.ToolBindingID = &id
				}
				if spec.MCP != nil {
					row.MCPBindingID = &spec.MCP.BindingID
					row.MCPServerID = &spec.MCP.ServerID
					row.MCPToolName = &spec.MCP.RemoteName
				}
				if e = st.InsertToolCall(row); e != nil {
					return e
				}
				rows[i] = row
				ids = append(ids, agentcore.ID(row.ID))
			}
			seq, e := appendEvent(st, x.Session, &x.Run.ID, "assistant/message", "model-result:"+strconv.FormatUint(call.ID, 10), map[string]any{"attempt_id": agentcore.ID(call.ID), "model_call_id": agentcore.ID(call.ID), "step_no": call.StepNo, "attempt_no": call.AttemptNo, "content": uiAssistant(message, ids, result.ReasoningDurationMS), "finish_reason": outcome.Response.FinishReason}, &StoredEvent{Message: &message, ModelCallID: agentcore.ID(call.ID)}, now)
			if e != nil {
				return e
			}
			call.ResponseEventSeq = &seq
			call.Status = "completed"
			out.AssistantSeq = agentcore.Seq(seq)
			out.Calls = []agentcore.PreparedToolCall{}
			for i, row := range rows {
				c := message.ToolCalls[i]
				spec := specs[i]
				seq, e := appendEvent(st, x.Session, &x.Run.ID, "tool/call", "", map[string]any{"tool_call_id": agentcore.ID(row.ID), "model_call_id": agentcore.ID(call.ID), "step_no": row.StepNo, "call_ordinal": row.CallOrdinal, "provider_call_id": row.ProviderCallID, "status": row.Status, "tool_key": row.ToolKey, "mcp_server_id": coreID(row.MCPServerID), "mcp_binding_id": coreID(row.MCPBindingID), "mcp_tool_name": row.MCPToolName, "arguments": json.RawMessage(c.Arguments), "arguments_hash": hexHash(row.ArgumentsHash), "execution_class": row.ExecutionClass, "policy": spec.Policy}, nil, now)
				if e != nil {
					return e
				}
				row.ArgumentsEventSeq = seq
				if e = st.SaveToolCall(row); e != nil {
					return e
				}
				out.Calls = append(out.Calls, agentcore.PreparedToolCall{Ref: ref, ID: agentcore.ID(row.ID), ModelCallID: agentcore.ID(call.ID), Step: uint32(call.StepNo), Ordinal: uint32(i), Call: c, Spec: spec})
			}
		}
		if outcome.Response.ReturnedModel != "" {
			model := outcome.Response.ReturnedModel
			call.ResponseModelID = &model
		}
		call.FinishedAt = &now
		if e = settleModelBudget(st, x.Root, call, outcome.Response.Usage); e != nil {
			return e
		}
		if e = st.SaveModelCall(call); e != nil {
			return e
		}
		if e = st.SaveSession(x.Session); e != nil {
			return e
		}
		out.Response = outcome.Response
		if reason != "" {
			out.Response.Message = message
		}
		out.Receipt = eventReceipt(x.Session.ID, from, x.Session.LastSeq)
		return nil
	})
	return out, e
}

func (s *Service) replayAttempt(st StateRepository, ref agentcore.ExecutionRef, call *ModelCallRow, out *agentcore.AttemptCommit) error {
	event, e := st.EventAt(call.SessionID, *call.ResponseEventSeq)
	if e != nil {
		return e
	}
	if event == nil {
		return integrity()
	}
	stored, e := decodeEvent(*event)
	if e != nil {
		return e
	}
	if stored.Message == nil {
		return integrity()
	}
	out.Response.Message = *stored.Message
	out.AssistantSeq = agentcore.Seq(*call.ResponseEventSeq)
	out.Receipt = eventReceipt(call.SessionID, *call.ResponseEventSeq, *call.ResponseEventSeq)
	if call.Status != "completed" {
		out.Failure = modelcore.ErrInvalidResponse
		return nil
	}
	rows, e := st.RunTools(*call.RunID)
	if e != nil {
		return e
	}
	out.Calls = []agentcore.PreparedToolCall{}
	for _, row := range rows {
		if row.ModelCallID != call.ID {
			continue
		}
		if int(row.CallOrdinal) >= len(stored.Message.ToolCalls) {
			return integrity()
		}
		var spec agentcore.ToolSpec
		if json.Unmarshal(row.ToolDefinitionSnapshot, &spec) != nil {
			return integrity()
		}
		out.Calls = append(out.Calls, agentcore.PreparedToolCall{Ref: ref, ID: agentcore.ID(row.ID), ModelCallID: agentcore.ID(call.ID), Step: uint32(call.StepNo), Ordinal: uint32(row.CallOrdinal), Call: stored.Message.ToolCalls[row.CallOrdinal], Spec: spec})
	}
	return nil
}
