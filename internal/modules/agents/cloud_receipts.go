package agents

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func cloudCommandKind(command string) bool {
	return strings.HasPrefix(command, "cloud_") || strings.HasPrefix(command, "sandbox_connection.") || strings.HasPrefix(command, "sandbox_spec.") || strings.HasPrefix(command, "workspace.")
}

func (s *CloudService) getReceipt(ctx context.Context, raw, key, command, scope string, admin bool) (*Result, error) {
	return s.cloudAccess(ctx, raw, admin, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository, a *identity.Auth, out *Result) error {
		if !keyPattern.MatchString(key) || len(command) < 1 || len(command) > 64 || len(scope) < 1 || len(scope) > 128 {
			return httpx.Invalid("command", "invalid_format")
		}
		kind, id := splitScope(scope)
		if !admin {
			if kind != "workspace" {
				return missing()
			}
			computerID, err := idValue(id, "scope")
			if err != nil {
				return err
			}
			computer, err := repo.Computer(computerID, false)
			if err != nil {
				return err
			}
			if err = workspaceContentAccess(computer, a); err != nil {
				return err
			}
		}
		receipt, err := repo.CloudReceipt(idString(a.User.ID), kind, id, command, key)
		if err != nil {
			return err
		}
		if receipt == nil || receipt.Status != "completed" {
			return missing()
		}
		var saved savedResult
		if json.Unmarshal(receipt.Result, &saved) != nil {
			return integrity()
		}
		status := receipt.ResponseStatus
		if isWorkspaceMutationReceipt(receipt) {
			op, readErr := workspaceReceiptOperation(repo, receipt)
			if readErr != nil {
				return readErr
			}
			saved.Data, err = json.Marshal(operationView(cloudPublicOperation(op)))
			if err != nil {
				return err
			}
			status = workspaceResponseStatus(op)
		}
		refs := []ResourceRef{}
		if receipt.TargetKind != nil && receipt.TargetID != nil {
			refs = append(refs, ResourceRef{Kind: *receipt.TargetKind, ID: idString(*receipt.TargetID)})
		}
		out.Data = CommandReceipt{Command: command, Scope: scope, Key: key, ResponseStatus: status, ResponseData: saved.Data, Resources: refs, CreatedAt: receipt.CreatedAt}
		return nil
	})
}

func isWorkspaceMutationReceipt(receipt *Receipt) bool {
	return receipt.OperationID != nil && (receipt.Command == "workspace.mkdir" || receipt.Command == "workspace.remove" || receipt.Command == "workspace.ensure_home")
}

func workspaceReceiptOperation(repo CloudRepository, receipt *Receipt) (*CloudOperationRow, error) {
	op, err := repo.CloudOperation(*receipt.OperationID, false)
	if err != nil {
		return nil, err
	}
	if op == nil || op.CommandReceiptID == nil || *op.CommandReceiptID != receipt.ID {
		return nil, integrity()
	}
	return op, nil
}

func workspaceResponseStatus(op *CloudOperationRow) int {
	if op.Status == "queued" || op.Status == "running" {
		return 202
	}
	return 200
}

func (s *CloudService) GetSandboxReceipt(ctx context.Context, raw, key, command, scope string) (*Result, error) {
	if !strings.HasPrefix(command, "sandbox_spec.") && !strings.HasPrefix(command, "sandbox_connection.") {
		return nil, missing()
	}
	return s.getReceipt(ctx, raw, key, command, scope, true)
}
