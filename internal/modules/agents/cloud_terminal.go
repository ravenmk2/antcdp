package agents

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// CloudTerminal identifies a single administrator's PTY on an exact instance.
// The public transport never accepts a provider session ID from the browser.
type CloudTerminal struct {
	service   *CloudService
	provider  sandboxcore.TerminalProvider
	ref       sandboxcore.ResourceRef
	id        string
	operation uint64
}

func (t *CloudTerminal) End(ctx context.Context) error {
	if err := t.provider.EndTerminal(ctx, t.ref, t.id); err != nil {
		return sandboxFailure(err)
	}
	return t.finish(ctx)
}

func (t *CloudTerminal) finish(ctx context.Context) error {
	return t.service.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository) error {
		op, err := cr.CloudOperation(t.operation, true)
		if err != nil || op == nil || op.FinishedAt != nil {
			return err
		}
		now := time.Now().UTC()
		op.Status, op.FinishedAt, op.UpdatedAt = "completed", &now, now
		op.OperationToken = "terminal-ended-" + idString(op.ID)
		return cr.SaveCloudOperation(op)
	})
}

// A candidate session is inert until attached. Publish it under the locked
// computer row, rechecking generation and authorization after remote creation.
func (s *CloudService) terminalSlot(ctx context.Context, raw string, computer uint64, candidate *CloudTerminal) (*CloudTerminal, error) {
	t := &CloudTerminal{service: s}
	var connection CloudConnection
	_, err := s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, a *identity.Auth, _ *Result) error {
		access, c, err := s.accessRows(cr, computer, nil)
		if err != nil {
			return err
		}
		t.ref, connection = access.Resource, c
		active, err := cr.ActiveCloudOperation(computer)
		if err != nil {
			return err
		}
		if active != nil || candidate != nil && candidate.ref != t.ref {
			return httpx.E(409, "CLOUD_NOT_READY", "云电脑运行环境已变更")
		}
		token := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("terminal/%d/%d/%d/%d/%d", computer, access.BackendGeneration, access.InstanceID, access.StorageGeneration, a.User.ID))))
		op, err := cr.CloudOperationByToken(token, true)
		if err != nil {
			return err
		}
		if op == nil {
			if candidate == nil {
				return nil
			}
			now := time.Now().UTC()
			observation, _ := json.Marshal(candidate.id)
			op = &CloudOperationRow{
				ComputerID: computer, Kind: "terminal", Status: "running", OperationToken: token,
				BackendGeneration: access.BackendGeneration, InstanceID: access.InstanceID, StorageGeneration: access.StorageGeneration,
				Intent: json.RawMessage("{}"), Observation: observation, ActorKind: "user", ActorID: idString(a.User.ID),
				ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, StartedAt: &now, UpdatedAt: now, DeadlineAt: now,
			}
			if err = cr.InsertCloudOperation(op); err != nil {
				return err
			}
		}
		if op.Kind != "terminal" || op.FinishedAt != nil || json.Unmarshal(op.Observation, &t.id) != nil || t.id == "" {
			return integrity()
		}
		t.operation = op.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	if candidate != nil {
		t.provider = candidate.provider
		return t, nil
	}
	p, err := s.openProvider(ctx, connection)
	if err != nil {
		return nil, err
	}
	var ok bool
	t.provider, ok = p.(sandboxcore.TerminalProvider)
	if !ok {
		return nil, httpx.E(409, "SANDBOX_TERMINAL_UNSUPPORTED", "当前沙箱不支持交互终端")
	}
	return t, nil
}
func (s *CloudService) OpenTerminal(ctx context.Context, raw string, computer uint64) (*CloudTerminal, sandboxcore.TerminalConnection, error) {
	t, err := s.terminalSlot(ctx, raw, computer, nil)
	if err != nil {
		return nil, nil, err
	}
	if t.id != "" {
		conn, err := t.provider.AttachTerminal(ctx, t.ref, t.id)
		var problem *sandboxcore.Error
		if !errors.As(err, &problem) || problem.Code != "SANDBOX_TERMINAL_GONE" {
			return t, conn, sandboxFailure(err)
		}
		if err = t.finish(ctx); err != nil {
			return nil, nil, err
		}
	}
	t.id, err = t.provider.CreateTerminal(ctx, t.ref, "/data")
	if err != nil {
		return nil, nil, sandboxFailure(err)
	}
	slot, err := s.terminalSlot(ctx, raw, computer, t)
	if err != nil || slot.id != t.id {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if cleanupErr := t.provider.EndTerminal(cleanup, t.ref, t.id); cleanupErr != nil {
			return nil, nil, errors.Join(err, sandboxFailure(cleanupErr))
		}
		if err != nil {
			return nil, nil, err
		}
	}
	conn, err := slot.provider.AttachTerminal(ctx, slot.ref, slot.id)
	return slot, conn, sandboxFailure(err)
}
