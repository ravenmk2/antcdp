package agents

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// A platform call can issue several synchronous requests. Only the current
// physical request needs observation after a crash; arguments never belong here.
type papiPhysicalStep struct {
	Resource sandboxcore.ResourceRef `json:"resource"`
	Command  string                  `json:"command_id,omitempty"`
}

func (s *CloudService) RecordPAPIStep(ctx context.Context, a *SandboxAccess, callID uint64, command string) error {
	if a == nil || a.Execution == nil {
		return integrity()
	}
	return s.Host.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		if _, err := s.Host.lockExecution(tx, r, st, *a.Execution, true); err != nil {
			return err
		}
		row, err := st.ToolCall(callID, true)
		if err != nil {
			return err
		}
		if row == nil || row.RunID != uint64(a.Execution.RunID) || row.ToolKey != papi.CallTool || row.DispatchToken == nil || row.ResultEventSeq != nil {
			return httpx.E(409, "TOOL_NOT_DISPATCHING", "平台 API 调用已结束")
		}
		row.RemoteIdentityRef, err = json.Marshal(papiPhysicalStep{Resource: a.Resource, Command: command})
		if err != nil {
			return err
		}
		return st.SaveToolCall(row)
	})
}

type papiObservation struct {
	access SandboxAccess
	step   papiPhysicalStep
}

func (s *CloudService) reconcilePAPISteps(ctx context.Context, bindingID uint64) error {
	var pending []papiObservation
	err := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, st StateRepository, repo CloudRepository) error {
		refs, err := repo.ActiveResourceReferences("cloud_lease", bindingID)
		if err != nil {
			return err
		}
		for _, ref := range refs {
			if ref.HolderKind != "tool_call" {
				continue
			}
			id, err := strconv.ParseUint(ref.HolderID, 10, 64)
			if err != nil {
				return integrity()
			}
			row, err := st.ToolCall(id, false)
			if err != nil {
				return err
			}
			if row == nil || row.ToolKey != papi.CallTool || row.RootRunID != bindingID || row.ResultEventSeq == nil {
				continue
			}
			var observed papiObservation
			if len(row.RemoteIdentityRef) > 0 && string(row.RemoteIdentityRef) != "null" {
				if json.Unmarshal(row.RemoteIdentityRef, &observed.step) != nil {
					return integrity()
				}
			}
			held, err := repo.HolderReferences(ref.HolderKind, ref.HolderID, false)
			if err != nil {
				return err
			}
			observed.access.BindingID = bindingID
			for _, h := range held {
				if h.ResourceKind == "cloud_computer" {
					observed.access.ComputerID = h.ResourceID
				}
				observed.access.ReferenceIDs = append(observed.access.ReferenceIDs, h.ID)
			}
			pending = append(pending, observed)
		}
		return nil
	})
	if err != nil {
		return err
	}
	var failures []error
	for _, item := range pending {
		if err := s.observePAPIStop(ctx, item); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *CloudService) observePAPIStop(ctx context.Context, item papiObservation) error {
	step := item.step
	if step.Resource.RemoteID == "" {
		return s.ReleaseReferences(ctx, &item.access, json.RawMessage(`{"physical_request_started":false}`))
	}
	config, err := s.Connection()
	if err != nil {
		return err
	}
	conn, err := s.runtimeConnection(config)
	if err != nil {
		return err
	}
	if conn.BackendGeneration != step.Resource.BackendGeneration {
		return nil
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	provider, err := s.openProvider(bounded, conn)
	if err != nil {
		return err
	}
	if step.Command != "" {
		observed, err := provider.InspectExecution(bounded, sandboxcore.ExecutionHandle{Resource: step.Resource, ID: step.Command})
		if err == nil && !observed.Running && observed.ExitCode != nil {
			return s.ReleaseReferences(ctx, &item.access, json.RawMessage(`{"process_exit_verified":true}`))
		}
	}
	// A native upload or a lost start acknowledgement has no inspectable
	// handle. As with workspace writes, require observed instance termination.
	observed, err := provider.Inspect(bounded, step.Resource)
	if err != nil {
		return err
	}
	if observed.State == "absent" || observed.State == "terminated" {
		return s.ReleaseReferences(ctx, &item.access, json.RawMessage(`{"instance_termination_verified":true}`))
	}
	return nil
}
