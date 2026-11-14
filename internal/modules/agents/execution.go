package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type executionRows struct {
	Session     *SessionRow
	RootSession *SessionRow
	Run         *RunRow
	Root        *RunRow
	Agent       *Definition
	Context     *frozenRunContext
	Execution   agentcore.ExecutionContext
}

// Every path takes the model parents, Agent, root Session, child Session, root
// Run and child Run in this order. Network I/O is never performed here.
func (s *Service) lockExecution(tx identity.Tx, r Repository, st StateRepository, ref agentcore.ExecutionRef, _ bool) (executionRows, error) {
	var out executionRows
	initial, e := st.Session(uint64(ref.SessionID), false)
	if e != nil {
		return out, e
	}
	if initial == nil {
		return out, missing()
	}
	// Configuration and account changes affect admission only. An active turn
	// always reads its root snapshot, while fencing and physical state stay live.
	agent, e := r.Definition(initial.AgentID, true)
	if e != nil {
		return out, e
	}
	if agent == nil {
		return out, integrity()
	}
	rootSessionID := initial.ID
	if initial.RootSessionID != nil {
		rootSessionID = *initial.RootSessionID
	}
	rootSession, e := st.Session(rootSessionID, true)
	if e != nil {
		return out, e
	}
	if rootSession == nil {
		return out, integrity()
	}
	v := rootSession
	if initial.ID != rootSessionID {
		v, e = st.Session(initial.ID, true)
		if e != nil {
			return out, e
		}
		if v == nil {
			return out, integrity()
		}
	}
	if v.RowVersion != initial.RowVersion {
		return out, httpx.E(409, "EXECUTION_CHANGED", "执行配置发生变化")
	}
	root, e := st.Run(uint64(ref.RootRunID), true)
	if e != nil {
		return out, e
	}
	if root == nil || root.SessionID != rootSessionID {
		return out, integrity()
	}
	frozen, e := readRunContext(st, root.ID)
	if e != nil {
		return out, e
	}
	if frozen.Row.AgentID != agent.ID || frozen.Row.ExecutorUserID != initial.ExecutorUserID {
		return out, integrity()
	}
	agent.SystemPrompt, agent.RowVersion = frozen.Row.SystemPrompt, frozen.Row.AgentConfigVersion
	run := root
	if ref.RunID != ref.RootRunID {
		run, e = st.Run(uint64(ref.RunID), true)
		if e != nil {
			return out, e
		}
		if run == nil || run.RootRunID == nil || *run.RootRunID != root.ID {
			return out, integrity()
		}
	}
	if run.SessionID != v.ID {
		return out, integrity()
	}
	coreR, e := coreRun(run)
	if e != nil {
		return out, e
	}
	if e = agentcore.CheckExecution(coreR, ref, time.Now().UTC()); e != nil {
		return out, coreError(e)
	}
	if !agentcore.RunStatus(root.Status).Active() || root.Status == "stopping" {
		return out, httpx.E(409, "EXECUTION_FENCED", "主任务已停止")
	}
	var policy agentcore.Policy
	if json.Unmarshal(run.ExecutionPolicySnapshot, &policy) != nil {
		return out, integrity()
	}
	out = executionRows{Session: v, RootSession: rootSession, Run: run, Root: root, Agent: agent, Context: frozen, Execution: agentcore.ExecutionContext{Ref: ref, AgentID: agentcore.ID(v.AgentID), Principal: agentcore.PrincipalRef{Kind: "user", ID: agentcore.ID(v.ExecutorUserID)}, ContentSessionID: agentcore.ID(rootSessionID), Policy: policy, Authorization: frozen.Authorization, Model: frozen.Model, Deadline: run.DeadlineAt}}
	out.Execution.Binding, e = s.executionBinding(tx, root)
	if e != nil {
		return executionRows{}, e
	}
	return out, nil
}

func (s *Service) AuthorizeExecution(ctx context.Context, ref agentcore.ExecutionRef) (agentcore.ExecutionContext, error) {
	var out agentcore.ExecutionContext
	e := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		v, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		out = v.Execution
		return nil
	})
	return out, e
}

// AuthorizeProjectDispatch rechecks a resolved project target at the adapter
// handoff, including membership and the tool's operation-specific permission.
func (s *Service) AuthorizeProjectDispatch(ctx context.Context, ref agentcore.ExecutionRef, permit agentcore.DispatchPermit) error {
	return s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, e := s.lockExecution(tx, r, st, ref, true)
		if e != nil {
			return e
		}
		if s.Catalog.Tool == nil {
			return unavailable()
		}
		descriptor, e := s.Catalog.Tool(ctx, tx, permit.Call.Spec.Key)
		if e != nil {
			return e
		}
		if descriptor == nil || !descriptor.Availability.Available || descriptor.ProjectTarget == nil {
			return httpx.E(403, "RESOURCE_ACCESS_DENIED", "工具的项目授权不可用")
		}
		target, e := resolveToolProject(ctx, tx, r, x, descriptor, json.RawMessage(permit.Call.Call.Arguments))
		if e != nil {
			return e
		}
		if target == 0 || target != permit.ProjectID {
			return httpx.E(403, "RESOURCE_ACCESS_DENIED", "没有目标项目的操作权限")
		}
		return nil
	})
}

func ledger(row *RunRow) (agentcore.BudgetLedger, error) {
	v := agentcore.BudgetLedger{Version: agentcore.Version(row.BudgetRevision)}
	if json.Unmarshal(row.BudgetLimit, &v.Limit) != nil || json.Unmarshal(row.BudgetReserved, &v.Reserved) != nil || json.Unmarshal(row.BudgetUsed, &v.Used) != nil {
		return v, integrity()
	}
	return v, nil
}
func saveLedger(st StateRepository, row *RunRow, v agentcore.BudgetLedger) error {
	var e error
	row.BudgetLimit, e = json.Marshal(v.Limit)
	if e != nil {
		return e
	}
	row.BudgetReserved, e = json.Marshal(v.Reserved)
	if e != nil {
		return e
	}
	row.BudgetUsed, e = json.Marshal(v.Used)
	if e != nil {
		return e
	}
	row.BudgetRevision = uint64(v.Version)
	return st.SaveRun(row)
}
