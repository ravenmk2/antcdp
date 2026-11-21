package agents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *CloudService) cloudAccess(ctx context.Context, raw string, admin bool, fn func(identity.Tx, Repository, StateRepository, CloudRepository, *identity.Auth, *Result) error) (*Result, error) {
	return s.Host.access(ctx, raw, admin, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		cr, e := CloudStateFor(tx)
		if e != nil {
			return e
		}
		return fn(tx, r, st, cr, a, out)
	})
}
func (s *CloudService) cloudBackground(ctx context.Context, fn func(identity.Tx, Repository, StateRepository, CloudRepository) error) error {
	return s.Host.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		cr, e := CloudStateFor(tx)
		if e != nil {
			return e
		}
		return fn(tx, r, st, cr)
	})
}
func (s *CloudService) cloudCommand(ctx context.Context, raw, key, command, scope string, input any, fn func(identity.Tx, Repository, StateRepository, CloudRepository, *identity.Auth, *Result, *Receipt) error) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(tx identity.Tx, r Repository, st StateRepository, cr CloudRepository, a *identity.Auth, out *Result) error {
		return s.cloudReceipt(ctx, tx, cr, a, out, key, command, scope, input, func(receipt *Receipt) error { return fn(tx, r, st, cr, a, out, receipt) })
	})
}
func (s *CloudService) cloudReceipt(ctx context.Context, tx identity.Tx, cr CloudRepository, a *identity.Auth, out *Result, key, command, scope string, input any, fn func(*Receipt) error) error {
	if !keyPattern.MatchString(key) {
		return httpx.Invalid("Idempotency-Key", "invalid_format")
	}
	body, e := agentcore.CanonicalJSON(input)
	if e != nil {
		return e
	}
	digest := sha256.Sum256([]byte(s.Host.ETag("cloud/request/" + string(body))))
	kind, id := splitScope(scope)
	receipt, e := cr.CloudReceipt(idString(a.User.ID), kind, id, command, key)
	if e != nil {
		return e
	}
	if receipt != nil {
		if !hmac.Equal(receipt.Hash, digest[:]) {
			return httpx.E(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求")
		}
		var saved savedResult
		if json.Unmarshal(receipt.Result, &saved) != nil {
			return integrity()
		}
		out.Data, out.Tag, out.Location, out.Status, out.Replayed = saved.Data, saved.Tag, saved.Location, receipt.ResponseStatus, true
		if isWorkspaceMutationReceipt(receipt) {
			op, readErr := workspaceReceiptOperation(cr, receipt)
			if readErr != nil {
				return readErr
			}
			out.Data, out.Status = operationView(cloudPublicOperation(op)), workspaceResponseStatus(op)
		}
		return nil
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	receipt = &Receipt{ActorKind: "user", ActorID: idString(a.User.ID), ScopeKind: kind, ScopeID: id, Command: command, Key: key, Hash: digest[:], Status: "pending", Result: json.RawMessage(`{}`), CreatedAt: now}
	if e = cr.InsertCloudReceipt(receipt); e != nil {
		return e
	}
	if e = fn(receipt); e != nil {
		return e
	}
	data, e := json.Marshal(out.Data)
	if e != nil {
		return e
	}
	receipt.Result, e = json.Marshal(savedResult{data, out.Tag, out.Location})
	if e != nil {
		return e
	}
	receipt.Status, receipt.ResponseStatus, receipt.CompletedAt = "completed", out.Status, &now
	if e = cr.SaveCloudReceipt(receipt); e != nil {
		return e
	}
	target := uint64(0)
	if receipt.TargetID != nil {
		target = *receipt.TargetID
	}
	return audit(ctx, tx, a, command, kind, target)
}

func (s *CloudService) connectionView(row *SandboxConnection) ConnectionView {
	s.diagnosticMu.Lock()
	defer s.diagnosticMu.Unlock()
	return ConnectionView{Configured: row.Endpoint != nil, Type: row.BackendType, Endpoint: row.Endpoint, AccessMode: row.AccessMode, ConnectTimeout: row.ConnectTimeout, OperationTimeout: row.OperationTimeout, Authentication: models.Authentication{Method: "api_key", HasSecret: row.APIKey != ""}, BackendGeneration: row.BackendGeneration, MaintenanceState: row.MaintenanceState, Capabilities: unknownSandboxCapabilities(), LastDiagnostic: s.lastDiagnostic, LastDiagnosticAt: s.lastDiagnosticAt}
}
func (s *CloudService) GetConnection(ctx context.Context, raw string) (*Result, error) {
	return s.Host.access(ctx, raw, true, func(_ identity.Tx, _ Repository, _ *identity.Auth, out *Result) error {
		row, err := s.Connection()
		if err != nil {
			return err
		}
		out.Data = s.connectionView(row)
		return nil
	})
}
func (s *CloudService) CheckConnection(ctx context.Context, raw string) (*Result, error) {
	out, err := s.GetConnection(ctx, raw)
	if err != nil {
		return nil, err
	}
	row, err := s.Connection()
	if err != nil {
		return nil, err
	}
	target, err := s.runtimeConnection(row)
	if err != nil {
		return nil, err
	}
	start := time.Now().UTC()
	probe, cancel := context.WithTimeout(ctx, target.ConnectTimeout+10*time.Second)
	defer cancel()
	provider, err := s.openProvider(probe, target)
	if err == nil {
		err = sandboxFailure(provider.Health(probe, nil))
	}
	data, err := json.Marshal(map[string]any{"healthy": err == nil, "elapsed_ms": time.Since(start).Milliseconds(), "error_code": remoteSandboxError(err)})
	if err != nil {
		return nil, err
	}
	s.diagnosticMu.Lock()
	if s.lastDiagnosticAt == nil || s.lastDiagnosticAt.Before(start) {
		s.lastDiagnostic = data
		s.lastDiagnosticAt = &start
	}
	s.diagnosticMu.Unlock()
	out.Data = s.connectionView(row)
	return out, nil
}
