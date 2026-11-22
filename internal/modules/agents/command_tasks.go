package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func commandDirectory(cwd, workdir string) (string, error) {
	name, err := workspaceToolPath(cwd, strings.TrimPrefix(workdir, "./"))
	if err != nil {
		return "", httpx.Invalid("workdir", "invalid")
	}
	absolute, err := nativePath(name)
	if err != nil || protectedNativePath(absolute) || len(absolute) > 1024 {
		return "", httpx.Invalid("workdir", "invalid")
	}
	return absolute, nil
}

func (s *CloudService) markBackground(ctx context.Context, claim commandClaim, meta *SandboxExecutionMetadata) error {
	return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
		row, err := lockCommandRows(repo, claim.Row, claim.Access)
		if err != nil {
			return err
		}
		// The stream can record exit between the last poll and the handoff.
		if row.FinishedAt != nil {
			meta.State, meta.ExitCode = "completed", row.ExitCode
			return nil
		}
		row.IsBackground, meta.Background = true, true
		return repo.SaveCloudExecution(row)
	})
}

type CommandTask struct {
	ID          uint64 `json:"task_id,string"`
	Description string `json:"description"`
	State       string `json:"state"`
	ExitCode    *int   `json:"exit_code"`
}

func (s *CloudService) TaskList(ctx context.Context, ref agentcore.ExecutionRef, callID uint64) ([]CommandTask, error) {
	tasks := []CommandTask{}
	err := s.cloudBackground(ctx, func(tx identity.Tx, r Repository, st StateRepository, repo CloudRepository) error {
		x, err := s.Host.lockExecution(tx, r, st, ref, true)
		if err != nil {
			return err
		}
		call, err := commandTool(st, ref, callID, "task_list")
		if err != nil {
			return err
		}
		if err = currentCommandPermission(r, st, x.Agent.ID, call); err != nil {
			return err
		}
		frozen, err := preparedCall(st, ref, call)
		if err != nil {
			return err
		}
		var args map[string]json.RawMessage
		if json.Unmarshal([]byte(frozen.Call.Arguments), &args) != nil || args == nil || len(args) != 0 {
			return integrity()
		}
		rows, err := repo.ListedCommandRows(uint64(ref.RootRunID))
		if err != nil {
			return err
		}
		for i := range rows {
			row := &rows[i]
			meta, err := metadataFromCommand(row)
			if err != nil {
				return err
			}
			item := CommandTask{ID: row.ID, Description: meta.Description, State: meta.State, ExitCode: meta.ExitCode}
			tasks = append(tasks, item)
		}
		return nil
	})
	return tasks, err
}

func applyTaskOutput(meta *SandboxExecutionMetadata, log sandboxcore.ExecutionOutput) {
	meta.Stdout, meta.Stderr = log.Stdout, log.Stderr
	meta.Truncated, meta.Incomplete, meta.OutputPending = log.Truncated, log.Incomplete, log.Pending
}

