package eino

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// Engine leaves lifecycle and retries visible to core hooks. Eino alone chooses
// when to advance from a committed assistant through its tools to the next step.
// A fresh instance of the framework is built for each Run, never a checkpoint.
type Engine struct {
	MaxSteps    int
	MaxAttempts int
}

func (e Engine) Execute(ctx context.Context, ref agentcore.ExecutionRef, hooks agentcore.EngineHooks) error {
	if hooks == nil {
		return errors.New("missing execution hooks")
	}
	steps := e.MaxSteps
	if steps == 0 {
		steps = 200
	}
	attempts := e.MaxAttempts
	if attempts == 0 {
		attempts = 3
	}
	if steps < 1 || steps > 200 || attempts < 1 || attempts > 10 {
		return errors.New("invalid execution limits")
	}
	first, err := hooks.PrepareStep(ctx, ref, 1)
	if err != nil {
		return err
	}
	if first.Ref != ref || first.Step != 1 {
		return errors.New("invalid prepared step")
	}
	b := &executionModel{ref: ref, hooks: hooks, prepared: first, maxSteps: steps, maxAttempts: attempts}
	initial := make([]tool.BaseTool, 0, len(first.Tools))
	for _, spec := range first.Tools {
		info, err := toolInfo(spec.Definition)
		if err != nil {
			return err
		}
		initial = append(initial, &executionTool{info: info, bridge: b})
	}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{Name: "controlled_execution", Model: b, MaxIterations: steps, Handlers: []adk.ChatModelAgentMiddleware{&stepMiddleware{bridge: b}}, ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: initial, UnknownToolsHandler: b.invoke}}})
	if err != nil {
		return fmt.Errorf("initialize execution adapter: %w", err)
	}
	iterator := agent.Run(ctx, &adk.AgentInput{Messages: []*schema.Message{}})
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			return event.Err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if b.completed == 0 {
		return errors.New("execution produced no model call")
	}
	return nil
}

type executionModel struct {
	ref                   agentcore.ExecutionRef
	hooks                 agentcore.EngineHooks
	prepared              agentcore.PreparedStep
	completed             uint32
	maxSteps, maxAttempts int
	batch                 *agentcore.ToolBatch
}
type stepMiddleware struct {
	adk.BaseChatModelAgentMiddleware
	bridge *executionModel
}

func (m *stepMiddleware) BeforeModelRewriteState(ctx context.Context, state *adk.ChatModelAgentState, _ *adk.ModelContext) (context.Context, *adk.ChatModelAgentState, error) {
	b := m.bridge
	if b.completed > 0 {
		if int(b.completed) >= b.maxSteps {
			return ctx, nil, &agentcore.Error{Code: "STEP_LIMIT_EXCEEDED"}
		}
		step, err := b.hooks.PrepareStep(ctx, b.ref, b.completed+1)
		if err != nil {
			return ctx, nil, err
		}
		b.prepared = step
	}
	if b.prepared.Ref != b.ref || b.prepared.Step != b.completed+1 {
		return ctx, nil, errors.New("invalid prepared step")
	}
	state.Messages = make([]*schema.Message, 0, len(b.prepared.Request.Messages))
	for _, message := range b.prepared.Request.Messages {
		converted, err := toFramework(message)
		if err != nil {
			return ctx, nil, err
		}
		state.Messages = append(state.Messages, converted)
	}
	state.ToolInfos = make([]*schema.ToolInfo, 0, len(b.prepared.Tools))
	state.DeferredToolInfos = nil
	for _, spec := range b.prepared.Tools {
		info, err := toolInfo(spec.Definition)
		if err != nil {
			return ctx, nil, err
		}
		state.ToolInfos = append(state.ToolInfos, info)
	}
	return ctx, state, nil
}