// Wait only for this observer. Leave time in the dispatch permit to commit
// the tool result after a bounded wait expires.
func (s *CloudService) waitCommand(ctx context.Context, row CloudExecutionRow, access *SandboxAccess, meta *SandboxExecutionMetadata, wait time.Duration) error {
	if row.RemoteExecutionID == nil {
		return nil
	}
	handle := sandboxcore.ExecutionHandle{Resource: access.Resource, ID: *row.RemoteExecutionID}
	until := time.Now().Add(wait)
	if deadline, ok := ctx.Deadline(); ok && deadline.Add(-time.Second).Before(until) {
		until = deadline.Add(-time.Second)
	}
	observeCtx := ctx
	if wait > 0 {
		var cancel context.CancelFunc
		observeCtx, cancel = context.WithDeadline(ctx, until)
		defer cancel()
	}
	pollInterval := 200 * time.Millisecond
	for {
		if meta.State != "completed" {
			result, err := access.Provider.InspectExecution(observeCtx, handle)
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if observeCtx.Err() != nil {
					return nil
				}
				meta.State, meta.ExitCode = "outcome_unknown", nil
				return s.settleCommand(ctx, row, access, *meta, result, err, true)
			}
			state, exit := commandProjection(result, nil, true)
			if state != "running" || meta.State == "outcome_unknown" {
				meta.State, meta.ExitCode = state, exit
				if err = s.settleCommand(ctx, row, access, *meta, result, nil, true); err != nil {
					return err
				}
			}
		}
		if time.Until(until) <= 0 {
			return nil
		}
		if meta.State == "completed" {
			page, err := access.Provider.ReadExecutionOutput(ctx, handle, 0, 4)
			if err != nil {
				return err
			}
			if !page.Pending {
				return nil
			}
		}
		timer := time.NewTimer(min(pollInterval, time.Until(until)))
		pollInterval = min(2*pollInterval, time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (s *CloudService) TaskOutput(ctx context.Context, ref agentcore.ExecutionRef, callID, id uint64, cursor string, waitMS int) (CommandResult, error) {
	args := processArguments{ExecutionID: id, Cursor: cursor, WaitMS: waitMS}
	if cursor == "" {
		cursor = "0"
	}
	start, err := strconv.ParseInt(cursor, 10, 64)
	if err != nil || start < 0 {
		return CommandResult{}, httpx.Invalid("cursor", "invalid")
	}
	if waitMS < 0 || waitMS > maxCommandWaitMS {
		return CommandResult{}, httpx.Invalid("wait_ms", "invalid")
	}
	access, row, err := s.commandAccess(ctx, ref, callID, id, "task_output", args)
	if err != nil {
		return CommandResult{}, err
	}
	defer func() { _ = s.ReleaseReferences(ctx, access, json.RawMessage(`{"observation_finished":true}`)) }()
	meta, err := metadataFromCommand(row)
	if err != nil {
		return CommandResult{}, err
	}
	if row.RemoteExecutionID == nil {
		if row.FinishedAt == nil {
			meta.State = "outcome_unknown"
			meta.Incomplete = true
		}
		return observedCommand(meta), nil
	}
	if err = s.waitCommand(ctx, *row, access, &meta, time.Duration(waitMS)*time.Millisecond); err != nil {
		return CommandResult{}, err
	}
	log, err := access.Provider.ReadExecutionOutput(ctx, sandboxcore.ExecutionHandle{Resource: access.Resource, ID: *row.RemoteExecutionID}, start, 8192)
	if err != nil {
		return CommandResult{}, err
	}
	applyTaskOutput(&meta, log)
	result := observedCommand(meta)
	result.Cursor = strconv.FormatInt(log.Cursor, 10)
	return result, nil
}

// A session viewer may observe a task only through its committed tool result.
func (s *CloudService) sessionCommand(ctx context.Context, raw string, sessionID, callID uint64, observe func(CloudRepository, *CloudExecutionRow, *Result) error) (*Result, error) {
	return s.Host.observationAccess(ctx, raw, func(tx identity.Tx, _ Repository, auth *identity.Auth, out *Result) error {
		st, err := StateFor(tx)
		if err != nil {
			return err
		}
		if _, err = s.Host.sessionAccess(st, sessionID, auth, false, false); err != nil {
			return err
		}
		call, err := st.ToolCall(callID, false)
		if err != nil {
			return err
		}
		if call == nil || call.SessionID != sessionID || call.ResultEventSeq == nil {
			return missing()
		}
		event, err := st.EventAt(sessionID, *call.ResultEventSeq)
		if err != nil {
			return err
		}
		if event == nil {
			return integrity()
		}
		facts, err := decodeEvent(*event)
		if err != nil {
			return err
		}
		var record struct {
			Execution *SandboxExecutionMetadata `json:"sandbox_execution"`
		}
		if err = json.Unmarshal(facts.Public, &record); err != nil {
			return err
		}
		if record.Execution == nil {
			return missing()
		}
		repo, err := CloudStateFor(tx)
		if err != nil {
			return err
		}
		row, err := repo.CloudExecution(record.Execution.ExecutionID, false)
		if err != nil {
			return err
		}
		if row == nil || row.RootRunID != call.RootRunID {
			return missing()
		}
		return observe(repo, row, out)
	})
}

func (s *CloudService) SessionTaskStatus(ctx context.Context, raw string, sessionID, callID uint64) (*Result, error) {
	return s.sessionCommand(ctx, raw, sessionID, callID, func(_ CloudRepository, row *CloudExecutionRow, out *Result) error {
		meta, err := metadataFromCommand(row)
		if err != nil {
			return err
		}
		out.Data = CommandTask{ID: row.ID, Description: meta.Description, State: meta.State, ExitCode: meta.ExitCode}
		return nil
	})
}

// Session viewers can page saved output after the run releases its sandbox lease.
func (s *CloudService) SessionTaskOutput(ctx context.Context, raw string, sessionID, callID uint64, cursor int64) (*Result, error) {
	if cursor < 0 {
		return nil, httpx.Invalid("cursor", "invalid")
	}
	var handle sandboxcore.ExecutionHandle
	result, err := s.sessionCommand(ctx, raw, sessionID, callID, func(repo CloudRepository, row *CloudExecutionRow, _ *Result) error {
		if row.RemoteExecutionID == nil {
			return missing()
		}
		instance, err := repo.Sandbox().Instance(row.InstanceID, false)
		if err != nil {
			return err
		}
		handle.Resource, err = s.foundation().Resource(instance)
		handle.ID = *row.RemoteExecutionID
		return err
	})
	if err != nil {
		return nil, err
	}
	if s.ReadSavedOutput == nil {
		return nil, unavailable()
	}
	log, err := s.ReadSavedOutput(ctx, handle, cursor, 32<<10)
	if err != nil {
		return nil, sandboxFailure(err)
	}
	result.Data = map[string]any{"stdout": log.Stdout, "stderr": log.Stderr, "next_cursor": strconv.FormatInt(log.Cursor, 10), "has_more": log.Truncated, "pending": log.Pending, "incomplete": log.Incomplete}
	return result, nil
}