func toolInfo(spec modelcore.Tool) (*schema.ToolInfo, error) {
	if spec.Name == "" || !json.Valid(spec.InputSchema) {
		return nil, modelcore.ErrInvalidRequest
	}
	raw, err := json.Marshal(map[string]any{"name": spec.Name, "desc": spec.Description, "has_params_one_of": true, "json_schema": spec.InputSchema})
	if err != nil {
		return nil, err
	}
	var info schema.ToolInfo
	if err = json.Unmarshal(raw, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (m *executionModel) Generate(ctx context.Context, _ []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	// The prepared request is the source of truth. Framework message conversion
	// and dynamic middleware must never replace native history or reorder tools.
	step := m.prepared
	for attempt := 1; attempt <= m.maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		permit, err := m.hooks.BeginAttempt(ctx, step, uint32(attempt))
		if err != nil {
			return nil, err
		}
		if permit.Ref != m.ref || permit.Step != step.Step || permit.Attempt != uint32(attempt) || permit.Client == nil || permit.Deadline.IsZero() {
			return nil, errors.New("invalid attempt permit")
		}
		callCtx, cancel := context.WithDeadline(ctx, permit.Deadline)
		response, callErr := permit.Client.Generate(callCtx, step.Request, func(d modelcore.Delta) error { return m.hooks.Emit(callCtx, permit, d) })
		if callErr == nil {
			callErr = callCtx.Err()
		}
		if errors.Is(callErr, context.DeadlineExceeded) && ctx.Err() == nil {
			callErr = &agentcore.Error{Code: "MODEL_ATTEMPT_TIMEOUT"}
		}
		cancel()
		// Commit even a failed/partial response. A cancelled parent does not
		// cancel the bounded transaction that records its truthful outcome.
		commitCtx, commitCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		commit, commitErr := m.hooks.CompleteAttempt(commitCtx, permit, agentcore.AttemptOutcome{Response: response, Err: callErr, Cancelled: errors.Is(callErr, context.Canceled)})
		commitCancel()
		if commitErr != nil {
			return nil, commitErr
		}
		if commit.Failure != nil {
			return nil, commit.Failure
		}
		if callErr != nil {
			if !commit.Retry || attempt == m.maxAttempts {
				return nil, callErr
			}
			if commit.RetryAfter < 0 || commit.RetryAfter > time.Minute {
				return nil, errors.New("invalid retry delay")
			}
			timer := time.NewTimer(commit.RetryAfter)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
			continue
		}
		if commit.Retry {
			return nil, errors.New("successful attempt cannot retry")
		}
		if err := validateCommit(response, commit, permit); err != nil {
			return nil, err
		}
		batch, err := agentcore.NewToolBatch(commit.Calls, step.MaxParallelTools)
		if err != nil {
			return nil, err
		}
		m.batch = batch
		m.completed = step.Step
		return toFramework(commit.Response.Message)
	}
	return nil, errors.New("model attempt limit exceeded")
}

func validateCommit(response modelcore.Response, commit agentcore.AttemptCommit, p agentcore.AttemptPermit) error {
	before, err := json.Marshal(response.Message)
	if err != nil {
		return err
	}
	after, err := json.Marshal(commit.Response.Message)
	if err != nil {
		return err
	}
	if string(before) != string(after) || len(commit.Calls) != len(response.Message.ToolCalls) {
		return errors.New("committed assistant mismatch")
	}
	for n, c := range commit.Calls {
		if c.Ref != p.Ref || c.ModelCallID != p.CallID || c.Step != p.Step || c.Call != response.Message.ToolCalls[n] {
			return errors.New("committed tool mismatch")
		}
	}
	return nil
}
func (m *executionModel) Stream(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	v, e := m.Generate(ctx, in, opts...)
	if e != nil {
		return nil, e
	}
	return schema.StreamReaderFromArray([]*schema.Message{v}), nil
}
func (m *executionModel) invoke(ctx context.Context, name, arguments string) (string, error) {
	if m.batch == nil {
		return "", errors.New("tool declaration not committed")
	}
	call, release, err := m.batch.Acquire(ctx, compose.GetToolCallID(ctx), name, arguments)
	if err != nil {
		return "", err
	}
	defer release()
	result, err := m.hooks.InvokeTool(ctx, call)
	if err != nil {
		m.batch.Abort(err)
		return "", err
	}
	if err = result.Receipt.ValidateTool(call.ID, call.Ref.SessionID); err != nil {
		m.batch.Abort(err)
		return "", err
	}
	return result.Content, nil
}

type executionTool struct {
	info   *schema.ToolInfo
	bridge *executionModel
}

func (t *executionTool) Info(context.Context) (*schema.ToolInfo, error) { return t.info, nil }
func (t *executionTool) InvokableRun(ctx context.Context, args string, _ ...tool.Option) (string, error) {
	return t.bridge.invoke(ctx, t.info.Name, args)
}

var _ agentcore.AgentEngine = Engine{}
